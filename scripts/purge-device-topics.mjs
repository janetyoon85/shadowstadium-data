// 한 기기(FCM 토큰)의 "남은 예전 언어 구독"을 서버에서 직접 해제한다(2026-10-12 — 앱의 해제 호출이 효과가 없어 황성빈 알림이 5개 언어로 계속 옴).
// 구독 목록 조회(IID info API)는 이 토큰에 InvalidToken 을 돌려줘 쓸 수 없었다. 대신 앱이 공유한 "즐겨찾기 목록"으로 후보 토픽을 직접 만들어
// Admin SDK 의 unsubscribeFromTopic([token], topic) 으로 해제한다(구독돼 있지 않아도 오류 없이 성공하므로 안전).
// 입력: 앱 설정 제목 길게 누르기로 공유한 메시지 전체(token=, favs= 줄 포함)를 FCM_TOKEN 에 붙여 넣는다.
// 해제 대상: 즐겨찾기 선수·팀·경기의 "KEEP_LANG 가 아닌 모든 언어" 토픽 + 언어 없는 옛 토픽 + (선수 ID 즐겨찾기의) 이름 토픽 전 언어.
import admin from 'firebase-admin';
import { playerTopic, playerLangTopic, teamFinalTopic, teamLiveTopic, gameLangTopic, gameTopic } from './topic.mjs';

const rawIn = process.env.FCM_TOKEN || '';
const token = ((/token=([^\s]+)/.exec(rawIn)?.[1]) || rawIn.split(/\s+/)[0] || '').trim();
const keep = process.env.KEEP_LANG || 'ko';
const dry = process.env.DRY_RUN === '1';
if (!token) { console.error('FCM_TOKEN required'); process.exit(1); }
const LANGS = ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-Hans', 'zh-Hant', 'hi', 'tr', 'nl'];
const LEADS = [1, 3, 6, 12, 24];

let favs = {};
try { const m = /favs=(\{.*\})/.exec(rawIn); if (m) favs = JSON.parse(m[1]); } catch (e) { console.error('favs parse failed', e.message); }
const arr = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const obj = (v) => { try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

const ids = new Set();     // 선수 즐겨찾기 키(ID 또는 이름)
const names = new Set();   // ID 즐겨찾기 선수의 이름(옛 이름 토픽 정리용)
for (const k of arr(favs.players)) if (typeof k === 'string') ids.add(k.match(/^(?:soccer|baseball):(.+)$/)?.[1] ?? k);
for (const k of arr(favs.bkPlayers)) if (typeof k === 'string') ids.add(k.split('|')[0]);
for (const n of Object.values(obj(favs.names))) if (typeof n === 'string' && n && !ids.has(n)) names.add(n);
const teams = new Set([...arr(favs.teams), ...arr(favs.bkTeams)].filter((k) => typeof k === 'string'));
const games = new Set(arr(favs.bkGames).filter((k) => typeof k === 'string'));
console.log(`token length=${token.length}; players=${ids.size} names=${names.size} teams=${teams.size} games=${games.size}`);

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
try { await admin.messaging().send({ token, data: { ping: '1' } }, true); console.log('token valid (dry-run send ok)'); }
catch (e) { console.error('token check failed:', e.code, e.message); process.exit(1); }

const topics = new Set();
for (const id of ids) { topics.add(playerTopic(id)); for (const l of LANGS) if (l !== keep) topics.add(playerLangTopic(id, l)); }
for (const n of names) { topics.add(playerTopic(n)); for (const l of LANGS) topics.add(playerLangTopic(n, l)); }
for (const k of teams) for (const l of LANGS) if (l !== keep) { topics.add(teamFinalTopic(k, l)); topics.add(teamLiveTopic(k, l)); } // 경기 종료 + 경기 중(골/이닝/쿼터) 알림 토픽(2026-10-20)
for (const g of games) for (const lead of LEADS) { topics.add(gameTopic(g, lead)); for (const l of LANGS) if (l !== keep) topics.add(gameLangTopic(g, lead, l)); }
console.log(`candidate topics to unsubscribe: ${topics.size}${dry ? ' (dry run — nothing changed)' : ''}`);
if (!dry) {
  let ok = 0, fail = 0;
  const list = [...topics];
  for (let i = 0; i < list.length; i += 20) {
    const res = await Promise.allSettled(list.slice(i, i + 20).map((t) => admin.messaging().unsubscribeFromTopic([token], t)));
    for (const r of res) { if (r.status === 'fulfilled' && !r.value.failureCount) ok++; else { fail++; if (fail <= 3) console.error('unsubscribe failed:', r.status === 'rejected' ? r.reason?.message : JSON.stringify(r.value.errors)); } }
  }
  console.log(`unsubscribed ok=${ok} fail=${fail}`);
}
process.exit(0);

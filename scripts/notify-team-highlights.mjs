// 즐겨찾기 팀 "하이라이트 영상이 올라왔어요" 알림(2026-10-13, 사용자 요청 — 그래야 하이라이트를 바로 본다).
// 팀 경기 종료 알림(notify-team-final)과 같은 tfinal_<hash>_<lang> 토픽을 쓴다 — 구독 UI·앱 변경 없이 즐겨찾기한 팀의 구독자에게만 간다(구독자 0이면 no-op).
// 지역 규칙: 언어마다 대표 지역(ko→KR, ja→JP …)을 정해, 그 지역에서 "실제로 열리는" 후보 영상이 있을 때만 그 언어 토픽으로 보낸다(한국에서 안 열리는 영상으로 알림을 보내지 않는다).
// 영상 지역 확인 기록(video-availability.json)이 아직 없으면 보내지 않고 다음 실행(약 2분 뒤)에 다시 본다. 첫 실행은 기존 하이라이트를 발송 없이 기록만 한다.
// 중복 방지: sent-team-highlights.json 에 `${경기}:${언어}` 별로 기록(처음엔 막혀 있다가 나중에 대체 후보가 열리면 그 시점에 한 번 보낸다).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { teamFinalTopic } from './topic.mjs';
import { LANGS, localTeam, flagTeam, localLeague } from './push-i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENT_FILE = path.join(ROOT, 'sent-team-highlights.json');
const load = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const MAX_PER_RUN = 30;

const HL = { ko: '하이라이트가 올라왔어요', en: 'Highlights are up', ja: 'ハイライトが公開されました', es: 'Ya están los resúmenes', pt: 'Os melhores momentos chegaram', fr: 'Le résumé est disponible', de: 'Die Highlights sind da', it: 'Gli highlights sono online', ru: 'Появился обзор матча', ar: 'تم نشر ملخص المباراة', id: 'Cuplikan sudah tayang', th: 'ไฮไลต์มาแล้ว', vi: 'Đã có video highlight', 'zh-Hans': '比赛集锦已上线', 'zh-Hant': '比賽精華已上線', hi: 'हाइलाइट्स आ गए हैं', tr: 'Özet yayında', nl: 'De samenvatting staat online' };
export const LANG_REGION = { ko: 'KR', en: 'US', ja: 'JP', es: 'ES', pt: 'BR', fr: 'FR', de: 'DE', it: 'IT', ru: 'RU', ar: 'SA', id: 'ID', th: 'TH', vi: 'VN', 'zh-Hans': 'CN', 'zh-Hant': 'TW', hi: 'IN', tr: 'TR', nl: 'NL' };

// 후보 영상이 그 지역에서 확실히 열리는가(확인 기록이 있고, 삭제·비공개가 아니며, 그 지역이 차단 목록에 없음). 기록이 없으면 아직 모름 → false.
export function playableIn(avail, v, region) {
  const e = avail?.[v];
  return !!e && !e.g && !(e.b || []).includes(region);
}
export function langsToSend(entry, avail, sentFor) {
  const cands = [entry, ...(entry.alts || [])].map((c) => c.v).filter(Boolean);
  return LANGS.filter((l) => !sentFor(l) && cands.some((v) => playableIn(avail, v, LANG_REGION[l])));
}

const EXTRA_BASEBALL = new Set(['WBC', 'CARIBBEANSERIES', 'LIDOM', 'LMP', 'LVBP', 'LMB', 'PWL', 'ABL', 'AFL', 'AAA', 'PREMIER12']);
const isBaseball = (lg) => lg === 'KBO' || lg === 'MLB' || lg === 'NPB' || EXTRA_BASEBALL.has(lg) || /BASEBALL/.test(lg || '');
function softKeys(name, baseball) {
  const base = name.replace(/\s*\(남자\)$/, '');
  const ks = new Set([name, base]);
  if (baseball) for (const k of [...ks]) ks.add('⚾:' + k);
  return [...ks];
}

async function main() {
  const DRY = !!process.env.DRY_RUN;
  const send = DRY ? async (m) => { if (process.env.DRY_RUN === '2') console.log(m.topic, m.notification.title); } : (m) => admin.messaging().send(m);
  if (!DRY && admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

  const firstRun = !(await fs.stat(SENT_FILE).catch(() => null));
  const sent = await load(SENT_FILE, {});
  const hl = await load(path.join(ROOT, 'highlights-video.json'), {});
  const avail = await load(path.join(ROOT, 'video-availability.json'), {});
  const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
  const cutDate = kst(Date.now() - 36 * 3600e3);

  // 경기 정보: games.json(축구·야구) + 농구
  const info = new Map(); // id -> { keys, data, title(lang), body(lang) }
  const games = await load(path.join(ROOT, 'games.json'), []);
  for (const g of Array.isArray(games) ? games : []) {
    if (!g.gameId || !hl[g.gameId] || g.status !== 'completed' || g.date < cutDate) continue;
    const bb = isBaseball(g.league);
    info.set(g.gameId, {
      keys: [...softKeys(g.home, bb), ...softKeys(g.away, bb)],
      data: { gameId: String(g.gameId), venueId: String(g.venueId || ''), date: String(g.date), doubleheaderNum: '' },
      title: (l) => `▶ ${flagTeam(l, g.away, g.league)} vs ${flagTeam(l, g.home, g.league)}`,
      body: (l) => `${HL[l]}${g.league ? ' · ' + localLeague(l, g.league) : ''}`,
    });
  }
  const bk = (await load(path.join(ROOT, 'basketball/games.json'), {})).games || [];
  const teams = await load(path.join(ROOT, 'basketball/teams.json'), {});
  const names = await load(path.join(ROOT, 'basketball/team-name-en.json'), {});
  const NAT = new Set(['FIBA', 'OLYMPICS_M', 'OLYMPICS_W', 'ASIAD_M', 'ASIAD_W', 'ASIAD3_M', 'ASIAD3_W']);
  const en = (k) => teams[k]?.en || names['bk:' + k] || teams[k]?.ko || k;
  const koN = (k) => teams[k]?.ko || teams[k]?.en || names['bk:' + k] || k;
  const gid = (k) => { const t = teams[k]; if (!t) return k; return NAT.has(t.lg) ? 'n|' + koN(k).toLowerCase() : t.lg + '|' + en(k).toLowerCase(); };
  const byGroup = {};
  for (const k of Object.keys(teams)) (byGroup[gid(k)] ??= []).push(k);
  const sib = (k) => byGroup[gid(k)] || [k];
  for (const g of bk) {
    if (!g.id || !hl[g.id] || g.st !== 'final' || g.date < cutDate || !g.h || !g.a) continue;
    const tn = (l, k) => (l === 'ko' ? koN(k) : en(k));
    info.set(g.id, {
      keys: [...new Set([...sib(g.h.k), ...sib(g.a.k)])],
      data: { gameId: String(g.id), venueId: String(g.vid || ''), date: String(g.date), doubleheaderNum: '' },
      title: (l) => `▶ ${tn(l, g.a.k)} vs ${tn(l, g.h.k)}`,
      body: (l) => `${HL[l]}${g.lg ? ' · ' + g.lg : ''}`,
    });
  }

  let n = 0, sentMsgs = 0;
  for (const [id, it] of info) {
    const entry = hl[id];
    if (firstRun) { for (const l of LANGS) sent[`${id}:${l}`] = new Date().toISOString(); continue; }
    const langs = langsToSend(entry, avail, (l) => !!sent[`${id}:${l}`]);
    if (!langs.length) continue;
    if (n >= MAX_PER_RUN) break;
    const jobs = [];
    for (const key of it.keys) for (const l of langs) {
      jobs.push({ topic: teamFinalTopic(key, l), notification: { title: it.title(l), body: it.body(l) }, data: it.data, android: { priority: 'high', notification: { channelId: 'player-alerts', tag: `hl_${id}` } }, apns: { headers: { 'apns-collapse-id': `hl_${id}`.slice(0, 64) } } });
    }
    let ok = 0;
    for (let i = 0; i < jobs.length; i += 40) {
      const res = await Promise.allSettled(jobs.slice(i, i + 40).map((m) => send(m)));
      ok += res.filter((r) => r.status === 'fulfilled').length;
      if (i === 0 && res.every((r) => r.status === 'rejected')) { console.error('[team-highlights] FAIL', id, res[0].reason?.message ?? res[0].reason); ok = -1; break; }
    }
    if (ok >= 0) { for (const l of langs) sent[`${id}:${l}`] = new Date().toISOString(); n++; sentMsgs += ok; }
  }
  for (const k of Object.keys(sent)) if (Date.parse(sent[k]) < Date.now() - 14 * 86400e3) delete sent[k];
  await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 1) + '\n');
  console.log(`[team-highlights] games=${n} messages=${sentMsgs} firstRun=${firstRun} candidates=${info.size} state=${Object.keys(sent).length}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

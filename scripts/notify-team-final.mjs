// 즐겨찾기 팀 "경기 종료 + 최종 스코어" 알림(2026-10-03, 축구/야구/농구). 누가 구독했는지는 모르고
// tfinal_<hash>_<lang> 토픽에 그냥 발송(구독자 0이면 no-op). 첫 실행은 기존 종료 경기를 발송 없이 기록만.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { teamFinalTopic } from './topic.mjs';
import { LANGS, localTeam, localLeague } from './push-i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENT_FILE = path.join(ROOT, 'sent-team-final.json');
const load = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const MAX_GAMES_PER_RUN = 40;

const FINAL = { ko: '경기 종료', en: 'Full time', ja: '試合終了', es: 'Final del partido', pt: 'Fim de jogo', fr: 'Match terminé', de: 'Spielende', it: 'Partita finita', ru: 'Матч окончен', ar: 'انتهت المباراة', id: 'Pertandingan selesai', th: 'จบการแข่งขัน', vi: 'Kết thúc trận', 'zh-Hans': '比赛结束', 'zh-Hant': '比賽結束', hi: 'मैच समाप्त', tr: 'Maç sona erdi', nl: 'Einde wedstrijd' };

const EXTRA_BASEBALL = new Set(['WBC', 'CARIBBEANSERIES', 'LIDOM', 'LMP', 'LVBP', 'LMB', 'PWL', 'ABL', 'AFL', 'AAA', 'PREMIER12']);
const isBaseball = (lg) => lg === 'KBO' || lg === 'MLB' || lg === 'NPB' || EXTRA_BASEBALL.has(lg) || /BASEBALL/.test(lg || '');
const BASEBALL_NATIONAL_FAV_PREFIX = '⚾:';

function softKeys(name, baseball) {
  const base = name.replace(/\s*\(남자\)$/, '');
  const ks = new Set([name, base]);
  if (baseball) for (const k of [...ks]) ks.add(BASEBALL_NATIONAL_FAV_PREFIX + k);
  return [...ks];
}

const DRY = !!process.env.DRY_RUN;
const send = DRY ? async (m) => { if (process.env.DRY_RUN === '2') console.log(m.topic, m.notification.title); } : (m) => admin.messaging().send(m);
if (!DRY && admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

async function sendAll(keys, byLang, data) {
  const jobs = [];
  for (const key of keys) for (const lang of LANGS) {
    const c = byLang[lang];
    jobs.push({ topic: teamFinalTopic(key, lang), notification: { title: c.title, body: c.body }, data, android: { priority: 'high', notification: { channelId: 'player-alerts' } } });
  }
  let ok = 0;
  for (let i = 0; i < jobs.length; i += 40) {
    const res = await Promise.allSettled(jobs.slice(i, i + 40).map((m) => send(m)));
    ok += res.filter((r) => r.status === 'fulfilled').length;
    if (i === 0 && res.every((r) => r.status === 'rejected')) throw res[0].reason;
  }
  return ok;
}

const firstRun = !(await fs.stat(SENT_FILE).catch(() => null));
const sent = await load(SENT_FILE, {});
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const cutDate = kst(Date.now() - 36 * 3600e3);

const todo = [];
const games = await load(path.join(ROOT, 'games.json'), []);
for (const g of Array.isArray(games) ? games : []) {
  if (g.status !== 'completed' || !g.gameId || g.date < cutDate) continue;
  if (typeof g.homeScore !== 'number' || typeof g.awayScore !== 'number') continue;
  if (sent[g.gameId]) continue;
  const bb = isBaseball(g.league);
  todo.push({
    id: g.gameId, keys: [...softKeys(g.home, bb), ...softKeys(g.away, bb)],
    data: { gameId: String(g.gameId), venueId: String(g.venueId || ''), date: String(g.date), doubleheaderNum: '' },
    text: (lang) => ({
      title: `🏁 ${localTeam(lang, g.away)} ${g.awayScore}-${g.homeScore} ${localTeam(lang, g.home)}`,
      body: `${FINAL[lang]}${g.league ? ' · ' + localLeague(lang, g.league) : ''}`,
    }),
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
const bkSeen = new Set();
for (const g of bk) {
  if (g.st !== 'final' || g.date < cutDate || !g.h || !g.a) continue;
  if (typeof g.h.s !== 'number' || typeof g.a.s !== 'number') continue;
  const mk = `bk:${g.date}:${[gid(g.h.k), gid(g.a.k)].sort().join('~')}`;
  if (sent[mk] || bkSeen.has(mk)) continue;
  bkSeen.add(mk);
  todo.push({
    id: mk, keys: [...new Set([...sib(g.h.k), ...sib(g.a.k)])],
    data: { gameId: String(g.id), venueId: String(g.vid || ''), date: String(g.date), doubleheaderNum: '' },
    text: (lang) => {
      const tn = (k) => (lang === 'ko' ? koN(k) : en(k));
      return { title: `🏁 ${tn(g.a.k)} ${g.a.s}-${g.h.s} ${tn(g.h.k)}`, body: `${FINAL[lang]}${g.lg ? ' · ' + g.lg : ''}` };
    },
  });
}

let n = 0;
for (const it of todo) {
  if (firstRun) { sent[it.id] = new Date().toISOString(); continue; }
  if (n >= MAX_GAMES_PER_RUN) break;
  const byLang = Object.fromEntries(LANGS.map((l) => [l, it.text(l)]));
  try { await sendAll(it.keys, byLang, it.data); sent[it.id] = new Date().toISOString(); n++; }
  catch (e) { console.error('[team-final] FAIL', it.id, e?.message ?? e); }
}
for (const k of Object.keys(sent)) if (Date.parse(sent[k]) < Date.now() - 14 * 86400e3) delete sent[k];
await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 1) + '\n');
console.log(`[team-final] sent=${n} firstRun=${firstRun} state=${Object.keys(sent).length}`);

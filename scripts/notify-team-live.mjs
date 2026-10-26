// 즐겨찾기 팀 "경기 중" 알림(2026-10-18, 사용자 제안) — 축구: 골 / 야구: 이닝 종료 / 농구: 쿼터 종료.
// 앱 설정에서 이 알림을 켠 기기만 tlive_<hash>_<lang> 토픽을 구독한다(구독자 0이면 no-op). 경기 종료 알림(notify-team-final)과는 별개 토픽.
// 상태(sent-team-live.json)에 경기별 마지막 관측(골 수·이닝·쿼터)을 저장해 두고, 다음 실행에서 늘어난 것만 알린다.
// 처음 보는 경기는 기록만 하고 보내지 않는다(기능 시작·긴 공백 뒤 과거 사건 폭탄 방지). 예정 경기도 미리 기록해 두므로 킥오프 직후 골부터 잡힌다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { teamLiveTopic } from './topic.mjs';
import { LANGS, localTeam, localLeague, localPlayer, eventLabel, minuteLabel } from './push-i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENT_FILE = path.join(ROOT, 'sent-team-live.json');
const MAX_SENDS_PER_RUN = 60;

const EXTRA_BASEBALL = new Set(['WBC', 'CARIBBEANSERIES', 'LIDOM', 'LMP', 'LVBP', 'LMB', 'PWL', 'ABL', 'AFL', 'AAA', 'PREMIER12']);
export const isBaseball = (lg) => lg === 'KBO' || lg === 'MLB' || lg === 'NPB' || EXTRA_BASEBALL.has(lg) || /BASEBALL/.test(lg || '');
const BASEBALL_NATIONAL_FAV_PREFIX = '⚾:';

const INNING_END = {
  ko: (n) => `${n}회 종료`, en: (n) => `End of inning ${n}`, ja: (n) => `${n}回終了`, es: (n) => `Fin de la entrada ${n}`, pt: (n) => `Fim da ${n}ª entrada`,
  fr: (n) => `Fin de la manche ${n}`, de: (n) => `Ende ${n}. Inning`, it: (n) => `Fine ${n}° inning`, ru: (n) => `Конец ${n}-го иннинга`, ar: (n) => `نهاية الشوط ${n}`,
  id: (n) => `Akhir inning ${n}`, th: (n) => `จบอินนิ่งที่ ${n}`, vi: (n) => `Hết hiệp ${n}`, 'zh-Hans': (n) => `${n}局结束`, 'zh-Hant': (n) => `${n}局結束`,
  hi: (n) => `${n}वीं इनिंग समाप्त`, tr: (n) => `${n}. inning sona erdi`, nl: (n) => `Einde inning ${n}`,
};
const QUARTER_END = {
  ko: (n) => `${n}쿼터 종료`, en: (n) => `End of Q${n}`, ja: (n) => `第${n}クォーター終了`, es: (n) => `Fin del ${n}.º cuarto`, pt: (n) => `Fim do ${n}º quarto`,
  fr: (n) => `Fin du ${n}e quart-temps`, de: (n) => `Ende ${n}. Viertel`, it: (n) => `Fine ${n}° quarto`, ru: (n) => `Конец ${n}-й четверти`, ar: (n) => `نهاية الربع ${n}`,
  id: (n) => `Akhir kuarter ${n}`, th: (n) => `จบควอเตอร์ที่ ${n}`, vi: (n) => `Hết hiệp ${n}`, 'zh-Hans': (n) => `第${n}节结束`, 'zh-Hant': (n) => `第${n}節結束`,
  hi: (n) => `क्वार्टर ${n} समाप्त`, tr: (n) => `${n}. periyot sona erdi`, nl: (n) => `Einde ${n}e kwart`,
};

// 야구 "N회초/말" → N(없으면 null).
export function parseInning(info) {
  const m = /^(\d+)회(초|말)$/.exec(info || '');
  return m ? Number(m[1]) : null;
}
// 농구 per 문자열 → 쿼터 번호(1~4), 연장은 5+, 못 읽으면 null. App.tsx bkLivePer 와 같은 규칙.
export function parseQuarter(per) {
  const p = per || '';
  if (/OT|연장|延長|加时/i.test(p)) return 5;
  const m = p.match(/(\d)\s*(?:st|nd|rd|th)\b/i) || p.match(/Q\s*(\d)/i) || p.match(/(\d)\s*(?:Q\b|쿼터|クォーター|节|節)/i) || p.match(/第\s*(\d)/);
  if (m) return Number(m[1]);
  if (/half/i.test(p) || /하프/.test(p)) return 2.5; // 하프타임: 2쿼터는 끝났고 3쿼터는 아직
  return null;
}

// 이전 관측(prev)과 현재(cur)를 비교해 새로 알릴 사건 목록을 만든다. prev 가 없으면(처음 봄) 사건 없음.
//  cur: { sport:'football'|'baseball'|'basketball', live:boolean, goals:{home:[],away:[]}, inn:number|null, q:number|null }
export function detectEvents(prev, cur) {
  if (!prev || !cur.live) return [];
  const ev = [];
  if (cur.sport === 'football') {
    for (const side of ['home', 'away']) {
      const before = prev.goals?.[side] ?? 0, now = cur.goals?.[side]?.length ?? 0;
      for (let i = before; i < now; i++) ev.push({ type: 'goal', side, scorer: cur.goals[side][i], idx: i });
    }
  } else if (cur.sport === 'baseball') {
    if (typeof prev.inn === 'number' && typeof cur.inn === 'number' && cur.inn > prev.inn) ev.push({ type: 'inning', n: prev.inn });
  } else if (cur.sport === 'basketball') {
    // 끝난 쿼터 수: 1쿼터 중=0, 2쿼터 중=1, 하프타임=2, 3쿼터 중=2, 4쿼터 중=3, 연장=4. 늘어나면 그 쿼터가 끝난 것(1~3쿼터만 — 4쿼터/연장 끝은 경기 종료 알림이 있다).
    const done = (q) => (q === 2.5 ? 2 : q - 1);
    if (typeof prev.q === 'number' && typeof cur.q === 'number' && done(cur.q) > done(prev.q)) {
      const n = done(cur.q);
      if (n >= 1 && n <= 3) ev.push({ type: 'quarter', n });
    }
  }
  return ev;
}

function softKeys(name, baseball) {
  const base = name.replace(/\s*\(남자\)$/, '');
  const ks = new Set([name, base]);
  if (baseball) for (const k of [...ks]) ks.add(BASEBALL_NATIONAL_FAV_PREFIX + k);
  return [...ks];
}

async function main() {
  const { default: admin } = await import('firebase-admin');
  const DRY = !!process.env.DRY_RUN;
  const send = DRY ? async (m) => { if (process.env.DRY_RUN === '2') console.log(m.topic, m.notification.title); } : (m) => admin.messaging().send(m);
  if (!DRY && admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

  const load = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
  const state = await load(SENT_FILE, {});
  const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
  const minDate = kst(Date.now() - 36 * 3600e3), maxDate = kst(Date.now() + 36 * 3600e3);

  const games = await load(path.join(ROOT, 'games.json'), []);
  const bk = (await load(path.join(ROOT, 'basketball/games.json'), {})).games || [];
  const teams = await load(path.join(ROOT, 'basketball/teams.json'), {});
  const bkNames = await load(path.join(ROOT, 'basketball/team-name-en.json'), {});
  const NAT = new Set(['FIBA', 'OLYMPICS_M', 'OLYMPICS_W', 'ASIAD_M', 'ASIAD_W', 'ASIAD3_M', 'ASIAD3_W']);
  const en = (k) => teams[k]?.en || bkNames['bk:' + k] || teams[k]?.ko || k;
  const koN = (k) => teams[k]?.ko || teams[k]?.en || bkNames['bk:' + k] || k;
  const gidOf = (k) => { const t = teams[k]; if (!t) return k; return NAT.has(t.lg) ? 'n|' + koN(k).toLowerCase() : t.lg + '|' + en(k).toLowerCase(); };
  const byGroup = {};
  for (const k of Object.keys(teams)) (byGroup[gidOf(k)] ??= []).push(k);
  const sib = (k) => byGroup[gidOf(k)] || [k];

  // 관측 대상 목록 — 각 항목: { id, cur, keys, make(lang, ev) }
  const items = [];
  for (const g of Array.isArray(games) ? games : []) {
    if (!g.gameId || !g.date || g.date < minDate || g.date > maxDate) continue;
    if (g.status !== 'scheduled' && g.status !== 'live') continue;
    const baseball = isBaseball(g.league);
    const live = g.status === 'live';
    const sc = (side) => (Array.isArray(g.scorers?.[side]) ? g.scorers[side] : []);
    const cur = baseball
      ? { sport: 'baseball', live, inn: parseInning(g.inningInfo), goals: null }
      : { sport: 'football', live, goals: { home: sc('home'), away: sc('away') }, inn: null };
    const score = (lang) => (typeof g.homeScore === 'number' && typeof g.awayScore === 'number' ? ` ${localTeam(lang, g.away, g.league)} ${g.awayScore}-${g.homeScore} ${localTeam(lang, g.home, g.league)}` : '');
    items.push({
      id: g.gameId, cur, baseball,
      keys: [...softKeys(g.home, baseball), ...softKeys(g.away, baseball)],
      make: (lang, e) => {
        const lg = localLeague(lang, g.league);
        if (e.type === 'goal') {
          const sd = e.scorer || {};
          const team = e.side === 'home' ? g.home : g.away;
          return { title: `⚽ ${eventLabel(lang, null, 'goal')}!${score(lang)}`, body: [`${localTeam(lang, team, g.league)}${sd.n ? ' · ' + localPlayer(lang, sd.n, sd.pid) : ''}${minuteLabel(lang, sd.m)}`, lg].filter(Boolean).join(' · ') };
        }
        return { title: `⚾ ${(INNING_END[lang] || INNING_END.en)(e.n)}${score(lang)}`, body: lg };
      },
      data: { gameId: String(g.gameId), venueId: String(g.venueId || ''), date: String(g.date), doubleheaderNum: '' },
    });
  }
  for (const g of bk) {
    if (!g.id || !g.date || g.date < minDate || g.date > maxDate || !g.h || !g.a) continue;
    if (g.st !== 'scheduled' && g.st !== 'live') continue;
    const tn = (lang, k) => (lang === 'ko' ? koN(k) : en(k));
    const sc = (lang) => (typeof g.h.s === 'number' && typeof g.a.s === 'number' ? ` ${tn(lang, g.a.k)} ${g.a.s}-${g.h.s} ${tn(lang, g.h.k)}` : '');
    items.push({
      id: g.id, cur: { sport: 'basketball', live: g.st === 'live', q: parseQuarter(g.per), goals: null },
      keys: [...new Set([...sib(g.h.k), ...sib(g.a.k)])],
      make: (lang, e) => ({ title: `🏀 ${(QUARTER_END[lang] || QUARTER_END.en)(e.n)}${sc(lang)}`, body: g.lg ? String(g.lg) : '' }),
      data: { gameId: String(g.id), venueId: String(g.vid || ''), date: String(g.date), doubleheaderNum: '' },
    });
  }

  let sentN = 0;
  const now = new Date().toISOString();
  for (const it of items) {
    const prev = state[it.id];
    const events = detectEvents(prev, it.cur);
    for (const e of events) {
      if (sentN >= MAX_SENDS_PER_RUN) break;
      const evKey = e.type === 'goal' ? `goal:${e.side}:${e.idx}` : e.type === 'inning' ? `inn:${e.n}` : `q:${e.n}`;
      if (prev.sent?.includes(evKey)) continue;
      const byLang = Object.fromEntries(LANGS.map((l) => [l, it.make(l, e)]));
      let ok = false;
      for (const key of it.keys) for (let i = 0; i < LANGS.length; i += 18) {
        const jobs = LANGS.slice(i, i + 18).map((lang) => send({
          topic: teamLiveTopic(key, lang), notification: { title: byLang[lang].title, body: byLang[lang].body }, data: it.data,
          android: { priority: 'high', notification: { channelId: 'player-alerts', tag: `tl_${it.id}_${evKey}`.slice(0, 120) } },
          apns: { headers: { 'apns-collapse-id': `tl_${it.id}_${evKey}`.slice(-64) } },
        }));
        const res = await Promise.allSettled(jobs);
        if (res.some((r) => r.status === 'fulfilled')) ok = true;
      }
      if (ok) { (prev.sent ??= []).push(evKey); sentN++; } else console.error('[team-live] FAIL', it.id, evKey);
    }
    // 관측 갱신 — 지표는 줄어들지 않게(소스가 잠깐 옛 값을 줄 때 다음 정상 값이 "새 사건"으로 보이는 것 방지).
    const next = prev ?? { sent: [] };
    next.goals = it.cur.goals ? { home: Math.max(next.goals?.home ?? 0, it.cur.goals.home.length), away: Math.max(next.goals?.away ?? 0, it.cur.goals.away.length) } : next.goals;
    if (typeof it.cur.inn === 'number') next.inn = Math.max(next.inn ?? 0, it.cur.inn);
    if (typeof it.cur.q === 'number') next.q = Math.max(next.q ?? 0, it.cur.q);
    next.seen = now;
    state[it.id] = next;
  }
  for (const k of Object.keys(state)) if (Date.parse(state[k].seen) < Date.now() - 4 * 86400e3) delete state[k];
  await fs.writeFile(SENT_FILE, JSON.stringify(state, null, 1) + '\n');
  console.log(`[team-live] sent=${sentN} tracked=${Object.keys(state).length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

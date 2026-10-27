// 다음스포츠로 games.json 의 경기 상태·점수를 "앞으로만" 보강 — 네이버가 막혔을 때 KBO·K리그·NPB 등 한국 핵심 리그를 잇는 보조 경로(2026-10-27).
// 규칙: robots.txt 허용 경로(/api/hermes/game/list.json)만, 진행/임박 경기가 있는 리그만 조회, 리그당 1~2요청, 요청 간 1초 이상, 실패하면 포기.
// 실행: node scripts/fetch-daum-scores.mjs [--dry]
import './lib/watch-429.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDaum, fromDaumGame, DAUM_LEAGUE } from './lib/daum-fallback.mjs';
import { kickoffMs } from './lib/fallback-match.mjs';
import { applyDaumBasketball, fromDaumBasketball, DAUM_BASKETBALL_LEAGUE } from './lib/daum-basketball.mjs';
import { NEWGAME_LEAGUES, learnVenues, planNewGames } from './lib/daum-newgames.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry') || process.env.DAUM_DRY === '1';
const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)';
const GAP_MS = Math.max(1000, Number(process.env.DAUM_GAP_MS) || 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
// 대상 리그만 제한하려면 DAUM_LEAGUES=KBO,K리그1 (기본: 사전 전체 중 활성 리그)
const ONLY = (process.env.DAUM_LEAGUES || '').split(',').map((s) => s.trim()).filter(Boolean);

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await r.text();
  return JSON.parse(t);
}

async function gamesPart() {
  const now = Date.now();
  const games = JSON.parse(await fs.readFile(path.join(ROOT, 'games.json'), 'utf-8'));
  // 활성: 킥오프가 (지금-5시간 ~ 지금+90분) 이고 아직 종료·취소·연기가 아닌 경기가 있는 리그. (야구 4시간·축구 2.5시간 경기 + 여유)
  const active = new Set();
  for (const g of games) {
    const lg = DAUM_LEAGUE[g.league];
    if (!lg || (ONLY.length && !ONLY.includes(g.league))) continue;
    if (g.status === 'completed' || g.status === 'cancelled' || g.status === 'postponed') continue;
    const k = kickoffMs(g);
    if (Number.isFinite(k) && k - now < 90 * 60e3 && now - k < 5 * 3600e3) active.add(g.league);
  }
  console.log(`[daum] 활성 리그 ${active.size}개: ${[...active].join(', ') || '(없음)'}`);
  if (!active.size) return;
  const from = kstDay(now - 36 * 3600e3), to = kstDay(now + 36 * 3600e3);
  const cands = {};
  let requests = 0, errors = 0;
  for (const league of active) {
    cands[league] = [];
    try {
      for (let page = 1; page <= 3; page++) {
        const j = await getJson(`https://sports.daum.net/api/hermes/game/list.json?leagueCode=${DAUM_LEAGUE[league]}&fromDate=${from}&toDate=${to}&page=${page}`);
        requests++;
        for (const x of j.list || []) { const m = fromDaumGame(x, now); if (m) cands[league].push(m); }
        const p = j.pagingInfo || {};
        if (!p.totalCount || page * (p.pageSize || 20) >= p.totalCount) break;
        await sleep(GAP_MS);
      }
    } catch (e) {
      errors++;
      console.warn(`[daum] ${league} 조회 실패: ${String(e.message).slice(0, 60)}`);
    }
    await sleep(GAP_MS);
  }
  const { games: out, changes } = applyDaum(games, cands, now);
  for (const c of changes.slice(0, 40)) console.log(`[daum] ${c.league} ${c.gameId} ${JSON.stringify(c.patch)} ← ${c.via}`);
  console.log(`[daum] 요청 ${requests}건(실패 ${errors}), 변경 ${changes.length}건${DRY ? ' [DRY — 저장 안 함]' : ''}`);
  if (!changes.length || DRY) return;
  await fs.writeFile(path.join(ROOT, 'games.json'), JSON.stringify(out, null, 2) + '\n', 'utf-8');
}

// 농구(KBL·WKBL): basketball/games.json 보강 — 같은 원칙(활성 리그만·앞으로만·멱등).
async function basketballPart() {
  const now = Date.now();
  const file = path.join(ROOT, 'basketball', 'games.json');
  let doc, teams;
  try {
    doc = JSON.parse(await fs.readFile(file, 'utf-8'));
    teams = JSON.parse(await fs.readFile(path.join(ROOT, 'basketball', 'teams.json'), 'utf-8'));
  } catch (e) { console.warn(`[daum-bk] 읽기 실패: ${String(e.message).slice(0, 50)}`); return; }
  const list = Array.isArray(doc) ? doc : doc.games || [];
  const active = new Set();
  for (const g of list) {
    if (!DAUM_BASKETBALL_LEAGUE[g.lg] || g.st === 'final') continue;
    if (Number.isFinite(g.t) && g.t - now < 90 * 60e3 && now - g.t < 5 * 3600e3) active.add(g.lg);
  }
  console.log(`[daum-bk] 활성 농구 리그 ${active.size}개: ${[...active].join(', ') || '(없음)'}`);
  if (!active.size) return;
  const from = kstDay(now - 36 * 3600e3), to = kstDay(now + 36 * 3600e3);
  const cands = {};
  let requests = 0;
  for (const lg of active) {
    cands[lg] = [];
    try {
      const j = await getJson(`https://sports.daum.net/api/hermes/game/list.json?leagueCode=${DAUM_BASKETBALL_LEAGUE[lg]}&fromDate=${from}&toDate=${to}`);
      requests++;
      for (const x of j.list || []) { const m = fromDaumBasketball(x, now); if (m) cands[lg].push(m); }
    } catch (e) { console.warn(`[daum-bk] ${lg} 조회 실패: ${String(e.message).slice(0, 60)}`); }
    await sleep(GAP_MS);
  }
  const { games: out, changes } = applyDaumBasketball(list, cands, teams, now);
  for (const c of changes.slice(0, 20)) console.log(`[daum-bk] ${c.lg} ${c.id} ${JSON.stringify(c.patch)} ← ${c.via}`);
  console.log(`[daum-bk] 요청 ${requests}건, 변경 ${changes.length}건${DRY ? ' [DRY — 저장 안 함]' : ''}`);
  if (!changes.length || DRY) return;
  const next = Array.isArray(doc) ? out : { ...doc, games: out, updated: Date.now() };
  await fs.writeFile(file, JSON.stringify(next) + '\n', 'utf-8');
}

// 새 경기 추가·시간 변경(KBO·K리그1·2): 다음스포츠에는 있는데 games.json 에 없는 경기(예: 한국시리즈)를 채운다. 30분에 한 번만(분 % 30 < 3), 구장 표는 daum-venue-map.json 에 학습·보관.
// DAUM_DISCOVER=1 이면 시간과 무관하게 실행, DAUM_LEARN_DAYS=60 이면 과거 N일 경기로 구장 표를 한 번에 학습(최초 1회용).
async function discoverPart() {
  const now = Date.now();
  const force = process.env.DAUM_DISCOVER === '1';
  if (!force && new Date(now).getUTCMinutes() % 30 >= 3) { console.log('[daum-new] 점검 시각 아님(30분 주기) — 건너뜀'); return; }
  const gamesFile = path.join(ROOT, 'games.json');
  const venueFile = path.join(ROOT, 'daum-venue-map.json');
  const games = JSON.parse(await fs.readFile(gamesFile, 'utf-8'));
  let venueMap = {};
  try { venueMap = JSON.parse(await fs.readFile(venueFile, 'utf-8')); } catch { /* 첫 실행 */ }
  const learnDays = Math.max(2, Number(process.env.DAUM_LEARN_DAYS) || 2);
  const from = kstDay(now - learnDays * 86400e3), to = kstDay(now + 14 * 86400e3);
  const cands = {};
  let requests = 0;
  for (const league of NEWGAME_LEAGUES) {
    if (ONLY.length && !ONLY.includes(league)) continue;
    cands[league] = [];
    try {
      for (let page = 1; page <= 12; page++) {
        const j = await getJson(`https://sports.daum.net/api/hermes/game/list.json?leagueCode=${DAUM_LEAGUE[league]}&fromDate=${from}&toDate=${to}&page=${page}`);
        requests++;
        for (const x of j.list || []) { const m = fromDaumGame(x, now); if (m) cands[league].push(m); }
        const p = j.pagingInfo || {};
        if (!p.totalCount || page * (p.pageSize || 20) >= p.totalCount) break;
        await sleep(GAP_MS);
      }
    } catch (e) { console.warn(`[daum-new] ${league} 조회 실패: ${String(e.message).slice(0, 60)}`); }
    await sleep(GAP_MS);
  }
  // 구장 표 학습(매칭된 경기에서) → 병합
  const learned = learnVenues(games, cands);
  let venueChanged = false;
  for (const [lg, m] of Object.entries(learned)) for (const [name, v] of Object.entries(m)) {
    const cur = venueMap[lg]?.[name];
    if (!cur || cur.venueId !== v.venueId || cur.stadium !== v.stadium) { (venueMap[lg] ||= {})[name] = v; venueChanged = true; }
  }
  const { games: out, added, retimed, unmapped } = planNewGames(games, cands, venueMap, now);
  for (const a of added) console.log(`[daum-new] 추가 ${a.league} ${a.date} ${a.time} ${a.home}-${a.away} (${a.venueId}) id=${a.gameId}`);
  for (const r of retimed) console.log(`[daum-new] 시간 변경 ${r.league} ${r.gameId} ${r.from} → ${r.to}`);
  if (unmapped.length) console.warn(`[daum-new] 구장 매핑 없음(추가 보류): ${unmapped.join(', ')}`);
  console.log(`[daum-new] 요청 ${requests}건, 추가 ${added.length}, 시간변경 ${retimed.length}, 구장표 ${venueChanged ? '갱신' : '유지'}${DRY ? ' [DRY — 저장 안 함]' : ''}`);
  if (DRY) return;
  if (venueChanged) await fs.writeFile(venueFile, JSON.stringify(venueMap, null, 1) + '\n', 'utf-8');
  if (added.length || retimed.length) await fs.writeFile(gamesFile, JSON.stringify(out, null, 2) + '\n', 'utf-8');
}

// DAUM_PARTS=games,basketball(기본). 농구는 fetch-basketball 워크플로우 안에서(같은 체크아웃·같은 커밋) 돌려 basketball/games.json 을 통째로 다시 쓰는 그 작업과의 경합을 피한다. discover=새 경기·시간 변경.
const PARTS = new Set((process.env.DAUM_PARTS || 'games,basketball').split(',').map((x) => x.trim()));
async function main() {
  if (PARTS.has('games')) { try { await gamesPart(); } catch (e) { console.error('[daum] 일정 파트 오류:', String(e.message).slice(0, 80)); process.exitCode = 1; } }
  if (PARTS.has('discover')) { try { await discoverPart(); } catch (e) { console.error('[daum-new] 오류:', String(e.message).slice(0, 80)); process.exitCode = 1; } }
  if (PARTS.has('basketball')) { try { await basketballPart(); } catch (e) { console.error('[daum-bk] 오류:', String(e.message).slice(0, 80)); process.exitCode = 1; } }
}

main();

// NAS 상시 라이브 폴러(2026-10-27) — 진행 중인 경기가 있을 때 15~20초 주기로 크롤링해 Firebase Realtime Database 의 live/*_fast 에 직접 게시한다.
// 앱은 GitHub 서버 경로(live/basketball·live/games, 1분 주기)와 이 빠른 경로를 함께 읽어 더 최신인 값을 쓴다. 이 프로그램이 멈추면 앱은 자동으로 느린 경로로 돌아간다.
//
// 동작: 저장소(공개, 읽기 전용 클론)를 받아 두고 15분마다 최신으로 맞춘다 → 매 주기마다
//  · 농구: 진행/곧 시작 경기가 있으면 fetch-basketball.mjs 를 돌려(저장·커밋 없음) → basketball/games.json 에서 라이브 경기만 뽑아 live/basketball_fast 에 게시
//  · 축구·야구 등: 진행/곧 시작 경기가 있는 리그만 — 네이버 기반은 LIVE_ONLY=1 fetch-schedule.mjs, ESPN 축구 39개 리그·MLB 마이너·윈터리그·올림픽 축구·ESPN 야구·아시안게임은 각 크롤러의 LIVE_ONLY 모드 → live-snapshot*.json 을 합쳐 live/games_fast 에 게시
//  경기가 없으면 크롤링 요청을 한 건도 보내지 않는다. 429/차단 조짐이 보이면 해당 소스를 5분 쉬고 Discord 로 알린다.
//
// 쓰기 권한: Realtime Database 전용 비밀키(FIREBASE_DB_SECRET, REST ?auth=) — 서비스 계정(푸시 발송 가능)보다 권한이 훨씬 좁다(라이브 점수만 건드릴 수 있음).
// 환경변수: FIREBASE_DATABASE_URL, FIREBASE_DB_SECRET, [LIVE_INTERVAL_S=20], [REPO_DIR], [DISCORD_WEBHOOK_URL], [DRY_RUN=1]
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectLive, gamesActive, basketballActive, guardScores } from './lib/live-select.mjs';
import { fetchCode } from './lib/fetch-code.mjs';

const REPO = process.env.REPO_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/+$/, '');
const SECRET = process.env.FIREBASE_DB_SECRET || '';
const INTERVAL_MS = Math.max(10, Number(process.env.LIVE_INTERVAL_S) || 20) * 1000;
const DRY = process.env.DRY_RUN === '1';
const SYNC_EVERY_MS = 15 * 60e3;
const PAUSE_MS = 5 * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8')); } catch { return d; } };

function run(args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('node', args, { cwd: REPO, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (b) => { out = (out + b.toString()).slice(-4000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { out += '\n[timeout]'; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

async function putFast(node, payload, fullPath = '') {
  if (DRY || !DB || !SECRET) return;
  const r = await fetch(`${DB}/${fullPath || `live/${node}`}.json?auth=${encodeURIComponent(SECRET)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`RTDB ${node} HTTP ${r.status}`);
}

let lastAlertAt = 0;
async function alert(text) {
  log('ALERT', text);
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook || Date.now() - lastAlertAt < 30 * 60e3) return;
  lastAlertAt = Date.now();
  try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, content: `🟠 ShadeSide — NAS 라이브 폴러\n${text}` }), signal: AbortSignal.timeout(8000) }); } catch { /* 알림 실패는 무시 */ }
}

const pausedUntil = { basketball: 0, naver: 0, espn: 0 };
const failures = { basketball: 0, naver: 0, espn: 0 };
const lastPublished = { games: {}, basketball: {} };
const wasActive = { basketball: false, games: false };

function noteResult(src, res) {
  const limited = /HTTP 429|HTTP 403|too many requests/i.test(res.out);
  if (res.code === 0 && !limited) { failures[src] = 0; return false; }
  failures[src]++;
  log(`크롤링 실패(${src}) code=${res.code}${limited ? ' [요청 제한]' : ''}: ${res.out.replace(/\s+/g, ' ').slice(-600)}`);
  if (limited || failures[src] >= 5) {
    pausedUntil[src] = Date.now() + PAUSE_MS;
    alert(`${src === 'naver' ? '일정(네이버)' : src === 'espn' ? 'ESPN·MLB 마이너' : '농구'} 크롤링이 ${limited ? '요청 제한(429/403)' : '연속 실패'}로 5분간 멈춥니다.`);
    failures[src] = 0;
  }
  return true;
}

async function cycleBasketball() {
  if (Date.now() < pausedUntil.basketball) return;
  const games = (() => { const j = readJson('basketball/games.json', {}); return Array.isArray(j) ? j : j.games || []; })();
  const active = basketballActive(games, Date.now());
  if (!active) {
    if (wasActive.basketball) { wasActive.basketball = false; await putFast('basketball_fast', { ts: Date.now(), games: {} }).catch(() => {}); }
    return;
  }
  wasActive.basketball = true;
  const t0 = Date.now();
  const res = await run(['scripts/fetch-basketball.mjs'], { BASKETBALL_DETAIL_BUDGET: '2', BASKETBALL_RECHECK_MAX: '0' }, 60000);
  if (noteResult('basketball', res)) return;
  const fresh = readJson('basketball/games.json', {});
  const list = Array.isArray(fresh) ? fresh : fresh.games || [];
  const sel = selectLive(list, Date.now());
  await putFast('basketball_fast', { ts: t0, games: sel });
  log(`농구 ${Object.keys(sel).length}경기 게시 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// 축구·야구 등 일정류: 네이버 기반(KBO·K리그·MLB·NPB·유럽 주요 리그 등)은 fetch-schedule 라이브 전용, ESPN 축구(39개 리그)와 MLB 마이너·윈터리그는 각 크롤러의 라이브 전용 모드.
// 각자 "활성 리그만" 조회하고 live-snapshot*.json 을 남기면 여기서 합쳐 live/games_fast 에 한 번에 게시한다(경기가 없으면 요청 없이 즉시 종료).
const ESPN_FAMILY = [
  ['fetch-espn-soccer-leagues', 'espn-soccer-15'],
  ['fetch-espn-world-soccer-leagues', 'espn-world-21'],
  ['fetch-espn-asia-soccer-leagues', 'espn-asia-3'],
  ['fetch-mlb-aaa-baseball', 'mlb-aaa'],
  ['fetch-mlb-winter-baseball', 'mlb-winter'],
  ['fetch-espn-olympic-football', 'olympic-football'],
  ['fetch-espn-baseball', 'espn-baseball'],
  ['fetch-asiangames-baseball', 'ag-baseball'],
  ['fetch-asiangames-football', 'ag-football'],
  ['fetch-wbsc-baseball', 'wbsc'], // 프록시 없이 직접(집 회선) — 오늘 진행/곧 시작하는 대회만 조회
];

const NAVER_LIVE_EVERY_MS = Math.max(10, Number(process.env.NAVER_LIVE_INTERVAL_S) || 30) * 1000;
let lastNaverAt = 0;
let naverCache = null; // { games, events, ts } — 마지막 네이버 라이브 스냅샷(호출을 건너뛴 주기에 재사용)

async function cycleGames() {
  const t0 = Date.now();
  const games = (() => { const j = readJson('games.json', []); return Array.isArray(j) ? j : j.games || []; })();
  const jobs = [];
  const snaps = [];
  const evSnaps = [];
  const collect = (file) => {
    const s = readJson(file, null);
    if (s && typeof s.games === 'object' && typeof s.ts === 'number' && s.ts >= t0 - 1000) {
      snaps.push(s.games);
      if (s.events && typeof s.events === 'object') evSnaps.push(s.events);
    }
  };
  if (Date.now() >= pausedUntil.naver && gamesActive(games, t0)) {
    if (t0 - lastNaverAt >= NAVER_LIVE_EVERY_MS) {
      // 네이버 호출 간격(기본 30초, 2026-10-27 차단 사건 후 20초→30초) — 사이 주기에는 직전 스냅샷을 그대로 합쳐 게시해 값이 깜빡이지 않게 한다.
      lastNaverAt = t0;
      jobs.push((async () => {
        const res = await run(['scripts/fetch-schedule.mjs'], { LIVE_ONLY: '1', BACKFILL_SLICE: '1000' }, 60000);
        if (!noteResult('naver', res)) {
          const before = snaps.length;
          const beforeEv = evSnaps.length;
          collect('live-snapshot.json'); // (동기) — 바로 다음 줄에서 방금 추가된 항목만 집는다
          if (snaps.length > before) naverCache = { games: snaps[snaps.length - 1], events: evSnaps.length > beforeEv ? evSnaps[evSnaps.length - 1] : null, ts: Date.now() };
        }
      })());
    } else if (naverCache && Date.now() - naverCache.ts < 2 * NAVER_LIVE_EVERY_MS + 5000) {
      snaps.push(naverCache.games);
      if (naverCache.events) evSnaps.push(naverCache.events);
    }
  }
  if (Date.now() >= pausedUntil.espn) {
    // 서로 독립이고 대부분 "활성 리그 없음"으로 즉시 끝나므로 병렬로 돌린다(가장 느린 하나의 시간 ≈ 4~8초).
    for (const [file, name] of ESPN_FAMILY) {
      jobs.push((async () => {
        const res = await run([`scripts/${file}.mjs`], { LIVE_ONLY: '1' }, 45000);
        if (!noteResult('espn', res)) collect(`live-snapshot-${name}.json`);
      })());
    }
  }
  await Promise.all(jobs);
  const merged = Object.assign({}, ...snaps);
  const n = Object.keys(merged).length;
  if (n === 0) {
    if (wasActive.games) { wasActive.games = false; lastPublished.games = {}; await putFast('games_fast', { ts: Date.now(), games: {} }).catch(() => {}); }
    return;
  }
  wasActive.games = true;
  const guarded = guardScores(lastPublished.games, merged);
  lastPublished.games = JSON.parse(JSON.stringify(merged));
  await putFast('games_fast', { ts: t0, games: merged });
  // 알림 감지용 전체 이벤트(득점자·카드·하이라이트·선발투수) — 앱이 읽지 않는 비공개 경로. 알림 작업(GitHub 서버)이 서비스 계정으로 읽어 커밋된 games.json 위에 덮어 감지한다.
  await putFast('events_games', { ts: t0, games: Object.assign({}, ...evSnaps) }, 'events/games');
  log(`일정 ${n}경기 게시${guarded ? ` (0-0 역행 ${guarded}건 보정)` : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// 데몬 자신의 코드(이 파일·lib)가 바뀌면 재시작해 새 코드를 쓴다 — 컨테이너가 restart: unless-stopped 라 종료하면 다시 뜨고, 시작 때 최신 코드로 맞춘다(사람이 NAS 를 만질 필요 없음).
const codeHash = () => {
  try {
    const h = crypto.createHash('sha1');
    for (const f of ['scripts/live-daemon.mjs', 'scripts/lib/live-select.mjs', 'scripts/lib/live-only.mjs']) h.update(fs.readFileSync(path.join(REPO, f)));
    return h.digest('hex');
  } catch { return ''; }
};
const START_HASH = codeHash();

async function syncRepo() {
  try {
    if (!fs.existsSync(path.join(REPO, '.git'))) return;
    execFileSync('git', ['fetch', '--depth', '1', 'origin', 'main'], { cwd: REPO, stdio: 'ignore', timeout: 60000 });
    execFileSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: REPO, stdio: 'ignore', timeout: 60000 });
    // 비공개 크롤러 코드(CODE_TOKEN 이 있을 때): 공개 저장소에서 scripts/ 가 빠진 뒤에도 최신 코드를 쓴다. 실패하면 기존 scripts/ 유지.
    if (process.env.CODE_TOKEN) {
      const r = await fetchCode({ token: process.env.CODE_TOKEN, dest: REPO });
      if (!r.ok) log('비공개 코드 최신화 실패(기존 코드 유지):', r.reason);
    }
    log('저장소 최신화 완료');
    const now = codeHash();
    if (START_HASH && now && now !== START_HASH) { log('데몬 코드가 바뀌어 재시작합니다'); process.exit(0); }
  } catch (e) {
    log('저장소 최신화 실패(다음 주기에 재시도):', String(e.message).slice(0, 80));
  }
}

// 시작 시 외부 접속 자가점검 — 크롤링이 연속 실패/시간 초과일 때 원인(DNS·차단·느림)을 로그로 바로 알 수 있게 한다.
async function netSelfTest() {
  const targets = [['github', 'https://api.github.com/'], ['espn', 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'], ['naver', 'https://sports.naver.com/'], ['rtdb', `${DB || 'https://example.invalid'}/live/basketball/ts.json`]];
  await Promise.all(targets.map(async ([name, url]) => {
    const t = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      log(`[자가점검] ${name} HTTP ${r.status} ${Date.now() - t}ms`);
    } catch (e) {
      log(`[자가점검] ${name} 실패 ${Date.now() - t}ms: ${String(e.cause?.code || e.cause?.message || e.message).slice(0, 80)}`);
    }
  }));
  log(`[자가점검] 메모리 RSS ${Math.round(process.memoryUsage().rss / 1048576)}MB, node ${process.version}`);
}

async function main() {
  netSelfTest().catch(() => {});
  log(`시작: 주기 ${INTERVAL_MS / 1000}s, repo=${REPO}${DRY ? ' [DRY_RUN]' : ''}${DB && SECRET ? '' : ' [게시 설정 없음 — 게시 안 함]'}`);
  let lastSync = Date.now();
  let cycle = 0;
  for (;;) {
    const t0 = Date.now();
    try {
      if (t0 - lastSync > SYNC_EVERY_MS) { await syncRepo(); lastSync = Date.now(); }
      // 농구와 일정(네이버)은 서로 독립이라 동시에 돌린다.
      await Promise.all([cycleBasketball().catch((e) => log('농구 주기 오류:', String(e.message).slice(0, 100))), cycleGames().catch((e) => log('일정 주기 오류:', String(e.message).slice(0, 100)))]);
    } catch (e) {
      log('주기 오류:', String(e.message).slice(0, 100));
    }
    if (++cycle % 30 === 0) log(`동작 중 (${cycle}회, 농구 ${wasActive.basketball ? '활성' : '대기'}, 일정 ${wasActive.games ? '활성' : '대기'})`);
    await sleep(Math.max(2000, INTERVAL_MS - (Date.now() - t0)));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();

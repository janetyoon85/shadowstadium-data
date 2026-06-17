import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from './validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const SEASON_START = '2026-03-01';
const SEASON_END = '2026-11-30';
const PAGE_SIZE = 200;
const REQUEST_DELAY_MS = 1100;
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const API_BASE = 'https://api-gw.sports.naver.com/schedule/games';
const RECORD_API = (gameId) => `${API_BASE}/${gameId}/record`;
const RELAY_API = (gameId) => `${API_BASE}/${gameId}/relay`;
// 세이브 투수 캐시 — schedule API 엔 세이브 필드가 없어 게임당 /record 1요청이 필요.
// 종료 경기는 결과가 불변이라 gameId→savePitcher(없으면 null)로 캐시 후 신규 종료분만 fetch.
const SAVES_PATH = path.join(REPO_ROOT, 'saves.json');
// 축구 득점자 캐시 — schedule API 엔 득점자 없어 게임당 /relay 1요청.
// gameId→{home:[{m,n,pk?}],away:[...]} (0-0 면 빈 배열) 캐시 후 신규 종료분만 fetch.
const SCORERS_PATH = path.join(REPO_ROOT, 'scorers.json');
const SOCCER_LEAGUES = new Set(['K리그1', 'K리그2']);

const CATEGORIES = [
  { categoryId: 'kbo', upperCategoryId: 'kbaseball', league: 'KBO' },
  { categoryId: 'kleague', upperCategoryId: 'kfootball', league: 'K리그1' },
  { categoryId: 'kleague2', upperCategoryId: 'kfootball', league: 'K리그2' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(cat, page) {
  // baseball 필드 → KBO 응답에 home/awayStarterName(선발투수) 포함. 발표 전(경기 전날 밤 10시 이전)
  // 이면 빈 문자열로 옴 → convertGame 에서 비어있으면 누락. K리그엔 해당 필드 없음(무시).
  const url = `${API_BASE}?fromDate=${SEASON_START}&toDate=${SEASON_END}&upperCategoryId=${cat.upperCategoryId}&categoryId=${cat.categoryId}&fields=basic,stadium,baseball&size=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${cat.categoryId} page=${page}`);
  const json = await res.json();
  if (!json.success) throw new Error(`API error for ${cat.categoryId}: code=${json.code}`);
  return json.result;
}

async function fetchCategory(cat) {
  console.log(`[${cat.categoryId}] fetching ${SEASON_START} ~ ${SEASON_END}`);
  const p1 = await fetchPage(cat, 1);
  const total = p1.gameTotalCount;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  console.log(`[${cat.categoryId}] total=${total}, pages=${pages}`);
  const all = [...p1.games];
  for (let p = 2; p <= pages; p++) {
    await sleep(REQUEST_DELAY_MS);
    const pd = await fetchPage(cat, p);
    all.push(...pd.games);
    console.log(`[${cat.categoryId}] page ${p}/${pages} (+${pd.games.length})`);
  }
  return all;
}

function convertGame(n, cat, stadiumMap, mapFailures) {
  const dt = n.gameDateTime || '';
  const time = dt.includes('T') ? dt.split('T')[1].slice(0, 5) : '00:00';
  const catMap = stadiumMap[cat.categoryId] || {};
  const stadium = n.stadium || '';
  const venueId = catMap[stadium] || '';
  if (!venueId && stadium) {
    mapFailures.push({ categoryId: cat.categoryId, stadium });
  }
  let status = 'scheduled';
  if (n.cancel) status = 'cancelled';
  else if (n.statusCode === 'RESULT') status = 'completed';

  const game = {
    date: n.gameDate,
    time,
    league: cat.league,
    venueId,
    home: n.homeTeamName,
    away: n.awayTeamName,
    stadium,
    timeTbd: false,
    gameId: n.gameId,
    status,
  };
  // 선발투수 — KBO 만, 발표된(비어있지 않은) 경우만. away/home 모두 있을 때만 의미 있게 표시되지만
  // 데이터는 각각 있는 대로 저장(앱이 양쪽 다 있을 때만 렌더).
  if (cat.league === 'KBO') {
    const away = (n.awayStarterName || '').trim();
    const home = (n.homeStarterName || '').trim();
    if (away) game.awayPitcher = away;
    if (home) game.homePitcher = home;
  }
  // 최종 스코어 — 종료(RESULT) 경기만. 야구·축구 공통 (awayTeamScore/homeTeamScore).
  // away/home 은 위 away/home 팀명과 같은 출처라 점수도 같은 정렬로 짝지어짐.
  if (status === 'completed') {
    if (typeof n.awayTeamScore === 'number') game.awayScore = n.awayTeamScore;
    if (typeof n.homeTeamScore === 'number') game.homeScore = n.homeTeamScore;
    // 승/패 투수 — KBO 종료 경기만. schedule API 의 win/losePitcherName 에 이미 포함(추가 요청 0).
    // 무승부(DRAW)면 둘 다 빈 문자열 → 누락(앱이 둘 다 있을 때만 렌더). 세이브는 schedule API 에
    // 없어 별도 /record 엔드포인트로 enrichSaves 에서 채움.
    if (cat.league === 'KBO') {
      const wp = (n.winPitcherName || '').trim();
      const lp = (n.losePitcherName || '').trim();
      if (wp) game.winPitcher = wp;
      if (lp) game.losePitcher = lp;
    }
  }
  return game;
}

function assignDoubleheaderNum(games) {
  const groups = new Map();
  for (const g of games) {
    const key = `${g.date}|${g.stadium}|${g.home}|${g.away}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  let dhCount = 0;
  const dhSamples = [];
  for (const [key, grp] of groups) {
    if (grp.length === 2) {
      grp.sort((a, b) => a.time.localeCompare(b.time));
      grp[0].doubleheaderNum = 1;
      grp[1].doubleheaderNum = 2;
      dhCount++;
      if (dhSamples.length < 10) dhSamples.push({ key, times: grp.map((g) => g.time) });
    } else if (grp.length > 2) {
      console.warn(`[warn] group size ${grp.length} for ${key} — skipping doubleheader assignment`);
    }
  }
  return { count: dhCount, samples: dhSamples };
}

function sortGames(games) {
  games.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    if (a.league !== b.league) return a.league < b.league ? -1 : 1;
    if (a.venueId !== b.venueId) return a.venueId < b.venueId ? -1 : 1;
    const da = a.doubleheaderNum ?? 0;
    const db = b.doubleheaderNum ?? 0;
    return da - db;
  });
}

// /record 엔드포인트의 pitchingResult[].wls 에서 세이브(wls==='S') 투수명 추출.
// 세이브 없는 경기(대부분)·DRAW → null. name 은 성만(예: '조동욱') — schedule 투수명과 동일 표기.
async function fetchSavePitcher(gameId) {
  const res = await fetch(RECORD_API(gameId), { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} record ${gameId}`);
  const json = await res.json();
  const pr = json?.result?.recordData?.pitchingResult;
  if (!Array.isArray(pr)) return null;
  const sv = pr.find((p) => p && p.wls === 'S');
  if (!sv) return null;
  const name = (sv.name || '').trim();
  return name || null;
}

// 종료 KBO 경기에 세이브 투수(savePitcher) 부착. saves.json 캐시로 신규 종료분만 /record fetch.
// graceful: /record 실패한 게임은 캐시 안 함(다음 run 재시도) + savePitcher 미부착(승/패 점수는 유지).
// 캐시는 현 데이터셋의 종료 KBO gameId 로 prune — 시즌 넘어가도 무한 증식 방지.
async function enrichSaves(allGames) {
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(SAVES_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[saves] no saves.json yet — backfilling from scratch');
  }

  const targets = allGames.filter(
    (g) => g.league === 'KBO' && g.status === 'completed' && g.gameId,
  );
  let fromCache = 0;
  let fetched = 0;
  let failed = 0;

  for (const g of targets) {
    if (!Object.prototype.hasOwnProperty.call(cache, g.gameId)) {
      try {
        await sleep(REQUEST_DELAY_MS);
        cache[g.gameId] = await fetchSavePitcher(g.gameId);
        fetched++;
      } catch (e) {
        failed++;
        console.warn(`[saves] fetch failed ${g.gameId}: ${e.message}`);
        continue; // 캐시 안 함 → 다음 run 재시도. savePitcher 미부착.
      }
    } else {
      fromCache++;
    }
    const sv = cache[g.gameId];
    if (sv) g.savePitcher = sv;
  }

  // prune: 현 데이터셋의 종료 KBO gameId 만 남김 (캐시한 값이 있는 것만).
  const validIds = new Set(targets.map((g) => g.gameId));
  const pruned = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) pruned[id] = cache[id];
  }
  await fs.writeFile(SAVES_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf-8');

  const withSave = targets.filter((g) => g.savePitcher).length;
  console.log(
    `[saves] completedKBO=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} withSave=${withSave}`,
  );
}

// scorePlayer HTML(<li>[time]이름[time]</li> 반복) → [{m,n}]. 골 1개=li 1개, 순서·개수는 스코어와 일치.
// home: "이름 <span class='time'>MM:SS</span>", away: "<span class='time'>MM:SS</span> 이름" — 위치 달라도 동일 파싱.
function parseScorerHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  for (const chunk of html.split('<li>').slice(1)) {
    const li = chunk.split('</li>')[0];
    const tm = li.match(/<span class='time'>(\d+):\d+<\/span>/);
    const m = tm ? parseInt(tm[1], 10) : null;
    const n = li.replace(/<span class='time'>[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '').trim();
    if (!n) continue;
    out.push(m != null ? { m, n } : { n });
  }
  return out;
}

// 종료 축구 경기 /relay 1요청에서 득점자 추출.
// - 득점/분/팀: homeScorePlayer/awayScorePlayer (전 경기 완전, 스코어와 일치, 절대분 MM:SS).
// - PK: 기본 relay(후반) textRelays 의 eventType==='PK' 선수명 집합 + 후반(m>45) 매칭만 표기.
//   1전반 PK 는 미표기(graceful·드묾). 모르는 eventType 은 그냥 무시 → 크래시·오표기 없음.
async function fetchScorers(gameId) {
  const res = await fetch(RELAY_API(gameId), { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} relay ${gameId}`);
  const json = await res.json();
  const d = json?.result?.textRelayData;
  if (!d) return { home: [], away: [] };
  const home = parseScorerHtml(d.homeScorePlayer);
  const away = parseScorerHtml(d.awayScorePlayer);
  // 후반 PK 선수명 집합 (오표기 방지: 후반 골에만 적용).
  const pkNames = new Set(
    (Array.isArray(d.textRelays) ? d.textRelays : [])
      .filter((e) => e && e.eventType === 'PK' && e.playerName)
      .map((e) => e.playerName.trim()),
  );
  const flag = (arr) => arr.map((s) => (s.m != null && s.m > 45 && pkNames.has(s.n) ? { ...s, pk: true } : s));
  return { home: flag(home), away: flag(away) };
}

// 종료 축구 경기에 득점자(scorers) 부착. scorers.json 캐시로 신규 종료분만 /relay fetch.
// graceful: 실패 게임은 캐시 안 함(다음 run 재시도)+미부착(점수 유지). 0골 경기는 미부착.
async function enrichScorers(allGames) {
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(SCORERS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[scorers] no scorers.json yet — backfilling from scratch');
  }

  const targets = allGames.filter(
    (g) => SOCCER_LEAGUES.has(g.league) && g.status === 'completed' && g.gameId,
  );
  let fromCache = 0;
  let fetched = 0;
  let failed = 0;

  for (const g of targets) {
    if (!Object.prototype.hasOwnProperty.call(cache, g.gameId)) {
      try {
        await sleep(REQUEST_DELAY_MS);
        cache[g.gameId] = await fetchScorers(g.gameId);
        fetched++;
      } catch (e) {
        failed++;
        console.warn(`[scorers] fetch failed ${g.gameId}: ${e.message}`);
        continue; // 캐시 안 함 → 다음 run 재시도. scorers 미부착.
      }
    } else {
      fromCache++;
    }
    const sc = cache[g.gameId];
    if (sc && ((sc.home && sc.home.length) || (sc.away && sc.away.length))) g.scorers = sc;
  }

  // prune: 현 데이터셋의 종료 축구 gameId 만 남김.
  const validIds = new Set(targets.map((g) => g.gameId));
  const pruned = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) pruned[id] = cache[id];
  }
  await fs.writeFile(SCORERS_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf-8');

  const withScorers = targets.filter((g) => g.scorers).length;
  console.log(
    `[scorers] completedSoccer=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} withScorers=${withScorers}`,
  );
}

function serializeGame(g) {
  const out = {
    date: g.date,
    time: g.time,
    league: g.league,
    venueId: g.venueId,
    home: g.home,
    away: g.away,
    stadium: g.stadium,
    timeTbd: g.timeTbd,
    gameId: g.gameId,
    status: g.status,
  };
  if (g.rescheduledTo) out.rescheduledTo = g.rescheduledTo;
  if (g.doubleheaderNum) out.doubleheaderNum = g.doubleheaderNum;
  if (g.awayPitcher) out.awayPitcher = g.awayPitcher;
  if (g.homePitcher) out.homePitcher = g.homePitcher;
  // 0 도 유효 점수라 typeof 가드 (falsy 체크 금지).
  if (typeof g.awayScore === 'number') out.awayScore = g.awayScore;
  if (typeof g.homeScore === 'number') out.homeScore = g.homeScore;
  // 종료 경기 승/패/세 투수 (KBO). 있는 것만 — 무승부·세이브 없는 경기는 일부/전부 누락.
  if (g.winPitcher) out.winPitcher = g.winPitcher;
  if (g.losePitcher) out.losePitcher = g.losePitcher;
  if (g.savePitcher) out.savePitcher = g.savePitcher;
  // 축구 득점자 — 종료 경기, 골 있을 때만. {home,away} 각 [{m,n,pk?}].
  if (g.scorers) out.scorers = g.scorers;
  return out;
}

async function main() {
  const startMs = Date.now();
  console.log(`[start] ${new Date().toISOString()}`);

  const stadiumMap = JSON.parse(await fs.readFile(path.join(__dirname, 'naverStadiumMap.json'), 'utf-8'));

  const allGames = [];
  const mapFailures = [];
  const categoryCounts = {};

  for (const cat of CATEGORIES) {
    const raw = await fetchCategory(cat);
    const converted = raw.map((g) => convertGame(g, cat, stadiumMap, mapFailures));
    categoryCounts[cat.league] = converted.length;
    allGames.push(...converted);
    await sleep(REQUEST_DELAY_MS);
  }

  const uniqueFails = Array.from(
    new Map(mapFailures.map((f) => [`${f.categoryId}::${f.stadium}`, f])).values(),
  );
  if (uniqueFails.length > 0) {
    console.warn(`\n[mapping failures] ${uniqueFails.length} distinct stadium texts:`);
    for (const f of uniqueFails) console.warn(`  ${f.categoryId} → "${f.stadium}"`);
  } else {
    console.log(`\n[mapping] all stadium texts mapped successfully`);
  }

  const dh = assignDoubleheaderNum(allGames);
  console.log(`\n[doubleheader] ${dh.count} groups detected`);
  for (const s of dh.samples) console.log(`  ${s.key} → ${s.times.join(', ')}`);

  // Merge manually-curated entries (e.g. KBO 올스타전 — Naver가 publish 안 한 경기).
  // Dedup 키: (date+venueId+league) — Naver가 추후 같은 슬롯을 자체 gameId로 publish 하면
  // 크롤링 데이터가 우선 채택되고 manual 엔트리는 자동으로 빠짐 (중복 2건 방지).
  const manualPath = path.join(REPO_ROOT, 'manual_games.json');
  let manualAdded = 0;
  let manualTotal = 0;
  try {
    const manualGames = JSON.parse(await fs.readFile(manualPath, 'utf-8'));
    manualTotal = manualGames.length;
    const crawledSlots = new Set(allGames.map((g) => `${g.date}|${g.venueId}|${g.league}`));
    for (const m of manualGames) {
      const slot = `${m.date}|${m.venueId}|${m.league}`;
      if (crawledSlots.has(slot)) {
        console.warn(`[manual] slot ${slot} already crawled — skipping manual entry (gameId=${m.gameId})`);
        continue;
      }
      allGames.push(m);
      manualAdded++;
    }
    console.log(`\n[manual] merged ${manualAdded}/${manualTotal} entries from manual_games.json`);
  } catch (e) {
    if (e.code === 'ENOENT') console.log(`\n[manual] no manual_games.json (optional)`);
    else throw e;
  }

  // 세이브 투수 부착 (종료 KBO만, /record 캐시). 네트워크 단계라 sort/serialize 전에 1회.
  await enrichSaves(allGames);
  // 축구 득점자 부착 (종료 K리그만, /relay 캐시).
  await enrichScorers(allGames);

  sortGames(allGames);

  // Save staging artifact (with metadata)
  const stagingPath = path.join(__dirname, 'staging.json');
  await fs.writeFile(
    stagingPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        seasonRange: { from: SEASON_START, to: SEASON_END },
        totalGames: allGames.length,
        categoryCounts,
        mappingFailures: uniqueFails,
        doubleheaderCount: dh.count,
        manualAddedCount: manualAdded,
        games: allGames.map(serializeGame),
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\n[staging] saved to ${stagingPath}`);

  // Validate
  const result = validateDataset(allGames);
  console.log(`\n[validator] valid=${result.valid}, total=${result.totalGames}, counts=`, result.counts);
  if (result.errors.length > 0) {
    console.error('Errors:');
    for (const e of result.errors) console.error(`  ${e}`);
  }
  if (result.warnings.length > 0) {
    console.warn('Warnings:');
    for (const w of result.warnings) console.warn(`  ${w}`);
  }

  if (!result.valid) {
    console.error(`\n[fail] validator rejected — games_2026.json NOT updated`);
    process.exit(1);
  }

  const prodPath = path.join(REPO_ROOT, 'games_2026.json');
  const exportGames = allGames.filter((g) => g.venueId);
  const filteredOut = allGames.length - exportGames.length;
  const serialized = exportGames.map(serializeGame);
  await fs.writeFile(prodPath, JSON.stringify(serialized, null, 2) + '\n', 'utf-8');
  console.log(`\n[update] ${prodPath} replaced (${serialized.length} games, ${filteredOut} filtered out for missing venueId)`);

  const dur = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[done] ${new Date().toISOString()} (${dur}s)`);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});

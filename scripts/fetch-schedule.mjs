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

const CATEGORIES = [
  { categoryId: 'kbo', upperCategoryId: 'kbaseball', league: 'KBO' },
  { categoryId: 'kleague', upperCategoryId: 'kfootball', league: 'K리그1' },
  { categoryId: 'kleague2', upperCategoryId: 'kfootball', league: 'K리그2' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(cat, page) {
  const url = `${API_BASE}?fromDate=${SEASON_START}&toDate=${SEASON_END}&upperCategoryId=${cat.upperCategoryId}&categoryId=${cat.categoryId}&fields=basic,stadium&size=${PAGE_SIZE}&page=${page}`;
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

// 순위표(ESPN 전용 이색 리그, 2026-09-26) — fetch-standings.mjs(Naver)는 Naver가 아예 취급하지
// 않는 ~38개 리그(콜롬비아·리가MX·베네수엘라·웨일스·나이지리아 등, fetch-espn-soccer-leagues.mjs
// 계열 3개 크롤러가 경기 일정을 담당하는 바로 그 리그들)를 커버 못함 — ESPN이 이 리그들의 순위도
// 이미 제공하는 걸 확인(https://site.api.espn.com/apis/v2/sports/soccer/{slug}/standings).
// 주의: 이 엔드포인트는 브라우저 위장 UA(Mozilla/5.0 등)를 Akamai WAF가 403으로 차단하고, 이
// 크롤러들이 이미 쓰는 커스텀 UA로만 통과됨(실측 확인, 기존 fetch-espn-*-soccer-leagues.mjs와
// 동일 교훈).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAMS as BATCH1_TEAMS, normalizeTeamName } from './espn-soccer-teams.mjs';
import { BATCH2_TEAMS } from './espn-world-soccer-teams.mjs';
import { ASIA_TEAMS } from './espn-asia-soccer-teams.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const STANDINGS_PATH = path.join(REPO_ROOT, 'standings.json');
const REQUEST_DELAY_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 세 크롤러(fetch-espn-soccer-leagues/world/asia)의 LEAGUES 배열과 동일 — 어느 팀명 사전을
// 쓰는지만 다름. 코드 값이 바뀌면 세 크롤러와 여기 전부 같이 고쳐야 함(기존 서버스 whitelist
// 함정과 같은 클래스).
const LEAGUES = [
  { code: 'BRASILEIRAO', slug: 'bra.1', dict: BATCH1_TEAMS },
  { code: 'ARGENTINA', slug: 'arg.1', dict: BATCH1_TEAMS },
  { code: 'LIGAMX', slug: 'mex.1', dict: BATCH1_TEAMS },
  { code: 'PORTUGAL', slug: 'por.1', dict: BATCH1_TEAMS },
  { code: 'BELGIUM', slug: 'bel.1', dict: BATCH1_TEAMS },
  { code: 'TURKEY', slug: 'tur.1', dict: BATCH1_TEAMS },
  { code: 'GREECE', slug: 'gre.1', dict: BATCH1_TEAMS },
  { code: 'AUSTRIA', slug: 'aut.1', dict: BATCH1_TEAMS },
  { code: 'NORWAY', slug: 'nor.1', dict: BATCH1_TEAMS },
  { code: 'SWEDEN', slug: 'swe.1', dict: BATCH1_TEAMS },
  { code: 'COLOMBIA', slug: 'col.1', dict: BATCH1_TEAMS },
  { code: 'URUGUAY', slug: 'uru.1', dict: BATCH1_TEAMS },
  { code: 'CHILE', slug: 'chi.1', dict: BATCH1_TEAMS },
  { code: 'AUSTRALIA', slug: 'aus.1', dict: BATCH1_TEAMS },
  { code: 'VENEZUELA', slug: 'ven.1', dict: BATCH2_TEAMS },
  { code: 'ECUADOR', slug: 'ecu.1', dict: BATCH2_TEAMS },
  { code: 'PERU', slug: 'per.1', dict: BATCH2_TEAMS },
  { code: 'BOLIVIA', slug: 'bol.1', dict: BATCH2_TEAMS },
  { code: 'PARAGUAY', slug: 'par.1', dict: BATCH2_TEAMS },
  { code: 'COSTARICA', slug: 'crc.1', dict: BATCH2_TEAMS },
  { code: 'ELSALVADOR', slug: 'slv.1', dict: BATCH2_TEAMS },
  { code: 'WALES', slug: 'wal.1', dict: BATCH2_TEAMS },
  { code: 'NORTHERNIRELAND', slug: 'nir.1', dict: BATCH2_TEAMS },
  { code: 'CYPRUS', slug: 'cyp.1', dict: BATCH2_TEAMS },
  { code: 'MALTA', slug: 'mlt.1', dict: BATCH2_TEAMS },
  { code: 'RUSSIA', slug: 'rus.1', dict: BATCH2_TEAMS },
  { code: 'MALAYSIA', slug: 'mys.1', dict: BATCH2_TEAMS },
  { code: 'SINGAPORE', slug: 'sgp.1', dict: BATCH2_TEAMS },
  { code: 'ISRAEL', slug: 'isr.1', dict: BATCH2_TEAMS },
  { code: 'SOUTHAFRICA', slug: 'rsa.1', dict: BATCH2_TEAMS },
  { code: 'NIGERIA', slug: 'nga.1', dict: BATCH2_TEAMS },
  { code: 'GHANA', slug: 'gha.1', dict: BATCH2_TEAMS },
  { code: 'KENYA', slug: 'ken.1', dict: BATCH2_TEAMS },
  { code: 'UGANDA', slug: 'uga.1', dict: BATCH2_TEAMS },
  { code: 'ZIMBABWE', slug: 'zim.1', dict: BATCH2_TEAMS },
  { code: 'THAILAND', slug: 'tha.1', dict: ASIA_TEAMS },
  { code: 'INDONESIA', slug: 'idn.1', dict: ASIA_TEAMS },
  { code: 'INDIA', slug: 'ind.1', dict: ASIA_TEAMS },
];

async function fetchStandings(slug) {
  const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${slug}`);
  return res.json();
}

// ESPN stats 배열은 [{name, value, displayValue}, ...] — name으로 찾아 값만 뽑음.
function statValue(stats, name) {
  const s = (stats || []).find((x) => x.name === name);
  return typeof s?.value === 'number' ? s.value : undefined;
}

function pickRow(entry, fallbackRank, teamMap, groupName) {
  const stats = entry.stats || [];
  const enName = entry.team?.displayName || entry.team?.name || '';
  const info = teamMap[normalizeTeamName(enName)];
  const row = {
    team: info?.ko || enName,
    rank: statValue(stats, 'rank') ?? fallbackRank,
    played: statValue(stats, 'gamesPlayed'),
    win: statValue(stats, 'wins'),
    draw: statValue(stats, 'ties'),
    loss: statValue(stats, 'losses'),
    pts: statValue(stats, 'points'),
    gd: statValue(stats, 'pointDifferential'),
  };
  if (groupName) row.group = groupName;
  return row;
}

// 팀기록(2026-09-26) — ESPN standings 응답엔 Naver처럼 슈팅·점유율 같은 세부 스탯이 없고
// 득점/실점(pointsFor/pointsAgainst)만 있음(실측 확인, 시즌 통산 슈팅/점유율은 별도 대량 집계가
// 필요해서 이번엔 스코프 아웃) — 그래서 이 리그들 팀기록은 득점/실점만, 이미 받은 stats
// 재사용이라 추가 요청 없음. 선수기록(득점왕 등)은 이 API에서 시즌 집계를 못 찾아서 미지원.
function pickTeamRecord(entry, teamMap) {
  const stats = entry.stats || [];
  const enName = entry.team?.displayName || entry.team?.name || '';
  const info = teamMap[normalizeTeamName(enName)];
  return {
    team: info?.ko || enName,
    goals: statValue(stats, 'pointsFor'),
    goalsConceded: statValue(stats, 'pointsAgainst'),
  };
}

async function main() {
  let out = {};
  try {
    out = JSON.parse(await fs.readFile(STANDINGS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  let ok = 0;
  let empty = 0;
  let failed = 0;
  for (const lg of LEAGUES) {
    try {
      const json = await fetchStandings(lg.slug);
      // children이 있으면 스테이지/컨퍼런스별로 나뉜 것(예: 콜롬비아 Apertura/Clausura) — 없으면
      // json.standings에 바로 entries가 있는 단일 테이블.
      const children = Array.isArray(json.children) && json.children.length > 0
        ? json.children
        : [{ name: null, standings: json.standings }];
      const teamMap = lg.dict[lg.code] || {};
      const rows = [];
      const teamRecords = [];
      for (const child of children) {
        const entries = child.standings?.entries || [];
        const multiGroup = children.length > 1;
        entries.forEach((entry, i) => {
          rows.push(pickRow(entry, i + 1, teamMap, multiGroup ? child.name : undefined));
          teamRecords.push(pickTeamRecord(entry, teamMap));
        });
      }
      if (rows.length === 0) {
        console.log(`[espn-standings] ${lg.code}: 0 rows`);
        empty++;
        continue;
      }
      out[lg.code] = { updatedAt: new Date().toISOString(), seasonCode: 'espn', rows, teamRecords };
      console.log(`[espn-standings] ${lg.code}: ${rows.length} rows`);
      ok++;
    } catch (e) {
      console.warn(`[espn-standings] ${lg.code} failed: ${e.message}`);
      failed++;
    }
    await sleep(REQUEST_DELAY_MS);
  }
  await fs.writeFile(STANDINGS_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`[espn-standings] done — ok=${ok} empty=${empty} failed=${failed} → ${STANDINGS_PATH}`);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});

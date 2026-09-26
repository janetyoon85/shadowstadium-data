// 순위표(리그 테이블) 크롤러 — Naver Sports 통계 API 재사용.
// 2026-09-26 조사로 발견: https://api-gw.sports.naver.com/statistics/categories/{categoryId}
// 밑에 두 엔드포인트가 축구·야구 구분 없이 전부 동일 스키마로 동작함(실측 확인):
//   /seasons                          → 그 카테고리의 시즌 목록(과거~현재), isSeason:'Y'가 진행중 시즌
//   /seasons/{seasonCode}/teams       → 그 시즌의 팀별 순위/기록 전체(조별 대회는 group 필드 포함)
// KBO/K리그처럼 연 단위 리그는 seasonCode가 그냥 연도("2026")지만, 월드컵/UCL 등 대회형은
// 대회마다 바뀌는 opaque 코드라 항상 /seasons로 먼저 조회해서 현재 시즌을 찾음(수동 하드코딩 불필요).
//
// fetch-schedule.mjs와 다른 별도 워크플로(몇 시간 주기) — 순위는 경기 하나 끝난다고 매번 안 바뀌니
// 5분 주기 크론(스코어/카드/하이라이트)과 예산 경합시킬 이유가 없음.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const BASE = 'https://api-gw.sports.naver.com/statistics/categories';
const REQUEST_DELAY_MS = 250;
const STANDINGS_PATH = path.join(REPO_ROOT, 'standings.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch-schedule.mjs의 CATEGORIES 사본(categoryId만 필요) — 그 파일은 최상위에서 main()을 바로
// 실행해버려서(import 시 크롤링이 통째로 같이 도는 부작용) import 대신 부득이 복사 유지.
// 리그 추가/코드 변경 시 양쪽 다 갱신 필요(기존 ESPN 크롤러 3개와 같은 클래스의 제약).
const CATEGORIES = [
  { categoryId: 'kbo', league: 'KBO' },
  { categoryId: 'kleague', league: 'K리그1' },
  { categoryId: 'kleague2', league: 'K리그2' },
  { categoryId: 'mlb', league: 'MLB' },
  { categoryId: 'npb', league: 'NPB' },
  { categoryId: 'epl', league: 'EPL' },
  { categoryId: 'england2', league: 'EFL' },
  { categoryId: 'primera', league: 'LALIGA' },
  { categoryId: 'bundesliga', league: 'BUNDESLIGA' },
  { categoryId: 'seria', league: 'SERIEA' },
  { categoryId: 'ligue1', league: 'LIGUE1' },
  { categoryId: 'eredivisie', league: 'EREDIVISIE' },
  { categoryId: 'mls', league: 'MLS' },
  { categoryId: 'spl', league: 'SCOTLAND' },
  { categoryId: 'denmark', league: 'DENMARK' },
  { categoryId: 'saudiarabia', league: 'SAUDI' },
  { categoryId: 'jleague', league: 'J1' },
  { categoryId: 'champs', league: 'UCL' },
  { categoryId: 'europa', league: 'UEL' },
  { categoryId: 'uecl', league: 'UECL' },
  { categoryId: 'acl', league: 'ACL' },
  { categoryId: 'acl2', league: 'ACL2' },
  { categoryId: 'worldcup', league: 'WORLDCUP' },
  { categoryId: 'africacup', league: 'AFRICACUP' },
  { categoryId: 'u17worldcup', league: 'U17WORLDCUP' },
  { categoryId: 'concacafcup', league: 'CONCACAFCUP' },
  { categoryId: 'unl', league: 'UNL' },
  { categoryId: 'wcquefa', league: 'WCQUEFA' },
  { categoryId: 'wcqafc', league: 'WCQAFC' },
  { categoryId: 'asiancup', league: 'ASIANCUP' },
  { categoryId: 'u17asiancup', league: 'U17ASIANCUP' },
  { categoryId: 'u20asiancup', league: 'U20ASIANCUP' },
  { categoryId: 'u23asiancup', league: 'U23ASIANCUP' },
  { categoryId: 'womenasiancup', league: 'WOMENASIANCUP' },
  { categoryId: 'u20womenasiancup', league: 'U20WOMENASIANCUP' },
  { categoryId: 'affcup', league: 'AFFCUP' },
  { categoryId: 'e1men', league: 'E1MEN' },
  { categoryId: 'e1women', league: 'E1WOMEN' },
  { categoryId: 'copaamerica', league: 'COPAAMERICA' },
  { categoryId: 'clubworldcup', league: 'CLUBWORLDCUP' },
  { categoryId: 'uefaeuro', league: 'UEFAEURO' },
  { categoryId: 'u20worldcup', league: 'U20WORLDCUP' },
  { categoryId: 'u20womenworldcup', league: 'U20WOMENWORLDCUP' },
  { categoryId: 'u17womenasiancup', league: 'U17WOMENASIANCUP' },
  { categoryId: 'premier12', league: 'PREMIER12' },
];

// 단판/순수 토너먼트/친선 — "순위표" 개념 자체가 없어 API에 물어봐도 의미 없는 데이터라 제외.
const EXCLUDE_LEAGUES = new Set([
  'FACUP', 'DFBPOKAL', 'COUPEDEFRANCE', 'COPADELREY', 'COPPAITALIA', 'COMMUNITYSHIELD',
  'UEFASUPERCUP', 'GERMANSUPERCUP', 'SPANISHSUPERCUP', 'ITALIANSUPERCUP', 'FRENCHSUPERCUP',
  'EFLCUP', 'CLUBFRIENDLY', 'AMATCHFRIENDLY', 'HYBRIDFRIENDLY', 'KOREACUP',
  'INTERCONTINENTALCUP', 'KLEAGUESUPERCUP',
]);

// isSeason:'Y'가 보통 "현재 진행중 시즌" — 월드컵처럼 시즌 개념 자체가 없는 단발 대회는 그 플래그가
// 아예 안 나오는 경우가 있어(실측 확인, 2026 월드컵) 최신 연도로 폴백.
function pickCurrentSeason(seasons) {
  const enabled = (seasons || []).filter((s) => s && s.isEnable === 'Y');
  const current = enabled.find((s) => s.isSeason === 'Y');
  if (current) return current;
  enabled.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return enabled[0];
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const json = await res.json();
  if (json.success === false) throw new Error(`API error ${url}: code=${json.code}`);
  return json;
}

// 야구(ranking/wra/gameCount/winGameCount/...)와 축구(rank/points/matchesPlayed/wins/...) 필드명이
// 서로 달라(실측 확인) 양쪽 다 흡수. 앱에 필요한 것만 화이트리스트로 추림(xG·점유율 등 60+ 필드는 버림).
function pickRow(t) {
  const row = {
    team: t.teamName,
    rank: t.rank ?? t.ranking,
    played: t.matchesPlayed ?? t.gameCount,
    win: t.wins ?? t.winGameCount,
    loss: t.losses ?? t.loseGameCount,
  };
  const draw = t.draws ?? t.drawnGameCount;
  if (typeof draw === 'number') row.draw = draw;
  if (typeof t.points === 'number') row.pts = t.points;
  if (typeof t.goalsDifference === 'number') row.gd = t.goalsDifference;
  if (typeof t.wra === 'number') row.winPct = t.wra;
  if (typeof t.gameBehind === 'number') row.gb = t.gameBehind;
  if (t.group) row.group = t.group;
  // MLB(아메리칸/내셔널리그 × 동/중/서부)·NPB(센트럴/퍼시픽리그)는 리그 전체가 아니라
  // 리그+지구 단위로 순위가 매겨져서(rank:1이 여러 팀 나오는 게 정상) 조별리그(group)와
  // 같은 방식으로 묶어야 함 — 사용자 리포트: "1등이 여러팀이네"(2026-09-26).
  else {
    const leagueLabel = LEAGUE_LABEL_KO[t.league] || t.league || '';
    const divisionLabel = DIVISION_LABEL_KO[t.division] || t.division || '';
    const combined = [leagueLabel, divisionLabel].filter(Boolean).join(' ');
    if (combined) row.group = combined;
  }
  return row;
}

const LEAGUE_LABEL_KO = { AL: '아메리칸리그', NL: '내셔널리그', CL: '센트럴리그', PL: '퍼시픽리그' };
const DIVISION_LABEL_KO = { EAST: '동부', CENT: '중부', CENTRAL: '중부', WEST: '서부' };

async function main() {
  const out = {};
  let ok = 0;
  let empty = 0;
  let failed = 0;
  for (const cat of CATEGORIES) {
    if (EXCLUDE_LEAGUES.has(cat.league)) continue;
    try {
      const seasonsJson = await fetchJson(`${BASE}/${cat.categoryId}/seasons`);
      const season = pickCurrentSeason(seasonsJson?.result?.seasons);
      if (!season?.seasonCode) {
        console.log(`[standings] ${cat.league}: no season found`);
        empty++;
        continue;
      }
      await sleep(REQUEST_DELAY_MS);
      const teamsJson = await fetchJson(`${BASE}/${cat.categoryId}/seasons/${season.seasonCode}/teams`);
      const rows = teamsJson?.result?.seasonTeamStats || [];
      if (rows.length === 0) {
        console.log(`[standings] ${cat.league}: 0 rows (season=${season.seasonCode})`);
        empty++;
        continue;
      }
      out[cat.league] = {
        updatedAt: new Date().toISOString(),
        seasonCode: season.seasonCode,
        rows: rows.map(pickRow),
      };
      console.log(`[standings] ${cat.league}: ${rows.length} rows (season=${season.seasonCode})`);
      ok++;
    } catch (e) {
      console.warn(`[standings] ${cat.league} failed: ${e.message}`);
      failed++;
    }
    await sleep(REQUEST_DELAY_MS);
  }
  await fs.writeFile(STANDINGS_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`[standings] done — ok=${ok} empty=${empty} failed=${failed} → ${STANDINGS_PATH}`);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});

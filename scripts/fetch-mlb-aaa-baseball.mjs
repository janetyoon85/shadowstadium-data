// MLB 공식 API(statsapi.mlb.com) 기반 AAA(트리플A) 마이너리그 자동 수집 — 윈터리그와 같은 소스
// (fetch-mlb-winter-baseball.mjs 참고), sportId만 11. AA/A+/A/루키는 직관 가치 낮고 구장도
// 150개 이상이라 AAA만 등록(사용자 판단).
//
// 원본 로직은 앱 저장소 scripts/fetchMlbAaaBaseball.mjs 와 동일(저장소 분리라 부득이 복사 유지).
// 매일 1회 GitHub Actions 자동 실행(.github/workflows/fetch-mlb-aaa-baseball.yml).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const TEAM_KO = {
  'Toledo Mud Hens': '톨레도 머드헨스', 'Lehigh Valley IronPigs': '리하이밸리 아이언피그스',
  'Iowa Cubs': '아이오와 컵스', 'Reno Aces': '리노 에이시스', 'Las Vegas Aviators': '라스베가스 에비에이터스',
  'Tacoma Rainiers': '타코마 레이니어스', 'Scranton/Wilkes-Barre RailRiders': '스크랜턴/윌크스배리 레일라이더스',
  'Worcester Red Sox': '우스터 레드삭스', 'Albuquerque Isotopes': '앨버커키 아이소토프스',
  'Rochester Red Wings': '로체스터 레드윙스', 'Omaha Storm Chasers': '오마하 스톰체이서스',
  'Louisville Bats': '루이빌 배츠', 'Indianapolis Indians': '인디애나폴리스 인디언스',
  'Round Rock Express': '라운드록 익스프레스', 'Buffalo Bisons': '버팔로 바이슨스',
  'El Paso Chihuahuas': '엘패소 치와와스', 'St. Paul Saints': '세인트폴 세인츠',
  'Syracuse Mets': '시러큐스 메츠', 'Sacramento River Cats': '새크라멘토 리버캣츠',
  'Durham Bulls': '더럼 불스', 'Memphis Redbirds': '멤피스 레드버즈', 'Nashville Sounds': '내슈빌 사운즈',
  'Charlotte Knights': '샬럿 나이츠', 'Oklahoma City Comets': '오클라호마시티 코메츠',
  'Gwinnett Stripers': '그위넷 스트라이퍼스', 'Salt Lake Bees': '솔트레이크 비스',
  'Jacksonville Jumbo Shrimp': '잭슨빌 점보슈림프', 'Norfolk Tides': '노퍽 타이즈',
  'Sugar Land Space Cowboys': '슈거랜드 스페이스카우보이스', 'Columbus Clippers': '콜럼버스 클리퍼스',
};

const VENUE_MAP = {
  'Fifth Third Field': 'fifth_third_field_toledo',
  'Coca-Cola Park': 'coca_cola_park_allentown',
  'Principal Park': 'principal_park_desmoines',
  'Greater Nevada Field': 'greater_nevada_field_reno',
  'Las Vegas Ballpark': 'las_vegas_ballpark',
  'Cheney Stadium': 'cheney_stadium_tacoma',
  'PNC Field': 'pnc_field_moosic',
  'Polar Park': 'polar_park_worcester',
  'Isotopes Park': 'isotopes_park_albuquerque',
  'Innovative Field': 'innovative_field_rochester',
  'ESL Ballpark': 'innovative_field_rochester',
  'Werner Park': 'werner_park_papillion',
  'Louisville Slugger Field': 'louisville_slugger_field',
  'Victory Field': 'victory_field_indianapolis',
  'Dell Diamond': 'dell_diamond_round_rock',
  'Sahlen Field': 'sahlen_field_buffalo',
  'Southwest University Park': 'southwest_university_park_elpaso',
  'CHS Field': 'chs_field_stpaul',
  'NBT Bank Stadium': 'nbt_bank_stadium_syracuse',
  'Sutter Health Park': 'sutter_health_park_sacramento',
  'Durham Bulls Athletic Park': 'durham_bulls_athletic_park',
  'AutoZone Park': 'autozone_park_memphis',
  'First Horizon Park': 'first_horizon_park_nashville',
  'Truist Field': 'truist_field_charlotte',
  'Chickasaw Bricktown Ballpark': 'chickasaw_bricktown_ballpark',
  'Coolray Field': 'coolray_field_lawrenceville',
  'Gwinnett Field': 'coolray_field_lawrenceville',
  'The Ballpark at America First Square': 'ballpark_america_first_square',
  '121 Financial Ballpark': 'vystar_ballpark_jacksonville',
  'VyStar Ballpark': 'vystar_ballpark_jacksonville',
  'Vystar Ballpark': 'vystar_ballpark_jacksonville',
  'Harbor Park': 'harbor_park_norfolk',
  'Constellation Field': 'constellation_field_sugarland',
  'Huntington Park': 'huntington_park_columbus',
  'Field of Dreams': 'field_of_dreams',
};

function toKstDateTime(utcIso) {
  const ms = Date.parse(utcIso) + 9 * 3600 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

// statsapi linescore.inningState: Top/Middle(초 마무리~말 시작 전)/Bottom/End(말 마무리~다음 회 전).
// 정확한 순간(중/종료)까지 구분하는 라벨이 기존 스키마(^\d+회(초|말)$, 네이버 공용)에 없어
// Top·Middle -> 초, Bottom·End -> 말로 근사(경기 흐름 파악엔 충분, 기존 방위각 180도 근사와 같은 성격).
function inningInfoFrom(linescore) {
  const inning = linescore?.currentInning;
  const state = linescore?.inningState;
  if (!inning || !state) return undefined;
  const half = /^(Top|Middle)$/i.test(state) ? '초' : '말';
  return `${inning}회${half}`;
}

function mlbStatusToOurs(g) {
  const abs = g.status?.abstractGameState;
  const detailed = g.status?.detailedState || '';
  if (/Postponed/i.test(detailed)) return 'postponed';
  if (/Cancelled|Suspended/i.test(detailed)) return 'cancelled';
  if (abs === 'Final') return 'completed';
  if (abs === 'Live') return 'live';
  return 'scheduled';
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchAaaBaseball(startDate, endDate, unknownTeams, unknownVenues) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=11&startDate=${startDate}&endDate=${endDate}&hydrate=linescore`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} AAA`);
  const j = await res.json();
  const games = [];
  for (const d of j.dates || []) {
    for (const g of d.games || []) {
      const homeEn = g.teams?.home?.team?.name;
      const awayEn = g.teams?.away?.team?.name;
      if (homeEn === 'To Be Determined' || awayEn === 'To Be Determined') continue; // 플레이오프 대진 미확정
      const homeKo = TEAM_KO[homeEn];
      const awayKo = TEAM_KO[awayEn];
      if (!homeKo) unknownTeams.add(homeEn);
      if (!awayKo) unknownTeams.add(awayEn);
      const venueName = g.venue?.name;
      const venueId = venueName ? VENUE_MAP[venueName] : undefined;
      if (venueName && !venueId) unknownVenues.add(venueName);
      if (!homeKo || !awayKo || !venueId) continue;
      const { date, time } = toKstDateTime(g.gameDate);
      const status = mlbStatusToOurs(g);
      const out = {
        date, time, league: 'AAA', venueId,
        home: homeKo, away: awayKo,
        stadium: venueName, timeTbd: !!g.status?.startTimeTBD,
        gameId: `AAA_MLBSTATS_${g.gamePk}`,
        status,
      };
      if (status === 'completed' || status === 'live') {
        const hs = g.teams?.home?.score;
        const as = g.teams?.away?.score;
        if (typeof hs === 'number') out.homeScore = hs;
        if (typeof as === 'number') out.awayScore = as;
      }
      if (status === 'live') {
        const inningInfo = inningInfoFrom(g.linescore);
        if (inningInfo) out.inningInfo = inningInfo;
      }
      games.push(out);
    }
  }
  return games;
}

async function notifyUnknowns(unknownTeams, unknownVenues) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || (unknownTeams.size === 0 && unknownVenues.size === 0)) return;
  const lines = [];
  if (unknownTeams.size) lines.push(`**미확인 팀명(TEAM_KO에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(VENUE_MAP에 추가 필요)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 그늘각 — MLB AAA(트리플A) 미확인 항목\nscripts/fetch-mlb-aaa-baseball.mjs 에서 매핑 추가해주세요. MLB팀 상대 전시전 등 일회성 예외는 무시해도 됩니다.\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] mlb-aaa unknown notify failed:', e.message);
  }
}

async function main() {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 86400000);
  const end = new Date(now.getTime() + 30 * 86400000);
  const startDate = ymd(start);
  const endDate = ymd(end);

  const unknownTeams = new Set();
  const unknownVenues = new Set();
  console.log(`Fetching AAA ${startDate}~${endDate} ...`);
  let allNew;
  try {
    allNew = await fetchAaaBaseball(startDate, endDate, unknownTeams, unknownVenues);
  } catch (e) {
    console.error('[mlb-aaa] fetch failed:', e.message);
    process.exit(1);
  }
  console.log(`  -> ${allNew.length} games`);
  await notifyUnknowns(unknownTeams, unknownVenues);

  const gamesPath = path.join(REPO_ROOT, 'games.json');
  const games = JSON.parse(await fs.readFile(gamesPath, 'utf-8'));
  const existingIds = new Set(games.map((g) => g.gameId || `${g.date}|${g.time}|${g.league}|${g.venueId}|${g.home}|${g.away}`));
  let added = 0;
  let updated = 0;
  for (const g of allNew) {
    const key = g.gameId;
    if (existingIds.has(key)) {
      const idx = games.findIndex((x) => x.gameId === key);
      if (idx >= 0) {
        const prev = games[idx];
        if (prev.status !== g.status || prev.homeScore !== g.homeScore || prev.awayScore !== g.awayScore || prev.inningInfo !== g.inningInfo) {
          games[idx] = { ...prev, ...g };
          updated++;
        }
      }
      continue;
    }
    games.push(g);
    existingIds.add(key);
    added++;
  }
  games.sort((a, b) => (a.date + a.time + a.league + a.venueId + a.home + a.away).localeCompare(b.date + b.time + b.league + b.venueId + b.home + b.away));
  await fs.writeFile(gamesPath, JSON.stringify(games, null, 2), 'utf-8');
  console.log(`[mlb-aaa] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[mlb-aaa] fatal:', e);
  process.exit(1);
});

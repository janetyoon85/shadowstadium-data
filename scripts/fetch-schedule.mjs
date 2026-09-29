import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { validateDataset } from './validators.mjs';
import { getAthleteNationality, getAthleteDisplayName } from './espn-nationality.mjs';
import { parseBaseballHighlights } from './baseball-highlight-parse.mjs';
import { selectUniqueScoreMatch } from './espn-match-select.mjs';
import { getMlbNationality, getMlbPitcherDecisionNats, getMlbHoldNats } from './mlb-nationality.mjs';

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
const LINEUP_API = (gameId) => `${API_BASE}/${gameId}/lineup`;
// 세이브 투수 캐시 — schedule API 엔 세이브 필드가 없어 게임당 /record 1요청이 필요.
// 종료 경기는 결과가 불변이라 gameId→savePitcher(없으면 null)로 캐시 후 신규 종료분만 fetch.
const SAVES_PATH = path.join(REPO_ROOT, 'saves.json');
// 선발투수(경기 전) pid 조회용 이름→pid 누적 레지스트리(2026-09-29, 사용자: "위키정보말고
// 다른선수들처럼 키몸무게 이런정보를가져와야지" — 스케줄 API 자체엔 선발투수 ID가 없어서,
// /record에서 학습한 이름→코드를 영구 저장해뒀다가 재사용). 시즌 지나도 안 지움(과거 선수도
// 재등판 가능, 파일 작아서 무한증식 걱정 없음).
const PLAYER_CODE_REGISTRY_PATH = path.join(REPO_ROOT, 'player-codes.json');
// 축구 득점자 캐시 — schedule API 엔 득점자 없어 게임당 /relay 1요청.
// gameId→{home:[{m,n,pk?}],away:[...]} (0-0 면 빈 배열) 캐시 후 신규 종료분만 fetch.
const SCORERS_PATH = path.join(REPO_ROOT, 'scorers.json');
// K리그 어시스트 — /lineup 엔드포인트에 선수별 누적 assists 카운트가 있음(해외 리그는 이 필드 자체가
// 없어 K리그1/2 전용). 득점자처럼 특정 골에 귀속은 안 되고 "이 경기 어시스트 총 N개" 수준.
const ASSISTS_PATH = path.join(REPO_ROOT, 'assists.json');
// K리그 카드(경고/퇴장) — 득점자와 동일 /relay 이벤트 스트림에 이미 들어있음(eventType
// YC=경고, RC=퇴장, SY=두 번째 경고 표시용 중복 이벤트 — YC와 동일 (선수,분)이라 dedupe로 제거).
// 해외 리그(ESPN 소스)는 스키마 미확인이라 일단 K리그만(2026-09-26 사용자 요청, 순차 확장 예정).
const CARDS_PATH = path.join(REPO_ROOT, 'cards.json');
const SOCCER_LEAGUES = new Set(['K리그1', 'K리그2']);
// 유럽 5대리그 어시스트 — Naver 에는 없어 ESPN 비공개 API(site.api.espn.com, 인증 불필요, Naver와
// 같은 방식으로 이용)의 goal 이벤트 텍스트("Assisted by X")에서 파싱. 선수명이 영어라 한글 득점자와
// 문자열로 매칭 불가 → 킥오프 시각(UTC, ±5분 허용)으로 경기를 매칭하고, 골 개수가 양쪽 다 정확히
// 일치할 때만 시간순으로 짝지어 부착(개수 불일치 시 완전히 스킵 — 오귀속 방지).
const ESPN_LEAGUE_SLUG = {
  EPL: 'eng.1',
  EFL: 'eng.2',
  LALIGA: 'esp.1',
  BUNDESLIGA: 'ger.1',
  SERIEA: 'ita.1',
  LIGUE1: 'fra.1',
  // 2026-09-26 확장(사용자 요청: "다른리그도가능?") — ESPN 슬러그+keyEvents 카드 존재
  // 실측 확인 완료(리그별 curl 테스트, 존재 안 하는 슬러그는 400으로 즉시 구분됨).
  EREDIVISIE: 'ned.1',
  MLS: 'usa.1',
  SAUDI: 'ksa.1',
  J1: 'jpn.1',
  SCOTLAND: 'sco.1',
  DENMARK: 'den.1',
  // 컵대회/국가대항전 — CATEGORIES에 이미 이 리그코드로 fetch-schedule.mjs가 직접 수집 중이라
  // ESPN_LEAGUE_SLUG에만 추가하면 enrichEuroAssists 파이프라인에 그대로 편입됨.
  UCL: 'uefa.champions',
  UEL: 'uefa.europa',
  UECL: 'uefa.europa.conf',
  FACUP: 'eng.fa',
  DFBPOKAL: 'ger.dfb_pokal',
  COUPEDEFRANCE: 'fra.coupe_de_france',
  COPADELREY: 'esp.copa_del_rey',
  COPPAITALIA: 'ita.coppa_italia',
  UNL: 'uefa.nations',
  WORLDCUP: 'fifa.world',
  AFRICACUP: 'caf.nations',
  CONCACAFCUP: 'concacaf.champions',
  ACL: 'afc.champions',
  UEFASUPERCUP: 'uefa.super_cup',
  GERMANSUPERCUP: 'ger.super_cup',
  SPANISHSUPERCUP: 'esp.super_cup',
  ITALIANSUPERCUP: 'ita.super_cup',
  FRENCHSUPERCUP: 'fra.super_cup',
  U17WORLDCUP: 'fifa.world.u17',
  CLUBWORLDCUP: 'fifa.cwc',
  WCQUEFA: 'fifa.worldq.uefa',
  WCQAFC: 'fifa.worldq.afc',
  AMATCHFRIENDLY: 'fifa.friendly',
  CLUBFRIENDLY: 'club.friendly',
  COPAAMERICA: 'conmebol.america',
  UEFAEURO: 'uefa.euro',
  EFLCUP: 'eng.league_cup',
  U20WORLDCUP: 'fifa.world.u20',
  ASIANCUP: 'afc.asian.cup',
  // 나머지 도메스틱 리그 38개국 — 전부 {국가코드}.1 규칙으로 실측 확인(2026-09-26,
  // 사용자 요청: "모든축구경기에다추가해"). CHINA는 GPS 측량법 리스크로 이 크롤러가 애초에
  // 안 다뤄서(CATEGORIES에 없음) 제외.
  BRASILEIRAO: 'bra.1',
  ARGENTINA: 'arg.1',
  LIGAMX: 'mex.1',
  PORTUGAL: 'por.1',
  BELGIUM: 'bel.1',
  TURKEY: 'tur.1',
  GREECE: 'gre.1',
  AUSTRIA: 'aut.1',
  NORWAY: 'nor.1',
  SWEDEN: 'swe.1',
  COLOMBIA: 'col.1',
  URUGUAY: 'uru.1',
  CHILE: 'chi.1',
  AUSTRALIA: 'aus.1',
  THAILAND: 'tha.1',
  INDONESIA: 'idn.1',
  INDIA: 'ind.1',
  VENEZUELA: 'ven.1',
  ECUADOR: 'ecu.1',
  PERU: 'per.1',
  BOLIVIA: 'bol.1',
  PARAGUAY: 'par.1',
  COSTARICA: 'crc.1',
  ELSALVADOR: 'slv.1',
  WALES: 'wal.1',
  NORTHERNIRELAND: 'nir.1',
  CYPRUS: 'cyp.1',
  MALTA: 'mlt.1',
  RUSSIA: 'rus.1',
  MALAYSIA: 'mys.1',
  SINGAPORE: 'sgp.1',
  ISRAEL: 'isr.1',
  SOUTHAFRICA: 'rsa.1',
  NIGERIA: 'nga.1',
  GHANA: 'gha.1',
  KENYA: 'ken.1',
  UGANDA: 'uga.1',
  ZIMBABWE: 'zim.1',
  // 슬러그 못 찾은 것들(400 응답, 재시도해도 실패) — ACL2, COMMUNITYSHIELD, U20WOMENWORLDCUP,
  // 코리아컵, AFF컵, EAFF E-1은 제외. INTERCONTINENTALCUP 후보로 찾은 'fifa.intercontinental.cup'은
  // 실제론 전혀 다른 대회("Intercontinental Cup (India)", 인도 국내 초청대회)라 오귀속 위험 —
  // 절대 쓰지 말 것. 나머지(U17/U20/U23 아시안컵 등 소규모 대회)는 ESPN 커버리지 자체가 없을
  // 가능성이 높아 시도 안 함.
};
const EURO_ASSISTS_PATH = path.join(REPO_ROOT, 'euro_assists.json');
// ESPN 소스 해외축구(EURO_ASSISTS와 동일 매칭 대상) 카드(경고/퇴장) — enrichEuroAssists가 이미
// 같은 경기에 fetchEspnSummary를 호출하니 그 summary를 그대로 재사용해 카드도 같이 추출.
// 골 득점자가 있는 경기만 대상(현재 매칭 로직 제약) — 0-0 무득점 경기는 카드 미지원(추후 보완).
const EURO_CARDS_PATH = path.join(REPO_ROOT, 'euro_cards.json');
const EURO_SHOOTOUT_PATH = path.join(REPO_ROOT, 'euro_shootout.json');
// 즐겨찾기 선수 알림(2026-09-28)용 자동 확장 선수명 사전 — 득점자(네이버 원문 한글)가 ESPN
// athleteId로 정확히 매칭되면(zip 성공), 그 선수의 실제 영문명(displayName)을 자동으로 여기 축적.
// 기존 App.tsx PLAYER_NAME_EN(수작업, 유명 선수 위주 1300여명)은 수동 동기화가 필요했는데
// (player-name-en.json), 이 파일은 ESPN 연동 리그에서 매칭 성공하는 모든 선수를 자동으로
// 커버해서 수작업 없이 계속 늘어남 — player-name-canon.mjs가 두 파일을 합쳐서 사용.
const PLAYER_NAME_AUTO_PATH = path.join(REPO_ROOT, 'player-name-auto.json');
// 처음엔 "N일 이내"로 컷오프했다가(2026-09-26) 축구/야구 경기 빈도 차이로 안 맞아 "팀당 최근
// 5경기"로 바꿨는데(2026-09-27), 팀 상세 페이지가 리그·컵대회 안 가리고 그 팀의 완료 경기를 전부(개수 제한 없이) 보여주는
// 구조로 바뀌면서(2026-09-27, "보여지는경기는 모두백필해줘 최소한이정도는 해야할듯"), "팀당
// 최근 N경기만" 캡을 없앰 — n 기본값을 Infinity로 바꿔 leagueSet 안의 완료 경기는 전부 대상.
// (5경기 캡 시절 만들어둔 이름은 그대로 재사용, 의미만 "이 리그 집합의 전체 완료 경기 gameId"로 확장.)
function buildRecentCompletedGameIds(allGames, leagueSet, n = Infinity) {
  const byTeam = new Map();
  for (const g of allGames) {
    if (!leagueSet.has(g.league) || g.status !== 'completed' || !g.gameId) continue;
    for (const team of [g.home, g.away]) {
      let arr = byTeam.get(team);
      if (!arr) byTeam.set(team, (arr = []));
      arr.push(g);
    }
  }
  const ids = new Set();
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    for (const g of arr.slice(0, n)) ids.add(g.gameId);
  }
  return ids;
}
// 승/패 투수 필드(schedule API 기본 포함)를 표시하는 리그 — 야구 공통(K리그는 해당 없음).
// PREMIER12도 Naver 같은 API(kbaseball 상위분류, /record 스키마 동일)로 오는 대회라 추가
// (사용자 요청: "모든야구경기다 추가되도록", 2026-09-26). 나머지 국제대회(WBC/올림픽/
// 아시안게임/유럽·중남미 11개국 등)는 이 크롤러가 아니라 WBSC/Bornan 등 완전히 다른
// 소스+스크립트에서 오는데, 그쪽 원본 데이터엔 이런 하이라이트 상세 필드가 없는 것으로
// 확인됨(별도 조사 필요, scripts/fetch-wbsc-baseball.mjs 등).
const BASEBALL_LEAGUES = new Set(['KBO', 'MLB', 'NPB', 'PREMIER12']);
// 득점자를 다른 엔드포인트(/schedule/games/{id}?fields=all의 game.scorers, 이미 구조화된 JSON)로
// 가져오는 리그. K리그(SOCCER_LEAGUES)는 /relay HTML 파싱 방식이라 별도 — 서로 다른 스키마.
const STRUCTURED_SCORER_LEAGUES = new Set([
  'EPL', 'EFL', 'LALIGA', 'BUNDESLIGA', 'SERIEA', 'LIGUE1', 'EREDIVISIE', 'MLS', 'SAUDI', 'J1', 'SCOTLAND', 'DENMARK', 'UCL', 'UEL', 'ACL', 'ACL2',
  'FACUP', 'DFBPOKAL', 'COUPEDEFRANCE', 'COPADELREY', 'COPPAITALIA',
  'COMMUNITYSHIELD', 'UEFASUPERCUP', 'GERMANSUPERCUP', 'SPANISHSUPERCUP', 'ITALIANSUPERCUP', 'FRENCHSUPERCUP',
  'WORLDCUP', 'AFRICACUP', 'INTERCONTINENTALCUP', 'U17WORLDCUP', 'CLUBFRIENDLY',
  'CONCACAFCUP', 'UECL', 'UNL',
  'EFLCUP', 'WCQUEFA', 'AMATCHFRIENDLY', 'HYBRIDFRIENDLY',
  'KOREACUP', 'WCQAFC', 'ASIANCUP', 'U17ASIANCUP', 'U20ASIANCUP', 'U23ASIANCUP', 'WOMENASIANCUP', 'U20WOMENASIANCUP', 'AFFCUP', 'E1MEN', 'E1WOMEN', 'KLEAGUESUPERCUP',
  'COPAAMERICA', 'CLUBWORLDCUP', 'UEFAEURO', 'U20WORLDCUP', 'U20WOMENWORLDCUP', 'U17WOMENASIANCUP',
]);

const CATEGORIES = [
  { categoryId: 'kbo', upperCategoryId: 'kbaseball', league: 'KBO' },
  { categoryId: 'kleague', upperCategoryId: 'kfootball', league: 'K리그1' },
  { categoryId: 'kleague2', upperCategoryId: 'kfootball', league: 'K리그2' },
  { categoryId: 'mlb', upperCategoryId: 'wbaseball', league: 'MLB' },
  { categoryId: 'npb', upperCategoryId: 'wbaseball', league: 'NPB' },
  { categoryId: 'epl', upperCategoryId: 'wfootball', league: 'EPL' },
  { categoryId: 'england2', upperCategoryId: 'wfootball', league: 'EFL' },
  { categoryId: 'primera', upperCategoryId: 'wfootball', league: 'LALIGA' },
  { categoryId: 'bundesliga', upperCategoryId: 'wfootball', league: 'BUNDESLIGA' },
  { categoryId: 'seria', upperCategoryId: 'wfootball', league: 'SERIEA' },
  { categoryId: 'ligue1', upperCategoryId: 'wfootball', league: 'LIGUE1' },
  { categoryId: 'eredivisie', upperCategoryId: 'wfootball', league: 'EREDIVISIE' },
  { categoryId: 'mls', upperCategoryId: 'wfootball', league: 'MLS' },
  // 스코티시 프리미어십 — Naver categoryId='spl'(과거 명칭 Scottish Premier League 흔적), upperCategoryId='wfootball'.
  { categoryId: 'spl', upperCategoryId: 'wfootball', league: 'SCOTLAND' },
  // 덴마크 수페르리지엔 — Naver categoryId='denmark', upperCategoryId='wfootball'.
  { categoryId: 'denmark', upperCategoryId: 'wfootball', league: 'DENMARK' },
  // 사우디 프로페셔널리그 — 네이버 API 구조상 K리그와 같은 upperCategoryId('kfootball')를 씀.
  { categoryId: 'saudiarabia', upperCategoryId: 'kfootball', league: 'SAUDI' },
  // J1리그도 마찬가지로 upperCategoryId='kfootball'.
  { categoryId: 'jleague', upperCategoryId: 'kfootball', league: 'J1' },
  // UEFA 챔피언스리그 — upperCategoryId='wfootball'. 36개 참가팀 중 24개는 기존 리그
  // venueId 재사용(naverStadiumMap.json champs 섹션에서 같은 값으로 매핑), 12개만 신규.
  { categoryId: 'champs', upperCategoryId: 'wfootball', league: 'UCL' },
  // UEFA 유로파리그 — 36개 참가팀 중 14개는 기존 리그 venueId 재사용, 22개 신규.
  { categoryId: 'europa', upperCategoryId: 'wfootball', league: 'UEL' },
  // AFC 챔피언스리그 엘리트 — upperCategoryId='kfootball'(K리그·사우디·J1과 동일).
  { categoryId: 'acl', upperCategoryId: 'kfootball', league: 'ACL' },
  // AFC 챔피언스리그 투(2단계 대회) — 2026-09부터 편입. 33개 신규 구장(아시아 각국).
  { categoryId: 'acl2', upperCategoryId: 'kfootball', league: 'ACL2' },
  // 클럽 컵대회 — 대부분 기존 등록 리그(EPL/EFL/라리가/분데스리가/세리에A 등)와 같은
  // 팀·구장을 재사용, 하위리그 대진에서만 신규 구장 필요.
  { categoryId: 'facup', upperCategoryId: 'wfootball', league: 'FACUP' },
  { categoryId: 'dfbpokal', upperCategoryId: 'wfootball', league: 'DFBPOKAL' },
  { categoryId: 'coupedefrance', upperCategoryId: 'wfootball', league: 'COUPEDEFRANCE' },
  { categoryId: 'copadelrey', upperCategoryId: 'wfootball', league: 'COPADELREY' },
  { categoryId: 'coppaitalia', upperCategoryId: 'wfootball', league: 'COPPAITALIA' },
  // 슈퍼컵류 — 전부 기존 등록 구장 재사용 확인 완료(스페인은 사우디 킹압둘라스포츠시티,
  // 프랑스는 랑스 홈구장 등 매년 개최지가 바뀔 수 있어 향후 새 구장이 필요할 수 있음).
  { categoryId: 'communityshield', upperCategoryId: 'wfootball', league: 'COMMUNITYSHIELD' },
  { categoryId: 'uefasupercup', upperCategoryId: 'wfootball', league: 'UEFASUPERCUP' },
  { categoryId: 'germansupercup', upperCategoryId: 'wfootball', league: 'GERMANSUPERCUP' },
  { categoryId: 'spanishsupercup', upperCategoryId: 'wfootball', league: 'SPANISHSUPERCUP' },
  { categoryId: 'italiansupercup', upperCategoryId: 'wfootball', league: 'ITALIANSUPERCUP' },
  { categoryId: 'frenchsupercup', upperCategoryId: 'wfootball', league: 'FRENCHSUPERCUP' },
  // 국가대표 토너먼트. 아프리카컵·U17월드컵은 SEASON_START(3월) 이전에 열려 라이브 크롤러
  // 윈도우 밖일 수 있음(과거분은 buildGameData.py 번들 fetch로 별도 확보) — 정상 동작.
  { categoryId: 'worldcup', upperCategoryId: 'wfootball', league: 'WORLDCUP' },
  { categoryId: 'africacup', upperCategoryId: 'wfootball', league: 'AFRICACUP' },
  { categoryId: 'intercontinentalcup', upperCategoryId: 'wfootball', league: 'INTERCONTINENTALCUP' },
  { categoryId: 'u17worldcup', upperCategoryId: 'wfootball', league: 'U17WORLDCUP' },
  // 클럽 친선경기 — 55개는 기존 구장 재사용으로 즉시 매핑, 나머지(약 123개)는 미등록으로
  // 남겨둠(사용자가 Discord 알림 보고 수동으로 추가하기로 함, 2026-09).
  { categoryId: 'clubfriendly', upperCategoryId: 'wfootball', league: 'CLUBFRIENDLY' },
  // 북중미챔피언스컵 — 신규 구장 22개 등록 완료. 컨퍼런스리그·네이션스리그는 categoryId만
  // 확보하고 구장 리서치는 진행 중(2026-09) — 매핑 안 된 구장은 정상적으로 필터링됨.
  { categoryId: 'concacafcup', upperCategoryId: 'wfootball', league: 'CONCACAFCUP' },
  { categoryId: 'uecl', upperCategoryId: 'wfootball', league: 'UECL' },
  { categoryId: 'unl', upperCategoryId: 'wfootball', league: 'UNL' },
  // EFL컵/월드컵 유럽예선/국가대표친선/특별친선 — Naver 웹 번들 JS에서 categoryId 확보(2026-09).
  { categoryId: 'carlingcup', upperCategoryId: 'wfootball', league: 'EFLCUP' },
  { categoryId: 'wcquefa', upperCategoryId: 'wfootball', league: 'WCQUEFA' },
  { categoryId: 'amatchfriendly', upperCategoryId: 'wfootball', league: 'AMATCHFRIENDLY' },
  { categoryId: 'hybridfriendly', upperCategoryId: 'wfootball', league: 'HYBRIDFRIENDLY' },
  // 2026-09 국가대표(한국)/아시안컵류/코리아컵 — Naver 웹 번들 JS에서 categoryId 확보.
  // 전부 upperCategoryId='kfootball'. amatch/amatchwomen(대한민국 전용 categoryId)은
  // 전세계 국가대표 필터(amatchfriendly)에 흡수 — "국가대표" 필터가 한국 경기만 보여주는
  // 것처럼 보이지 않도록 league를 AMATCHFRIENDLY로 공유.
  { categoryId: 'koreacup', upperCategoryId: 'kfootball', league: 'KOREACUP' },
  { categoryId: 'wcqafc', upperCategoryId: 'kfootball', league: 'WCQAFC' },
  { categoryId: 'asiancup', upperCategoryId: 'kfootball', league: 'ASIANCUP' },
  { categoryId: 'u17asiancup', upperCategoryId: 'kfootball', league: 'U17ASIANCUP' },
  { categoryId: 'u20asiancup', upperCategoryId: 'kfootball', league: 'U20ASIANCUP' },
  { categoryId: 'u23asiancup', upperCategoryId: 'kfootball', league: 'U23ASIANCUP' },
  { categoryId: 'womenasiancup', upperCategoryId: 'kfootball', league: 'WOMENASIANCUP' },
  { categoryId: 'u20womenasiancup', upperCategoryId: 'kfootball', league: 'U20WOMENASIANCUP' },
  { categoryId: 'affcup', upperCategoryId: 'kfootball', league: 'AFFCUP' },
  { categoryId: 'e1men', upperCategoryId: 'kfootball', league: 'E1MEN' },
  { categoryId: 'e1women', upperCategoryId: 'kfootball', league: 'E1WOMEN' },
  { categoryId: 'kleaguesupercup', upperCategoryId: 'kfootball', league: 'KLEAGUESUPERCUP' },
  { categoryId: 'amatch', upperCategoryId: 'kfootball', league: 'AMATCHFRIENDLY' },
  { categoryId: 'amatchwomen', upperCategoryId: 'kfootball', league: 'AMATCHFRIENDLY' },
  // 2026-09 코파아메리카/FIFA클럽월드컵/UEFA유로/U-20월드컵/U-20여자월드컵/U-17여자아시안컵 — 대부분
  // 과거(2024/2025) 대회라 이 라이브 크롤러(SEASON 윈도우) 안에서는 0건이 정상(번들 쪽에 과거분 확보).
  // U-20여자월드컵·U-17여자아시안컵만 2026년 진행중이라 여기서도 실제로 잡힘.
  { categoryId: 'copaamerica', upperCategoryId: 'wfootball', league: 'COPAAMERICA' },
  { categoryId: 'clubworldcup', upperCategoryId: 'wfootball', league: 'CLUBWORLDCUP' },
  { categoryId: 'uefaeuro', upperCategoryId: 'wfootball', league: 'UEFAEURO' },
  { categoryId: 'u20worldcup', upperCategoryId: 'wfootball', league: 'U20WORLDCUP' },
  { categoryId: 'u20womenworldcup', upperCategoryId: 'wfootball', league: 'U20WOMENWORLDCUP' },
  { categoryId: 'u17womenasiancup', upperCategoryId: 'kfootball', league: 'U17WOMENASIANCUP' },
  // 프리미어12(WBSC 국가대표 야구) — 다음 대회 2027년이라 이 SEASON 윈도우 안에서는 대부분 0건 정상.
  { categoryId: 'premier12', upperCategoryId: 'kbaseball', league: 'PREMIER12' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// naverStadiumMap.json에 없는 새 stadium 텍스트를 Discord로 능동 알림(빌드 실패로 안 만들어
// 다른 리그 업데이트는 그대로 진행). 웹훅 미설정 시(로컬 실행 등) 조용히 스킵.
async function notifyMappingFailures(uniqueFails) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  const lines = uniqueFails.map((f) => `• ${f.categoryId} → "${f.stadium}"`).join('\n');
  const content = `🟡 ShadeSide — 미매핑 구장 발견 (${uniqueFails.length}건)\n승격/강등·개축으로 새 구장이 생겼을 수 있어요. naverStadiumMap.json에 추가하고 App.tsx VENUES도 확인해주세요.\n${lines}`;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (e) {
    console.warn('[discord] mapping-failure notify failed:', e.message);
  }
}

async function fetchPage(cat, page) {
  // baseball 필드 → KBO 응답에 home/awayStarterName(선발투수) 포함. 발표 전(경기 전날 밤 10시 이전)
  // 이면 빈 문자열로 옴 → convertGame 에서 비어있으면 누락. K리그엔 해당 필드 없음(무시).
  // fields=all — basic,stadium,baseball 의 상위집합(실측 확인) + phaseCode/leg/aggregateScore 등
  // 토너먼트 라운드 정보 포함. 페이로드는 커지지만 별도 요청 없이 한 번에 확보 가능.
  const url = `${API_BASE}?fromDate=${SEASON_START}&toDate=${SEASON_END}&upperCategoryId=${cat.upperCategoryId}&categoryId=${cat.categoryId}&fields=all&size=${PAGE_SIZE}&page=${page}`;
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

// 토너먼트 후반(16강 등) 팀이 아직 안 정해진 경기는 Naver가 팀명 자체를 "미정" 문자열로 보냄
// (빈 문자열이 아니라 이 한글 텍스트 그대로) — 실사용자 리포트로 "미정 vs 미정" 카드가 보이는
// 버그 확인, 대진 확정되면 같은 gameId로 나중에 실제 팀명으로 갱신되니 그때까지 조용히 스킵.
function isTbdTeamName(name) {
  return !name || name === '미정';
}

function convertGame(n, cat, stadiumMap, mapFailures) {
  if (isTbdTeamName(n.homeTeamName) || isTbdTeamName(n.awayTeamName)) return null;
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
  // BEFORE(경기전, 킥오프 훨씬 전)/READY(경기전, 킥오프 임박 — statusInfo 도 "경기전")/RESULT(종료)
  // 셋 다 아니면 진행중으로 판별(실측: KBO 킥오프 ~1시간 전부터 BEFORE→READY로 바뀌는데 둘 다
  // 경기 시작 전 — READY 를 놓치면 시작 전 경기가 "경기중 0:0"으로 잘못 표시됨, 실사용자 리포트).
  // 리그마다 다른 실제 진행중 코드값(LIVE 등)까지 화이트리스트로 다 알 수는 없어 이 세 값만 배제.
  else if (n.statusCode !== 'BEFORE' && n.statusCode !== 'READY') status = 'live';

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
  // 선발투수 — 야구 리그(KBO/MLB/NPB) 공통, 발표된(비어있지 않은) 경우만. MLB/NPB도 schedule
  // API가 같은 필드(homeStarterName/awayStarterName)로 제공하는 것 확인(2026-09-09 실측).
  // away/home 모두 있을 때만 의미 있게 표시되지만 데이터는 각각 있는 대로 저장(앱이 양쪽 다 있을 때만 렌더).
  if (BASEBALL_LEAGUES.has(cat.league)) {
    const away = (n.awayStarterName || '').trim();
    const home = (n.homeStarterName || '').trim();
    if (away) game.awayPitcher = away;
    if (home) game.homePitcher = home;
  }
  // 스코어 — 종료(completed) + 진행중(live) 둘 다. 야구·축구 공통 (awayTeamScore/homeTeamScore).
  // away/home 은 위 away/home 팀명과 같은 출처라 점수도 같은 정렬로 짝지어짐.
  if (status === 'completed' || status === 'live') {
    if (typeof n.awayTeamScore === 'number') game.awayScore = n.awayTeamScore;
    if (typeof n.homeTeamScore === 'number') game.homeScore = n.homeTeamScore;
  }
  // 승부차기(PK) 스코어 — 토너먼트 단판 경기가 무승부로 끝나면 별도 필드(homePtScore/awayPtScore)로
  // 승부차기 결과가 옴(정규시간 스코어는 그대로 무승부로 남아 승자를 알 수 없음, 사용자 리포트:
  // "16강전인데 1:1로 끝난 것처럼 보임" — 이미 API가 주는데 안 읽고 있었음, 2026-09-18 발견).
  if (status === 'completed' && n.hasPtScore) {
    if (typeof n.homePtScore === 'number') game.homePkScore = n.homePtScore;
    if (typeof n.awayPtScore === 'number') game.awayPkScore = n.awayPtScore;
  }
  // 인닝 정보 — 야구 진행중 경기만. schedule API 의 statusInfo 에 이미 "N회초"/"N회말" 형태로
  // 포함(추가 요청 0). "N회초"=원정 공격/홈 수비, "N회말"=홈 공격/원정 수비(야구 규칙, 고정) —
  // 클라이언트에서 team 이름과 조합해 "공격중" 표시. "경기중 0:0"만 뜨는 밋밋함 보완용.
  if (status === 'live' && BASEBALL_LEAGUES.has(cat.league)) {
    const info = (n.statusInfo || '').trim();
    if (/^\d+회(초|말)$/.test(info)) game.inningInfo = info;
  }
  // 축구 진행 단계(전반/후반/연장전반/연장후반/승부차기 등) — 인닝 정보와 같은 statusInfo
  // 필드를 재사용(야구와 달리 정확한 문구 목록을 실시간 경기로 검증은 못 했음, 2026-09-18
  // 사용자 요청으로 추가 — "경기중"류 의미 없는 값이 아닐 때만 저장해서 최소한 있는 그대로 노출).
  if (status === 'live' && !BASEBALL_LEAGUES.has(cat.league)) {
    const info = (n.statusInfo || '').trim();
    if (info && info !== '경기중') game.matchPeriod = info;
  }
  if (status === 'completed') {
    // 승/패 투수 — 야구 리그(KBO/MLB/NPB) 종료 경기만. schedule API 의 win/losePitcherName 에
    // 이미 포함(추가 요청 0). 무승부(DRAW)면 둘 다 빈 문자열 → 누락(앱이 둘 다 있을 때만 렌더).
    // 세이브는 schedule API 에 없어 별도 /record 엔드포인트로 enrichSaves 에서 채움.
    if (BASEBALL_LEAGUES.has(cat.league)) {
      const wp = (n.winPitcherName || '').trim();
      const lp = (n.losePitcherName || '').trim();
      if (wp) game.winPitcher = wp;
      if (lp) game.losePitcher = lp;
    }
  }
  // 토너먼트 라운드 — phaseCode(GROUP/PO/T32/T16/T8/T4/T3/T2 등, 실측 확인, 2026-09)만 있고
  // 리그전(KBO 등)에는 필드 자체가 없음. leg 는 1/2(다전제 토너먼트 1차전/2차전)만 저장 —
  // leg:0(단판)은 표시할 게 없어 생략. 합계 스코어는 leg 있는 경기에만 의미 있어 같이 조건.
  if (n.phaseCode) game.phaseCode = n.phaseCode;
  if (n.leg === 1 || n.leg === 2) {
    game.leg = n.leg;
    if (typeof n.homeAggregateScore === 'number') game.homeAggregateScore = n.homeAggregateScore;
    if (typeof n.awayAggregateScore === 'number') game.awayAggregateScore = n.awayAggregateScore;
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

// /record 엔드포인트에서 세이브 투수명 추출. 리그별 스키마가 다름:
// - KBO: pitchingResult 단일 배열, wls 영문코드('S').
// - MLB/NPB: homePitcher/awayPitcher 배열 분리, wls 한글('세'). (실측 확인됨, 2026-09)
// 세이브 없는 경기(대부분)·DRAW → null. name 은 성만 — schedule 투수명과 동일 표기.
// 하이라이트 파싱 함수들(classifyHighlightSide/parseBaseballHighlights/FromBoxscore)은
// 순수 함수라 테스트 자동화 도입(2026-09-28) 때 baseball-highlight-parse.mjs로 분리 —
// 로직은 그대로, import만 해서 씀(scripts/__tests__/에서 이 크롤러 main() 실행 없이 검증 가능).

async function fetchGameRecord(gameId) {
  const res = await fetch(RECORD_API(gameId), { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} record ${gameId}`);
  const json = await res.json();
  const rd = json?.result?.recordData;
  if (!rd) return { save: null, highlights: undefined };
  let save = null;
  if (Array.isArray(rd.pitchingResult)) {
    const sv = rd.pitchingResult.find((p) => p && p.wls === 'S');
    save = sv ? (sv.name || '').trim() || null : null;
  } else {
    for (const key of ['homePitcher', 'awayPitcher']) {
      const arr = rd[key];
      if (!Array.isArray(arr)) continue;
      const sv = arr.find((p) => p && p.wls === '세');
      if (sv) {
        save = (sv.name || '').trim() || null;
        break;
      }
    }
  }
  // 홀드 투수(2026-09-29, "투수 홀드 정보도 가져올수있음?") — 팀별 분리가 필요해서(경기당 여러 명
  // 가능) KBO는 pitchersBoxscore.{home,away}(팀분리 있음, wls '홀')를, MLB/NPB는 homePitcher/
  // awayPitcher(원래도 팀분리, wls '홀')를 씀. KBO의 pitchingResult는 팀분리가 없어 홀드용으론 부적합.
  const holdHome = [];
  const holdAway = [];
  // 투수 이름→코드 맵(2026-09-29, 선수 정보 카드용 — "가져올수있는정보 최대한많이 가져와야지").
  // 승/패/세/홀드 전부 같은 배열(pitchersBoxscore 또는 homePitcher/awayPitcher)에 wls로만
  // 구분돼 같이 들어있어 여기서 한 번에 이름→코드로 뽑아두면 호출부가 승/패/세/홀드 이름으로
  // 바로 조회 가능(KBO는 pcode, MLB/NPB는 playerId 필드명 — MLB는 호출부가 리그로 걸러서
  // 이 값을 안 씀, statsapi.mlb.com 공식 personId와 별개 체계라 birth 대조 매칭을 따로 함).
  const pitcherCodeByName = {};
  if (rd.pitchersBoxscore) {
    for (const p of rd.pitchersBoxscore.home || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdHome.push(n); }
    for (const p of rd.pitchersBoxscore.away || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdAway.push(n); }
    for (const p of [...(rd.pitchersBoxscore.home || []), ...(rd.pitchersBoxscore.away || [])]) {
      if (p?.name && p?.pcode) pitcherCodeByName[p.name.trim()] = String(p.pcode);
    }
  } else {
    for (const p of rd.homePitcher || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdHome.push(n); }
    for (const p of rd.awayPitcher || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdAway.push(n); }
    for (const p of [...(rd.homePitcher || []), ...(rd.awayPitcher || [])]) {
      if (p?.name && p?.playerId) pitcherCodeByName[p.name.trim()] = String(p.playerId);
    }
  }
  return { save, holdHome, holdAway, pitcherCodeByName, highlights: parseBaseballHighlights(rd) };
}
// 하이라이트(홈런 등)는 새 필드라 옛 캐시(saves.json, 지금까지는 savePitcher 문자열만 저장)엔
// 당연히 없음 — 처음엔 사용자 지시대로 최근 3일치만 재조회했으나("백필할필요없고 백필은
// 3일전데이터만있으면돼", 2026-09-26), 팀 상세 페이지(최근 5경기) 신설로 그보다 오래된 경기도
// 화면에 나오게 돼 날짜 컷오프를 버리고 buildRecentCompletedGameIds(리그당 팀별 최근 5경기)로
// 교체(2026-09-27, "화면에 보여주는거만 채워줘" — CARD_ENRICH_CUTOFF_DAYS와 동일 사유).

// 종료 야구(KBO/MLB/NPB) 경기에 세이브 투수(savePitcher) 부착. saves.json 캐시로 신규 종료분만
// /record fetch. graceful: /record 실패한 게임은 캐시 안 함(다음 run 재시도) + savePitcher 미부착
// (승/패 점수는 유지). 캐시는 현 데이터셋의 종료 gameId 로 prune — 시즌 넘어가도 무한 증식 방지.
async function enrichSaves(allGames) {
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(SAVES_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[saves] no saves.json yet — backfilling from scratch');
  }
  let playerCodeRegistry = {};
  try {
    playerCodeRegistry = JSON.parse(await fs.readFile(PLAYER_CODE_REGISTRY_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[playerCodes] no player-codes.json yet — starting fresh');
  }

  const targets = allGames.filter(
    (g) => BASEBALL_LEAGUES.has(g.league) && g.status === 'completed' && g.gameId,
  );
  // enrichScorers/enrichEuroAssists와 동일 이유(2026-09-26)로 여기도 정렬 누락돼있었음 — games.json
  // 날짜 오름차순 그대로라 예산제 백필(MLB_PITCHER_NAT_BUDGET)이 4월 경기부터 순서대로 처리되며
  // 정작 사용자가 보는 최근 9월 경기는 몇 시간이 지나도 국적 0%로 남는 버그(백필현황 점검 중
  // 발견, 2026-09-29 — mlbPitcherNatChecked 2,430건 중 2,024건 미처리, earliest unchecked
  // 2026-04-05였음에도 최근 10일 경기는 0% 처리).
  targets.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  let fromCache = 0;
  let fetched = 0;
  let failed = 0;
  // 위 주석대로 "팀당 최근 5경기"가 의도였는데 enrichEuroAssists와 동일하게 n 인자가 누락돼
  // Infinity가 적용돼있었음(2026-09-29, 같은 백필현황 점검 중 발견) — n=5 복원.
  const recentHighlightIds = buildRecentCompletedGameIds(allGames, BASEBALL_LEAGUES, 5);
  // 팀당 5경기 캡을 없애면서(2026-09-27) 대상이 143→3966으로 커져 한 실행이 1시간+ 로 늘어나
  // 5분 주기 외부 트리거와 계속 겹치는 문제 실측(동시성 큐잉만으론 실행 자체가 안 끝나 무의미) —
  // enrichEuroAssists의 BACKFILL_BUDGET과 동일 패턴으로 실행당 예산을 두고 나머지는 다음
  // 실행들로 자연 분산.
  const SAVES_FETCH_BUDGET = 200;
  let savesFetchUsed = 0;
  // MLB 투수(승/패/세/홀드) 국적 조회 예산(2026-09-29 추가, 이 기능이 처음부터 예산 없이 배포돼
  // 809개 밀린 게임을 한 실행에서 전부 처리하려다 실제로 이 워크플로가 평소보다 훨씬 오래
  // 걸리는 걸 실측(cron-job.org 5분 트리거가 계속 큐잉되는 이전 사고와 동일 증상 재현 위험) —
  // SAVES_FETCH_BUDGET과 별도 예산으로 캡, 나머지는 자연스럽게 다음 실행들로 분산(found=false
  // 아니면 플래그가 세팅 안 돼 재시도되므로 예산 초과로 건너뛴 건도 안전하게 다음 run에 재시도).
  const MLB_PITCHER_NAT_BUDGET = 80;
  let mlbPitcherNatUsed = 0;

  for (const g of targets) {
    const cached = cache[g.gameId];
    // 옛 캐시는 savePitcher 문자열(또는 null) 그대로 — {save, highlights} 새 포맷과 구분.
    const isNewFormat = cached && typeof cached === 'object';
    // highlights 옛 포맷은 평면 배열(팀 구분 없음), 새 포맷은 {home,away} 객체(2026-09-26,
    // "축구처럼 팀 나누어" 요청으로 분리) — 배열이면 아직 안 갈라진 옛 캐시로 간주해 재조회.
    const isSplitHighlightFormat =
      isNewFormat && cached.highlights && typeof cached.highlights === 'object' && !Array.isArray(cached.highlights);
    // MLB 국적 enrichment 도입(2026-09-28) 이전에 이미 split-format으로 캐시된 경기는
    // isSplitHighlightFormat이 true라 영원히 재조회 안 되고, MLB 블록은 birth 필드를 매번
    // 지워버려서(성공/실패 무관) "시도했는지"를 구분할 신호 자체가 없었음 — 사실상 이 도입
    // 이후 완료된 MLB 경기조차 국적이 하나도 안 채워지는 결과로 이어짐(사용자 질문 "mlb도
    // 국적채워지는거지??"로 실측 발견: 오늘 경기도 0%). mlbNatChecked 플래그로 "이미 시도함"을
    // 명시적으로 기록해 이게 없는 MLB 경기만 재조회 트리거.
    const needsMlbNatBackfill = g.league === 'MLB' && isSplitHighlightFormat && !cached.mlbNatChecked;
    // pid(MLB personId, 2026-09-29 추가) 백필 — mlbNatChecked=true로 이미 확정된 기존 경기들은
    // nat은 있어도 pid가 없는 채로 남아있고(도입 이전 데이터), h.birth도 매번 지워버려서
    // pid만 나중에 따로 채울 방법이 없음(재조회 없인 원천 데이터 자체가 없음). 완전 재조회를
    // 한 번 더 트리거하면 fetchGameRecord가 캐시를 통째로 새로 받아와 h.birth가 다시 생기고,
    // 기존 per-highlight 로직(nat===undefined && birth)이 새 데이터에서 nat+pid를 같이 채움 —
    // 그래서 이 마이그레이션은 mlbPidChecked 한 번만 더 트리거하면 됨(같은 계열의 반복 패턴,
    // [[feedback_final_cache_stale_snapshot_bug]]).
    const needsMlbPidBackfill = g.league === 'MLB' && isSplitHighlightFormat && cached.mlbNatChecked && !cached.mlbPidChecked;
    // 홀드 투수(2026-09-29 추가) — 이 필드 도입 이전에 캐시된 경기는 holdHome/holdAway 자체가
    // 없어서(undefined) 재조회 안 하면 영원히 안 채워짐(같은 계열의 반복 패턴). 배열 존재 여부로
    // 판단 — 홀드가 0명이었던 정상 케이스는 빈 배열([])로 저장되니 undefined와 구분됨.
    const needsHoldBackfill = isNewFormat && !Array.isArray(cached.holdHome);
    // KBO/NPB pid 백필(2026-09-29, "01a0ec0b인데 ota또못받아오는듯?" 리포트로 발견 — OTA는
    // 정상 수신됐는데 실제로는 이미 캐시된 KBO/NPB 경기 전부(8,747+2,090건)에 pid가 하나도
    // 없었음. 오늘 pitcherCodeByName을 새로 추가했는데 기존 캐시엔 이 필드 자체가 없어서
    // 재조회 트리거가 없으면 영원히 안 채워짐 — MLB pid 백필과 동일한 패턴, 같은 날 세 번째
    // 재발). 이 필드는 fetchGameRecord가 항상 반환(빈 객체 {}라도)하므로 존재 여부 자체가
    // "이미 재조회함" 신호 — 별도 Checked 플래그 불필요, 한 번 재조회되면 자동으로 안정됨.
    const needsKboNpbPidBackfill = (g.league === 'KBO' || g.league === 'NPB') && isNewFormat && !cached.pitcherCodeByName;
    const needsHighlightRefetch = recentHighlightIds.has(g.gameId) && (!isSplitHighlightFormat || needsMlbNatBackfill || needsMlbPidBackfill || needsHoldBackfill || needsKboNpbPidBackfill);
    const needsSavesFetch = cached === undefined || needsHighlightRefetch;
    if (needsSavesFetch && savesFetchUsed < SAVES_FETCH_BUDGET) {
      savesFetchUsed++;
      try {
        await sleep(REQUEST_DELAY_MS);
        cache[g.gameId] = await fetchGameRecord(g.gameId);
        fetched++;
      } catch (e) {
        failed++;
        console.warn(`[saves] fetch failed ${g.gameId}: ${e.message}`);
        // 캐시 자체가 없으면 이번엔 붙일 게 없음 — 아래 rec 체크들이 전부 안전하게 no-op.
        // 옛 캐시가 있으면(리페치 실패해도) 그걸로라도 부착.
      }
    } else if (!needsSavesFetch) {
      fromCache++;
    }
    // needsSavesFetch인데 예산 초과로 이번엔 재조회 못 한 경우 — 예전엔 여기서 continue로 루프를
    // 통째로 건너뛰어서 이미 캐시된 값(승/패/세 국적 등)까지 이번 실행 결과물에서 통째로 빠지는
    // 심각한 회귀가 있었음(2026-09-29 발견: 홀드 백필 트리거가 거의 모든 게임을 needsSavesFetch로
    // 만들어버려 예산 200을 넘는 대부분의 게임이 이미 확보한 국적 데이터까지 잃음). 재조회만
    // 건너뛰고, 아래에서 기존 캐시가 있으면 그대로 계속 반영.
    const rec = cache[g.gameId];
    if (rec) {
      if (typeof rec === 'string') {
        g.savePitcher = rec; // 옛 포맷
      } else {
        if (rec.save) g.savePitcher = rec.save;
        if (rec.highlights && ((rec.highlights.home && rec.highlights.home.length) || (rec.highlights.away && rec.highlights.away.length))) {
          g.highlights = rec.highlights;
          // MLB 국적 enrichment(2026-09-28, "야구도 국기 있으면 좋겠다" 요청 대응 조사 후 MLB만
          // 우선 적용 — KBO/NPB는 무료 API가 없음). rec.highlights는 cache[g.gameId]와 동일
          // 참조라 여기서 mutate하면 saves.json에도 그대로 저장되어 다음 실행부턴 재조회 없이
          // 재사용됨(nat 필드가 이미 있으면 아래서 재조회 스킵).
          if (g.league === 'MLB') {
            for (const side of ['home', 'away']) {
              const team = side === 'home' ? g.home : g.away;
              for (const h of g.highlights[side] || []) {
                // 버그 수정(2026-09-29, "야구는 선수누르면정보가안나오는데?" 리포트로 발견): pid
                // 마이그레이션(needsMlbPidBackfill)이 재조회를 트리거해도, 이 조건이 h.nat===undefined
                // 일 때만 조회해서 이미 nat이 있던(=마이그레이션 이전에 이미 국적 채워졌던) 기존
                // 항목은 조회 자체를 건너뛰어 pid가 영원히 안 붙었음(497개 게임 실측 확인) — nat과
                // 무관하게 pid가 없으면 조회하도록 분리. nat은 이미 있으면 덮어쓰지 않음(안전).
                if (h.birth && (h.nat === undefined || h.pid === undefined)) {
                  const found = await getMlbNationality(team, h.birth);
                  if (found) {
                    if (h.nat === undefined) h.nat = found.nat;
                    // pid(MLB personId, 2026-09-29 추가) — 선수 정보 카드에서 statsapi.mlb.com
                    // people 엔드포인트로 바로 상세 조회할 때 씀. 축구 pid(espn:...)와 동일 역할.
                    if (h.pid === undefined && found.personId != null) h.pid = `mlb:${found.personId}`;
                  }
                }
                delete h.birth; // games.json엔 임시 필드 안 나가게 정리.
                delete h.backnum;
              }
            }
            rec.mlbNatChecked = true; // "이미 시도함" 기록 — birth 삭제로 사라지는 신호를 대체.
            rec.mlbPidChecked = true; // pid 마이그레이션도 이번에 같이 처리됨 — 재트리거 방지.
          } else if (g.league === 'KBO' || g.league === 'NPB') {
            // KBO/NPB 타자 하이라이트 pid(2026-09-29, "가져올수있는정보 최대한많이 가져와야지") —
            // 국적 API는 없지만 koreabaseball.com/야후재팬 선수ID와 실측 검증된 코드가 파싱
            // 단계(baseball-highlight-parse.mjs)에서 이미 h.playerCode(KBO)/h.playerId(NPB)로
            // 붙어옴 — 여기서 pid로 승격하고 임시 필드는 정리.
            const prefix = g.league === 'KBO' ? 'kbo:b:' : 'npb:';
            for (const side of ['home', 'away']) {
              for (const h of g.highlights[side] || []) {
                const code = h.playerCode || h.playerId;
                if (code) h.pid = `${prefix}${code}`;
                delete h.playerCode;
                delete h.playerId;
                delete h.birth;
                delete h.backnum;
              }
            }
          }
        }
      }
    }
    // 선발투수 승/패/세이브 국적(2026-09-29, "mlb선발투수에는국기못붙이나?") — 위 하이라이트(타자)
    // 국적과 달리 네이버 데이터에 생년월일이 없어 같은 방식을 못 씀. 대신 MLB 공식 API의 decisions
    // 엔드포인트가 실제 승/패/세이브 투수를 선수ID로 직접 줘서(mlb-nationality.mjs 참고) 이름 매칭
    // 없이 확정 조회 가능. highlights 재조회 예산(SAVES_FETCH_BUDGET)과 무관한 별도 API라 그
    // 트리거에 얹지 않고 독립적으로 처리 — mlbNatChecked(타자용)와 별도의 mlbPitcherNatChecked
    // 플래그를 써야 함(안 그러면 이미 mlbNatChecked=true인 기존 MLB 경기들이 이 새 필드를 영원히
    // 못 받는, [[feedback_final_cache_stale_snapshot_bug]]와 동일한 함정에 빠짐).
    const needsPitcherNat = rec && typeof rec === 'object' && g.league === 'MLB' && !rec.mlbPitcherNatChecked && (g.winPitcher || g.losePitcher || g.savePitcher);
    if (needsPitcherNat && mlbPitcherNatUsed < MLB_PITCHER_NAT_BUDGET) {
      mlbPitcherNatUsed++;
      try {
        const dec = await getMlbPitcherDecisionNats(g.home, g.away, g.date, g.homeScore, g.awayScore);
        if (dec.winNat) rec.winPitcherNat = dec.winNat;
        if (dec.loseNat) rec.losePitcherNat = dec.loseNat;
        if (dec.saveNat) rec.savePitcherNat = dec.saveNat;
        // personId(2026-09-29, 선수 정보 카드용) — pid 필드로 App에 실어 보냄(축구 pid와 동일 role).
        if (dec.winPersonId != null) rec.winPitcherPid = `mlb:${dec.winPersonId}`;
        if (dec.losePersonId != null) rec.losePitcherPid = `mlb:${dec.losePersonId}`;
        if (dec.savePersonId != null) rec.savePitcherPid = `mlb:${dec.savePersonId}`;
        // found=false(게임 자체를 못 찾음, 예: 팀명 미등록·API 장애)면 플래그를 세우지 않고 다음
        // run 재시도 — found=true인데 개별 국적이 없는 건 정상적인 결과라 플래그 확정 가능
        // (2026-09-29, 809개 경기가 KST/ET 날짜버그로 이 플래그에 영구 오염됐던 사고 재발방지).
        if (dec.found) rec.mlbPitcherNatChecked = true;
      } catch (e) {
        console.warn(`[saves] MLB pitcher nat failed ${g.gameId}: ${e.message}`);
      }
    }
    if (rec && typeof rec === 'object') {
      if (rec.winPitcherNat) g.winPitcherNat = rec.winPitcherNat;
      if (rec.losePitcherNat) g.losePitcherNat = rec.losePitcherNat;
      if (rec.savePitcherNat) g.savePitcherNat = rec.savePitcherNat;
      if (rec.winPitcherPid) g.winPitcherPid = rec.winPitcherPid;
      if (rec.losePitcherPid) g.losePitcherPid = rec.losePitcherPid;
      if (rec.savePitcherPid) g.savePitcherPid = rec.savePitcherPid;
      // KBO/NPB 선수 정보 카드용 pid(2026-09-29, "가져올수있는정보 최대한많이 가져와야지") —
      // MLB처럼 국적은 없지만(공식 국적 API 자체가 없음), pitcherCodeByName은 같은 /record
      // 응답에서 추가 fetch 없이 이미 나옴 — koreabaseball.com pcode/야후재팬 선수ID와 실측
      // 검증된 값이라 그대로 pid로 승격.
      if (!g.winPitcherPid && rec.pitcherCodeByName) {
        const prefix = g.league === 'KBO' ? 'kbo:p:' : g.league === 'NPB' ? 'npb:' : null;
        if (prefix) {
          if (g.winPitcher && rec.pitcherCodeByName[g.winPitcher]) g.winPitcherPid = `${prefix}${rec.pitcherCodeByName[g.winPitcher]}`;
          if (g.losePitcher && rec.pitcherCodeByName[g.losePitcher]) g.losePitcherPid = `${prefix}${rec.pitcherCodeByName[g.losePitcher]}`;
          if (g.savePitcher && rec.pitcherCodeByName[g.savePitcher]) g.savePitcherPid = `${prefix}${rec.pitcherCodeByName[g.savePitcher]}`;
        }
      }
      // 선발투수(경기 전) pid 레지스트리 갱신 — 승/패/세 여부와 무관하게 이 경기 박스스코어에
      // 나온 투수는 전부 등록(그 경기에서 선발이었든 아니든, 다음에 "다른" 경기의 선발투수로
      // 다시 나올 수 있으니 최대한 넓게 학습).
      if (rec.pitcherCodeByName) {
        const prefix = g.league === 'KBO' ? 'kbo:p:' : g.league === 'NPB' ? 'npb:' : null;
        if (prefix) {
          for (const [name, code] of Object.entries(rec.pitcherCodeByName)) {
            playerCodeRegistry[name] = `${prefix}${code}`;
          }
        }
      }
    }
    // 홀드 투수 국적(MLB만, 2026-09-29) — decisions 엔드포인트와 달리 "누가 홀드인지"를 단일 역할
    // 필드로 안 줘서 boxscore의 팀별 투수 등장 순서로 골라낸 뒤 이름 배열(rec.holdHome/holdAway,
    // 같은 등장 순서) 인덱스끼리 zip. mlbNatChecked/mlbPitcherNatChecked와 별도의
    // mlbHoldNatChecked 플래그 — 이미 그 둘이 true인 기존 MLB 경기도 이 새 필드는 못 받았을
    // 것이므로 독립 플래그 필수([[feedback_final_cache_stale_snapshot_bug]] 패턴).
    const needsHoldNat = rec && typeof rec === 'object' && g.league === 'MLB' && !rec.mlbHoldNatChecked && ((rec.holdHome && rec.holdHome.length) || (rec.holdAway && rec.holdAway.length));
    if (needsHoldNat && mlbPitcherNatUsed < MLB_PITCHER_NAT_BUDGET) {
      mlbPitcherNatUsed++;
      try {
        const nats = await getMlbHoldNats(g.home, g.away, g.date, g.homeScore, g.awayScore);
        if (nats.home) rec.holdHomeNats = nats.home;
        if (nats.away) rec.holdAwayNats = nats.away;
        // personId(2026-09-29, 선수 정보 카드용) — nat 배열과 같은 순서로 병렬 저장.
        if (nats.homeIds) rec.holdHomeIds = nats.homeIds;
        if (nats.awayIds) rec.holdAwayIds = nats.awayIds;
        if (nats.found) rec.mlbHoldNatChecked = true; // found=false면 다음 run 재시도.
      } catch (e) {
        console.warn(`[saves] MLB hold nat failed ${g.gameId}: ${e.message}`);
      }
    }
    if (rec && typeof rec === 'object' && ((rec.holdHome && rec.holdHome.length) || (rec.holdAway && rec.holdAway.length))) {
      const holdPidPrefix = g.league === 'KBO' ? 'kbo:p:' : g.league === 'NPB' ? 'npb:' : null;
      const zip = (names, nats, ids) => (names || []).map((n, i) => {
        const entry = { n };
        if (nats && nats[i]) entry.nat = nats[i];
        if (ids && ids[i] != null) entry.pid = `mlb:${ids[i]}`;
        else if (holdPidPrefix && rec.pitcherCodeByName?.[n]) entry.pid = `${holdPidPrefix}${rec.pitcherCodeByName[n]}`;
        return entry;
      });
      g.holds = { home: zip(rec.holdHome, rec.holdHomeNats, rec.holdHomeIds), away: zip(rec.holdAway, rec.holdAwayNats, rec.holdAwayIds) };
    }
  }

  // prune: 현 데이터셋의 종료 야구(KBO/MLB/NPB) gameId 만 남김 (캐시한 값이 있는 것만).
  const validIds = new Set(targets.map((g) => g.gameId));
  const pruned = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) pruned[id] = cache[id];
  }
  await fs.writeFile(SAVES_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf-8');

  // 선발투수(경기 전, 예정/진행중/종료 상관없이 전부) pid — 레지스트리에 이름이 있으면 그대로
  // 붙임. targets(완료 경기만)가 아니라 allGames 전체를 돌아야 "아직 안 열린" 예정 경기의
  // 선발투수도 커버됨(2026-09-29, "위키정보말고 다른선수들처럼 키몸무게 이런정보를가져와야지").
  let starterPidAttached = 0;
  for (const g of allGames) {
    if (!BASEBALL_LEAGUES.has(g.league)) continue;
    if (g.homePitcher && playerCodeRegistry[g.homePitcher]) { g.homePitcherPid = playerCodeRegistry[g.homePitcher]; starterPidAttached++; }
    if (g.awayPitcher && playerCodeRegistry[g.awayPitcher]) { g.awayPitcherPid = playerCodeRegistry[g.awayPitcher]; starterPidAttached++; }
  }
  await fs.writeFile(PLAYER_CODE_REGISTRY_PATH, JSON.stringify(playerCodeRegistry, null, 2) + '\n', 'utf-8');

  const withSave = targets.filter((g) => g.savePitcher).length;
  const withHighlights = targets.filter((g) => g.highlights).length;
  console.log(
    `[saves] completedBaseball=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} withSave=${withSave} withHighlights=${withHighlights} starterPidAttached=${starterPidAttached} registrySize=${Object.keys(playerCodeRegistry).length} mlbPitcherNatUsed=${mlbPitcherNatUsed}/${MLB_PITCHER_NAT_BUDGET}`,
  );
}

// scorePlayer HTML(<li>[time]이름[time]</li> 반복) → [{m,n,og?}]. 골 1개=li 1개, 순서·개수는 스코어와 일치.
// home: "이름 <span class='time'>MM:SS</span>", away: "<span class='time'>MM:SS</span> 이름" — 위치 달라도 동일 파싱.
// 자책골: Naver 가 득점한(이득 본) 팀 목록에 "{상대선수}(자책골)" 로 귀속 → 이름에서 분리해 og 플래그.
function parseScorerHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  for (const chunk of html.split('<li>').slice(1)) {
    const li = chunk.split('</li>')[0];
    const tm = li.match(/<span class='time'>(\d+):\d+<\/span>/);
    const m = tm ? parseInt(tm[1], 10) : null;
    let n = li.replace(/<span class='time'>[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '').trim();
    let og = false;
    if (/자책골/.test(n)) {
      og = true;
      n = n.replace(/\s*\(?\s*자책골\s*\)?\s*/g, '').trim();
    }
    if (!n) continue;
    const s = { n };
    if (m != null) s.m = m;
    if (og) s.og = true;
    out.push(s);
  }
  return out;
}

// relay 이벤트 time → 절대분. "29'"→29, "+3"(half=1)→48/(half=2)→93, 숫자만→그대로.
function absMinFromEvent(e) {
  const t = (e && e.time != null ? String(e.time) : '').trim();
  const plus = t.match(/^\+(\d+)$/);
  if (plus) return (e.half === '1' ? 45 : 90) + parseInt(plus[1], 10);
  const norm = t.match(/^(\d+)'?$/);
  if (norm) return parseInt(norm[1], 10);
  return null;
}

async function fetchRelayHalf(gameId, half) {
  const res = await fetch(`${RELAY_API(gameId)}?half=${half}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} relay ${gameId} half=${half}`);
  const json = await res.json();
  return json?.result?.textRelayData || null;
}

// 종료 축구 경기 /relay 에서 득점자 추출. 전·후반 2요청 — 기본 relay 는 후반 이벤트만 줘서
// 전반 PK 를 놓침(scorePlayer 골 목록은 양쪽 동일·전 경기 완전이라 어느 쪽이든 사용).
// - 득점/분/팀/자책골: home/awayScorePlayer.
// - PK: 전·후반 textRelays eventType==='PK' → 절대분. 득점자와 이름+분(±1) 둘 다 일치 시에만 (PK).
//   (자책골은 PK 아님 / 모르는 eventType 은 무시 → 일반 골 오표기 0.)
// 카드(경고/퇴장) — textRelays eventType YC(경고)/RC(퇴장)에서 선수명+분+홈원정 추출.
// SY(두 번째 경고 표시용)는 같은 선수의 직전 YC와 (name,min) 동일한 중복 이벤트라 dedupe로 제거.
function extractCardsFromRelays(relays) {
  const home = [];
  const away = [];
  const seen = new Set();
  for (const e of relays) {
    if (!e || !e.playerName) continue;
    if (e.eventType !== 'YC' && e.eventType !== 'RC' && e.eventType !== 'SY') continue;
    const min = absMinFromEvent(e);
    const type = e.eventType === 'RC' ? 'R' : 'Y';
    const key = `${e.homeOrAway}|${e.playerName.trim()}|${min}|${type}`;
    if (seen.has(key)) continue; // SY와 YC가 같은 (선수,분)으로 중복 발생 방지.
    seen.add(key);
    const card = { n: e.playerName.trim(), type };
    if (min != null) card.m = min;
    (e.homeOrAway === 'home' ? home : away).push(card);
  }
  return { home, away };
}

async function fetchScorersAndCards(gameId) {
  const d1 = await fetchRelayHalf(gameId, 1);
  const d2 = await fetchRelayHalf(gameId, 2);
  const d = d2 || d1;
  const allRelays = [...(d1?.textRelays || []), ...(d2?.textRelays || [])];
  const cards = extractCardsFromRelays(allRelays);
  if (!d) return { scorers: { home: [], away: [] }, cards };
  const home = parseScorerHtml(d.homeScorePlayer);
  const away = parseScorerHtml(d.awayScorePlayer);
  const pkEvents = allRelays
    .filter((e) => e && e.eventType === 'PK' && e.playerName)
    .map((e) => ({ name: e.playerName.trim(), min: absMinFromEvent(e) }));
  const markPk = (arr) =>
    arr.map((s) => {
      if (s.og || s.m == null) return s;
      const hit = pkEvents.some((p) => p.name === s.n && p.min != null && Math.abs(p.min - s.m) <= 1);
      return hit ? { ...s, pk: true } : s;
    });
  return { scorers: { home: markPk(home), away: markPk(away) }, cards };
}

// K리그 어시스트 — /lineup 의 home/away.players(선발 포지션별 배열의 배열)를 평탄화해
// assists>0 인 선수만 [{n,count}]로 추출. 특정 골에 귀속은 못 함(누적치만 제공하는 스키마).
function extractAssists(playersNested) {
  const flat = (playersNested || []).flat();
  return flat
    .filter((p) => p && typeof p.assists === 'number' && p.assists > 0 && (p.name || '').trim())
    .map((p) => ({ n: p.name.trim(), count: p.assists }));
}

// 동명이인 구분용 Naver 고유 선수ID(2026-09-28, [[project_player_favorite_alerts]] 관련 사용자
// 리포트: "데이비스" 이름 하나에 서로 다른 선수 여러 명이 섞여 국적이 뒤죽박죽으로 뜸 —
// "고유id로해야겠네") — /lineup 응답의 모든 선수(어시스트 여부 무관)가 playerId를 갖고 있고,
// 같은 실제 선수는 여러 경기에서 항상 같은 playerId(실측 확인: "김종민"이 서로 다른 두 경기에서
// 둘 다 20220242)라 이름 대신 이걸로 매칭하면 동명이인이 안 섞임. name→playerId 맵만 만들어서
// 반환 — 어시스트 카운트(extractAssists)와는 별개로 scorers/cards 항목에 나중에 붙임.
function extractPlayerIds(playersNested) {
  const flat = (playersNested || []).flat();
  const map = {};
  for (const p of flat) {
    const name = (p?.name || '').trim();
    if (name && p.playerId) map[name] = String(p.playerId);
  }
  return map;
}

async function fetchLineupAssists(gameId) {
  const res = await fetch(LINEUP_API(gameId), { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} lineup ${gameId}`);
  const json = await res.json();
  const lineup = json?.result?.lineUpData?.lineup;
  if (!lineup) return { home: [], away: [], pids: { home: {}, away: {} } };
  // 교체 출전 선수 pid 누락 버그 수정(2026-09-29, "홍철" 카드 실사례로 발견) — lineUpData.
  // substitution.{home,away}는 lineUpData.lineup.{home,away}.players(선발 11명, 포지션별
  // 중첩배열)와 완전히 별개의 최상위 필드인데 지금까지 안 합쳐서, 교체로 들어온 선수는
  // 골/카드를 기록해도 이 선수ID 맵에 없어 pid가 영원히 안 붙었음. substitution 항목은 이미
  // 평평한 배열(중첩 아님)이라 players(중첩배열)와 나란히 넣어도 flat() 한 번으로 둘 다
  // 올바르게 펼쳐짐.
  const substitution = json?.result?.lineUpData?.substitution;
  const allHome = [...(lineup.home?.players || []), ...(substitution?.home || [])];
  const allAway = [...(lineup.away?.players || []), ...(substitution?.away || [])];
  return {
    home: extractAssists(allHome),
    away: extractAssists(allAway),
    pids: { home: extractPlayerIds(allHome), away: extractPlayerIds(allAway) },
  };
}

async function fetchEspnScoreboard(slug, yyyymmdd) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${yyyymmdd}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} espn scoreboard ${slug} ${yyyymmdd}`);
  const json = await res.json();
  return json.events || [];
}

async function fetchEspnSummary(slug, eventId) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} espn summary ${slug} ${eventId}`);
  return res.json();
}

// "... Assisted by Morgan Rogers." / "... Assisted by Jorrel Hato following a fast break." /
// "... Assisted by William Osula with a through ball following a fast break." 에서 이름만 추출
// ("with"/"following"/"after" 로 시작하는 부가 설명은 모두 제거).
function parseAssistFromText(text) {
  const m = /Assisted by ([^.]+?)(?:\s+with\s|\s+following\s|\s+after\s|\.|$)/.exec(text || '');
  return m ? m[1].trim() : null;
}

// ESPN keyEvents(경기 전체 시간순 골 이벤트) → {home:[{a,m}],away:[{a,m}]}. 자책골은 ESPN 이
// "실점한(자책한) 팀"으로 team 을 표기하지만 Naver 는 "이득 본(수혜)" 팀 목록에 자책골을 넣으므로
// team 필드는 자책골이어도 이미 "득점 수혜팀"(Naver 와 동일 관례, 실측 확인: Chelsea 소속 주앙 페드로의
// 자책골 이벤트의 team 이 수혜팀인 Brighton — 뒤집으면 안 됨) 이라 별도 반전 불필요.
// 단, 국적 조회(getAthleteNationality)는 다름 — 그건 "실제 득점 선수가 속한 팀"의 로스터에서
// athleteId를 찾아야 하는데, 자책골이면 team.id(수혜팀)엔 그 선수가 없어서 항상 조회 실패함
// (2026-09-28 실사용 리포트로 발견: 웨일스 자책골 선수 국적이 계속 안 채워짐 — 구조적 버그였음,
// 백필을 아무리 돌려도 안 고쳐짐). og 플래그를 심어서 zip() 호출부가 반대팀 id로 조회하게 함.
function extractEspnGoalsBySide(summaryJson, homeTeamName, awayTeamName) {
  const events = summaryJson.keyEvents || [];
  const home = [];
  const away = [];
  for (const e of events) {
    const typeText = (e.type && e.type.text) || '';
    // 버그 수정(2026-09-29, "메시가정보가없다" 리포트로 발견): 득점 페널티는 type.text가
    // "Penalty - Scored"라 "goal" 단어가 없어 이 필터에서 빠졌음 — 자책골(own goal)이 아닌데도
    // 개수 불일치(countMismatch)를 유발해 그 경기 전체(메시 골 포함)의 국적/pid 부착이 통째로
    // 스킵됨(실측: MLS 콜럼버스vs마이애미, 조세프 마티네스 28분 페널티골 하나 때문에 메시 33분
    // 골까지 영향받음). type.text 문자열 매칭 대신 ESPN이 이벤트마다 직접 주는 구조화 필드
    // scoringPlay(득점 이벤트 여부, 페널티 골도 true)로 교체 — 훨씬 안전.
    if (e.scoringPlay !== true) continue;
    const isOwnGoal = /own goal/i.test(typeText);
    const scoringTeam = e.team && e.team.displayName;
    const side = scoringTeam === homeTeamName ? 'home' : scoringTeam === awayTeamName ? 'away' : null;
    if (side == null) continue; // 팀명 매칭 실패 — 이 이벤트는 버림(개수 불일치로 이어져 전체 스킵됨).
    const assist = isOwnGoal ? null : parseAssistFromText(e.text);
    const clockDigits = (e.clock && e.clock.displayValue) || '';
    const clockNum = parseInt(clockDigits, 10);
    // 득점자 국적용 — participants[0]이 득점 선수(자책골이면 자책한 선수, team은 이미 위 주석대로
    // "수혜팀" 기준이라 국적 조회 대상 선수 소속팀 id로 team.id를 그대로 씀).
    const scorerAthleteId = e.participants?.[0]?.athlete?.id;
    // 어시스트 국적용 — participants[1]이 어시스트 선수(같은 팀 소속이라 team.id 재사용). 자책골/
    // 무도움골은 participants가 1명뿐이라 자연히 undefined.
    const assistAthleteId = isOwnGoal ? undefined : e.participants?.[1]?.athlete?.id;
    const entry = {
      a: assist, m: Number.isFinite(clockNum) ? clockNum : null,
      teamId: e.team?.id, athleteId: scorerAthleteId, assistAthleteId, og: isOwnGoal,
    };
    (side === 'home' ? home : away).push(entry);
  }
  return { home, away };
}

// ESPN keyEvents → 카드(경고/퇴장). type.text가 "Yellow Card"/"Red Card"/"Second Yellow Card"
// 셋 다 있음(실측 확인) — Second Yellow도 퇴장이라 R로 취급.
// nat 조회(2026-09-29, 사용자 질문 "백필되면 카드정보에 국기 없는것들도 추가된다 이거지??"
// 계기로 발견 — 카드는 지금까지 국적 조회 로직 자체가 없어서 그 선수가 다른 경기에서 득점/
// 어시스트로 국적이 확인된 적 없으면 클럽 리그 카드는 영원히 국기가 안 붙었음). 득점자와
// 동일하게 팀 로스터 대조로 직접 조회 — 카드는 자책골 개념이 없어 팀 반전 불필요.
async function extractEspnCardsBySide(summaryJson, homeTeamName, awayTeamName, slug, homeTeamId, awayTeamId) {
  const events = summaryJson.keyEvents || [];
  const home = [];
  const away = [];
  for (const e of events) {
    const typeText = (e.type && e.type.text) || '';
    if (!/card/i.test(typeText)) continue;
    const type = /red card|second yellow/i.test(typeText) ? 'R' : 'Y';
    const team = e.team && e.team.displayName;
    const side = team === homeTeamName ? 'home' : team === awayTeamName ? 'away' : null;
    if (side == null) continue;
    const name = e.participants?.[0]?.athlete?.displayName;
    if (!name) continue;
    const clockDigits = (e.clock && e.clock.displayValue) || '';
    const clockNum = parseInt(clockDigits, 10);
    const entry = { n: name, type };
    if (Number.isFinite(clockNum)) entry.m = clockNum;
    // 동명이인 구분용(2026-09-28) — athleteId는 이 이벤트 자체에 이미 있어 추가 fetch 없이 바로 부착.
    const athleteId = e.participants?.[0]?.athlete?.id;
    if (athleteId) {
      entry.pid = `espn:${athleteId}`;
      const teamId = side === 'home' ? homeTeamId : awayTeamId;
      if (teamId) {
        const nat = await getAthleteNationality('soccer', slug, teamId, athleteId);
        if (nat) entry.nat = nat;
      }
    }
    (side === 'home' ? home : away).push(entry);
  }
  return { home, away };
}

// 승부차기 킥별 성공/실패(2026-09-29, 사용자 질문 "승부차기는 누가차고성공실패기록은못가져오나?"
// → 실측 확인 후 "ㄱㄱ하자"로 구현 확정). summary 응답 최상위 shootout 배열(scoreboard 엔 없고
// summary 에만 있음 — FA컵 실경기로 검증) — 팀별로 이미 순서대로 옴 {playerId, player, shotNumber,
// didScore}. 카드와 동일하게 팀명 매칭 후 로스터 대조로 국적 부착(로스터는 같은 경기에서 카드/골
// 추출 시 이미 캐싱돼 추가 fetch 없음).
async function extractEspnShootoutBySide(summaryJson, homeTeamName, awayTeamName, slug, homeTeamId, awayTeamId) {
  const groups = summaryJson.shootout || [];
  const home = [];
  const away = [];
  for (const grp of groups) {
    const side = grp.team === homeTeamName ? 'home' : grp.team === awayTeamName ? 'away' : null;
    if (side == null) continue;
    const teamId = side === 'home' ? homeTeamId : awayTeamId;
    const shots = [...(grp.shots || [])].sort((a, b) => (a.shotNumber ?? 0) - (b.shotNumber ?? 0));
    const arr = side === 'home' ? home : away;
    for (const s of shots) {
      if (!s.player) continue;
      const entry = { n: s.player, made: !!s.didScore, order: s.shotNumber };
      if (s.playerId) {
        entry.pid = `espn:${s.playerId}`;
        if (teamId) {
          const nat = await getAthleteNationality('soccer', slug, teamId, s.playerId);
          if (nat) entry.nat = nat;
        }
      }
      arr.push(entry);
    }
  }
  return { home, away };
}

// EPL/EFL 득점자 — K리그(/relay HTML 파싱)와 완전히 다른 스키마. 이미 구조화된 JSON으로
// /schedule/games/{gameId}?fields=all 의 game.scorers.{home,away}[].{time,addedTime,playerName,ownGoal}
// 에 그대로 들어있음(실측 확인, 2026-09). PK 여부 필드는 이 스키마에 없어 pk는 항상 미표기.
async function fetchStructuredScorers(gameId) {
  const res = await fetch(`${API_BASE}/${gameId}?fields=all`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} game ${gameId}`);
  const json = await res.json();
  const scorers = json?.result?.game?.scorers;
  if (!scorers) return { home: [], away: [] };
  const conv = (arr) =>
    (arr || [])
      .filter((s) => s && (s.playerName || '').trim())
      .map((s) => {
        const out = { n: s.playerName.trim() };
        if (s.time != null) out.m = s.time;
        if (s.ownGoal) out.og = true;
        return out;
      });
  return { home: conv(scorers.home), away: conv(scorers.away) };
}

// 경기 종료 후 사후 정정 재확인(2026-09-29, 실사용 리포트: "이강인골이 손흥민으로바뀌었는데
// 업데이트안되는버그임" — 네이버가 오귀속된 득점자를 경기 후에 정정했는데, final:true로 캐시가
// 영구 고정돼있어 우리는 영원히 옛 이름을 보여주고 있었음. VAR 판독·기록 정정은 경기 직후
// ~반나절 내에 몰려있다고 보고, 킥오프 후 24시간 동안만 시간당 1회 재확인 — 그 이후는 포기
// (오래 지난 경기까지 계속 재확인하면 예산이 무한정 소모됨, 이미 여러 번 겪은 패턴).
const REVALIDATE_WINDOW_MS = 24 * 3600000;
const REVALIDATE_INTERVAL_MS = 3600000;
function needsPostGameRevalidation(g, cached) {
  if (!cached || cached.final !== true || g.status !== 'completed') return false;
  const kickoffMs = naverKickoffUtcMs(g);
  if (!Number.isFinite(kickoffMs)) return false;
  const sinceKickoff = Date.now() - kickoffMs;
  if (sinceKickoff < 0 || sinceKickoff > REVALIDATE_WINDOW_MS) return false;
  const lastCheck = cached.revalidatedAt ? Date.parse(cached.revalidatedAt) : 0;
  return Date.now() - lastCheck >= REVALIDATE_INTERVAL_MS;
}

// 종료+진행중 축구 경기에 득점자(scorers) 부착. scorers.json 캐시로 신규/미확정분만 fetch(리그별로
// 다른 엔드포인트/스키마 — K리그는 /relay 전·후반 2요청, EPL/EFL은 /schedule/games/{id}?fields=all 1요청).
// 진행중(live) 경기는 골이 계속 늘 수 있어 매 실행마다 재조회(final:false)하고, 종료(completed) 시
// 1회만 확정 조회(final:true) 후 캐시 고정 — 10분 주기 폴링(라이브 스코어 수준 정밀도 아님).
// graceful: 실패 게임은 캐시 안 함(다음 run 재시도)+미부착(점수 유지). 0골 경기는 미부착.
async function enrichScorers(allGames) {
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(SCORERS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[scorers] no scorers.json yet — backfilling from scratch');
  }
  // 카드(경고/퇴장) — K리그(SOCCER_LEAGUES)만 지원, /relay를 득점자와 공유해서 fetch 1번으로 같이 뽑음
  // (해외 리그는 스키마 미확인이라 제외, 2026-09-26 사용자 요청으로 K리그부터).
  let cardCache = {};
  try {
    cardCache = JSON.parse(await fs.readFile(CARDS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[cards] no cards.json yet — backfilling from scratch');
  }

  // "화면에 보여지는거만" — 팀 상세 최근경기(리그당 팀별 최근 완료 5경기)와 정확히 같은 기준으로
  // 타겟팅(2026-09-27, 날짜 컷오프 방식은 주 1회 축구/매일 야구처럼 경기 빈도가 다른 종목에
  // 고정폭이 안 맞아 폐기). 버그 발견(2026-09-29, "무슨버그가계속나오냐" 계기로 한 패턴 전수
  // 점검 중 발견): enrichEuroAssists/enrichSaves와 동일하게 n(5) 인자가 누락돼 있었음 — 여기도
  // n=5 복원.
  const recentSoccerIds = buildRecentCompletedGameIds(allGames, new Set([...SOCCER_LEAGUES, ...STRUCTURED_SCORER_LEAGUES]), 5);
  const targets = allGames.filter(
    (g) =>
      (SOCCER_LEAGUES.has(g.league) || STRUCTURED_SCORER_LEAGUES.has(g.league)) &&
      (g.status === 'completed' || g.status === 'live') &&
      g.gameId &&
      (g.status === 'live' || recentSoccerIds.has(g.gameId)),
  );
  // games.json이 날짜 오름차순이라 예산제 백필이 시즌 초(3월)부터 순서대로 처리돼 정작 사용자가
  // 보는 최근 경기엔 몇 주가 지나도 카드가 안 붙는 문제 발견(실측: withCards 59건이 전부 옛날 경기,
  // 최근 K리그 경기는 0건, 2026-09-26) — 최신순으로 정렬해 백필 우선순위를 뒤집음.
  targets.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  let fromCache = 0;
  let fetched = 0;
  let failed = 0;
  // cards.json은 신설 캐시라 이미 scorers.json에 final:true로 캐시된 옛 완료 경기는 needsFetch가
  // false가 돼서 카드가 영영 안 붙는 문제 발생(실측 확인, 2026-09-26) — homeNats 백필과 동일한
  // 패턴으로 카드만 별도 예산 내에서 재조회해 채움(K리그만 대상).
  const CARD_BACKFILL_BUDGET = 60;
  let cardBackfillUsed = 0;
  // 팀당 5경기 캡 제거(2026-09-27)로 대상이 1742→3358로 커져 이 루프도 한 실행에서 끝없이
  // 길어지는 문제 발견 — 완전 신규(캐시 자체가 없는) fetch도 별도 예산으로 나눠 다음 실행들로
  // 분산(enrichSaves/enrichEuroAssists와 동일 패턴).
  const SCORERS_FETCH_BUDGET = 200;
  let scorersFetchUsed = 0;
  // 사후 정정 재확인 전용 예산(위 needsPostGameRevalidation 참고) — 킥오프 24시간 이내 경기만
  // 대상이라 보통 소수라 작게 잡음, 다른 백필 우선순위를 밀어내지 않게 분리.
  const REVALIDATE_BUDGET = 60;
  let revalidateUsed = 0;

  for (const g of targets) {
    const cached = cache[g.gameId];
    const isCardBackfillOnly = SOCCER_LEAGUES.has(g.league) && cached && cached.final !== false &&
      g.status !== 'live' && !(g.gameId in cardCache);
    if (isCardBackfillOnly && cardBackfillUsed >= CARD_BACKFILL_BUDGET) continue;
    const wantsRevalidate = needsPostGameRevalidation(g, cached) && revalidateUsed < REVALIDATE_BUDGET;
    const needsFetch = !cached || g.status === 'live' || (g.status === 'completed' && cached.final === false) || isCardBackfillOnly || wantsRevalidate;
    if (needsFetch && !cached && g.status !== 'live' && scorersFetchUsed >= SCORERS_FETCH_BUDGET) continue; // 완전 신규 fetch 예산 소진 — 다음 실행 재시도.
    if (isCardBackfillOnly) cardBackfillUsed++;
    if (needsFetch && !cached && g.status !== 'live') scorersFetchUsed++;
    if (wantsRevalidate) revalidateUsed++;
    if (needsFetch) {
      try {
        await sleep(REQUEST_DELAY_MS);
        if (STRUCTURED_SCORER_LEAGUES.has(g.league)) {
          const sc = await fetchStructuredScorers(g.gameId);
          cache[g.gameId] = { home: sc.home, away: sc.away, final: g.status === 'completed', revalidatedAt: new Date().toISOString() };
        } else {
          const { scorers: sc, cards: cd } = await fetchScorersAndCards(g.gameId);
          cache[g.gameId] = { home: sc.home, away: sc.away, final: g.status === 'completed', revalidatedAt: new Date().toISOString() };
          cardCache[g.gameId] = { home: cd.home, away: cd.away, final: g.status === 'completed' };
        }
        fetched++;
      } catch (e) {
        failed++;
        console.warn(`[scorers] fetch failed ${g.gameId}: ${e.message}`);
        if (!cached) continue; // 이전 데이터도 없으면 미부착, 다음 run 재시도.
        // 이전(직전 run) 캐시가 있으면 그걸로라도 부착 — 아래에서 사용.
      }
    } else {
      fromCache++;
    }
    const sc = cache[g.gameId];
    if (sc && ((sc.home && sc.home.length) || (sc.away && sc.away.length))) {
      g.scorers = { home: sc.home, away: sc.away };
    }
    const cd = cardCache[g.gameId];
    if (SOCCER_LEAGUES.has(g.league) && cd && ((cd.home && cd.home.length) || (cd.away && cd.away.length))) {
      g.cards = { home: cd.home, away: cd.away };
    }
  }

  // prune: 현 데이터셋의 종료+진행중 축구 gameId 만 남김.
  const validIds = new Set(targets.map((g) => g.gameId));
  const pruned = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) pruned[id] = cache[id];
  }
  await fs.writeFile(SCORERS_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf-8');

  const prunedCards = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cardCache, id)) prunedCards[id] = cardCache[id];
  }
  await fs.writeFile(CARDS_PATH, JSON.stringify(prunedCards, null, 2) + '\n', 'utf-8');

  const withScorers = targets.filter((g) => g.scorers).length;
  const withCards = targets.filter((g) => g.cards).length;
  console.log(
    `[scorers] completedOrLiveSoccer=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} withScorers=${withScorers} withCards=${withCards} revalidateUsed=${revalidateUsed}/${REVALIDATE_BUDGET}`,
  );
}

// K리그 어시스트 부착 — enrichScorers 와 동일한 live=매번 재조회/completed=1회 확정 캐시 패턴.
// 해외 리그(STRUCTURED_SCORER_LEAGUES)는 /lineup 에 assists 필드 자체가 없어 대상에서 제외.
async function enrichAssists(allGames) {
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(ASSISTS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[assists] no assists.json yet — backfilling from scratch');
  }

  const targets = allGames.filter(
    (g) => SOCCER_LEAGUES.has(g.league) && (g.status === 'completed' || g.status === 'live') && g.gameId,
  );
  let fromCache = 0;
  let fetched = 0;
  let failed = 0;
  // 이 필드 추가 전(2026-09-28) 캐시된 완료 경기는 pids가 없어서, 없으면 예산 내에서 강제
  // 재조회 — cards 백필(CARD_BACKFILL_BUDGET)과 동일 패턴.
  const PID_BACKFILL_BUDGET = 60;
  let pidBackfillUsed = 0;

  for (const g of targets) {
    const cached = cache[g.gameId];
    const isPidBackfillOnly = cached && cached.final !== false && g.status !== 'live' && !cached.pids;
    if (isPidBackfillOnly && pidBackfillUsed >= PID_BACKFILL_BUDGET) continue;
    const needsFetch = !cached || g.status === 'live' || (g.status === 'completed' && cached.final === false) || isPidBackfillOnly;
    if (isPidBackfillOnly) pidBackfillUsed++;
    if (needsFetch) {
      try {
        await sleep(REQUEST_DELAY_MS);
        const as = await fetchLineupAssists(g.gameId);
        cache[g.gameId] = { home: as.home, away: as.away, pids: as.pids, final: g.status === 'completed' };
        fetched++;
      } catch (e) {
        failed++;
        console.warn(`[assists] fetch failed ${g.gameId}: ${e.message}`);
        if (!cached) continue;
      }
    } else {
      fromCache++;
    }
    const as = cache[g.gameId];
    if (as && ((as.home && as.home.length) || (as.away && as.away.length))) {
      g.assists = { home: as.home, away: as.away };
    }
    // 동명이인 구분용 Naver playerId 부착(2026-09-28) — enrichScorers가 먼저 실행돼 g.scorers/
    // g.cards가 이미 채워져있는 상태(main()의 호출 순서). 이름이 일치하는 항목에만 pid를 붙임
    // (이 게임 로스터에 없는 이름이면 안 붙임 — 오매칭 방지, 자책골처럼 이름이 반대쪽에 실리는
    // 경우도 로스터 측 매칭이라 자연히 올바른 쪽에서 찾아짐).
    if (as?.pids) {
      // 자책골(og)은 "득점 수혜팀" 배열에 실리지만 실제 득점 선수는 상대팀 로스터 소속이라
      // (App.tsx ScorerLine/build-player-index.mjs와 동일 반전 원칙) 반대쪽 pid맵에서 찾음.
      const tagSide = (arr, ownPidMap, oppPidMap) => {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
          const pid = item.og ? oppPidMap[item.n] : ownPidMap[item.n];
          if (pid) item.pid = `naver:${pid}`;
        }
      };
      if (g.scorers) {
        tagSide(g.scorers.home, as.pids.home, as.pids.away);
        tagSide(g.scorers.away, as.pids.away, as.pids.home);
      }
      if (g.cards) {
        tagSide(g.cards.home, as.pids.home, as.pids.away);
        tagSide(g.cards.away, as.pids.away, as.pids.home);
      }
    }
  }

  const validIds = new Set(targets.map((g) => g.gameId));
  const pruned = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) pruned[id] = cache[id];
  }
  await fs.writeFile(ASSISTS_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf-8');

  const withAssists = targets.filter((g) => g.assists).length;
  console.log(
    `[assists] completedOrLiveKleague=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} withAssists=${withAssists}`,
  );
}

// game.date/time 은 Naver 표기 그대로 KST(UTC+9) 로 저장돼 있음(실측: 첼시-브라이턴 2026-08-30
// 22:00 KST = ESPN 2026-08-30T13:00Z 일치 확인) → UTC ms 로 변환해 ESPN 이벤트와 매칭.
function naverKickoffUtcMs(g) {
  return Date.parse(`${g.date}T${g.time}:00+09:00`);
}

// 유럽 5대리그(EPL/EFL/LALIGA/BUNDESLIGA/SERIEA/LIGUE1) 어시스트 — ESPN summary 의 goal 텍스트에서
// 파싱해 이미 붙어있는 g.scorers(enrichScorers 가 먼저 실행되어 있어야 함) 항목에 a 필드로 부착.
// 이름 매칭이 불가능해(언어 다름) 킥오프 시각+골 개수 일치로만 안전하게 짝짓고, 조금이라도 불확실하면
// (이벤트 미발견/개수 불일치) 그 경기는 그냥 스킵 — 오귀속보다 미부착이 낫다는 원칙.
async function enrichEuroAssists(allGames) {
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(EURO_ASSISTS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[euroAssists] no euro_assists.json yet — backfilling from scratch');
  }
  // 카드(경고/퇴장) — 같은 대상 경기에서 이미 fetchEspnSummary로 받아온 summary를 그대로
  // 재사용해서 추출(추가 fetch 없음). 어시스트/국적 매칭 성공 여부(countMismatch)와 무관하게
  // 독립적으로 부착 — 카드는 골 개수와 zip할 필요가 없어서 더 안전하게 항상 시도.
  let cardCache = {};
  try {
    cardCache = JSON.parse(await fs.readFile(EURO_CARDS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[euroCards] no euro_cards.json yet — backfilling from scratch');
  }
  // 승부차기 킥별 기록(2026-09-29) — PK 스코어가 있는 경기만 대상, 카드와 동일하게 이미 받아온
  // summary 재사용(추가 fetch 없음).
  let shootoutCache = {};
  try {
    shootoutCache = JSON.parse(await fs.readFile(EURO_SHOOTOUT_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[euroShootout] no euro_shootout.json yet — backfilling from scratch');
  }
  // 자동 확장 선수명 사전(2026-09-28) — 매칭 성공한 득점자마다 실제 영문명을 여기 누적.
  let autoPlayerNames = {};
  try {
    autoPlayerNames = JSON.parse(await fs.readFile(PLAYER_NAME_AUTO_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[playerNameAuto] no player-name-auto.json yet — starting fresh');
  }

  // 0-0 무득점 경기도 카드는 붙어야 해서(사용자 요청, 2026-09-26) g.scorers 존재 요건을 뺌 —
  // 어시스트/국적 로직은 원래대로 scorers가 없으면 그냥 빈 배열([].length===0)로 자연히 스킵됨.
  // 타겟팅도 enrichScorers와 동일하게 날짜 컷오프 대신 팀별 최근 완료 5경기 기준으로 교체
  // (2026-09-27, "화면에 보여주는거만 채워줘"). 버그 발견(2026-09-29, 백필현황 점검 중): n(5)
  // 인자가 실제로는 안 넘어가고 있어서 buildRecentCompletedGameIds 기본값(Infinity)이 적용돼
  // 있었음 — 이 함수가 관리하는 전체(3,340경기) 중 94%(3,152건)가 매번 "백필 필요" 대상이
  // 돼서 80/run 예산을 최신순 정렬로 나눠 먹느라 몇 달 지난 경기는 사실상 영구 방치되던 버그
  // (승부차기 신기능 조사 중 발견 — 3월 FA컵 실경기가 우선순위 3142번째로 밀려 있었음).
  const recentEuroIds = buildRecentCompletedGameIds(allGames, new Set(Object.keys(ESPN_LEAGUE_SLUG)), 5);
  const targets = allGames.filter(
    (g) =>
      ESPN_LEAGUE_SLUG[g.league] &&
      (g.status === 'completed' || g.status === 'live') &&
      g.gameId &&
      (g.status === 'live' || recentEuroIds.has(g.gameId)),
  );
  // enrichScorers와 동일 이유(날짜 오름차순 배열이라 예산제 백필이 시즌 초부터 처리돼 최근
  // 경기가 몇 주째 안 채워짐, 실측 확인) — 최신순으로 정렬해 우선순위 뒤집음.
  targets.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  let fromCache = 0;
  let fetched = 0;
  let failed = 0;
  let noMatch = 0;
  let countMismatch = 0;
  const scoreboardCache = new Map(); // `${slug}:${yyyymmdd}` → events[], 같은 실행 내 중복 요청 방지.
  // homeNats/awayNats 없는 옛 캐시(국적 필드 도입 전, 2026-09-13) 백필 — 한 번에 다 하면 실행이
  // 25분+ 로 늘어나 5분 간격 외부 트리거와 겹쳐 실행이 계속 밀리고 push 경합 실패가 반복됨
  // (2026-09-13 실측). 실행당 예산을 두고 나머지는 다음 실행들로 자연 분산.
  const BACKFILL_BUDGET = 80; // 실행시간 2.6~3.7분으로 안정 확인(2026-09-13) — 여유 있어 상향.
  let backfillUsed = 0;

  for (const g of targets) {
    const cached = cache[g.gameId];
    const needsCardBackfill = g.status !== 'live' && !(g.gameId in cardCache);
    // 승부차기 있는 경기(PK 스코어 존재)만 대상 — 나머지 대다수 경기엔 애초에 shootout 자체가
    // 없어 무의미한 백필 트리거를 안 만듦.
    const needsShootoutBackfill = g.status !== 'live' && (g.homePkScore != null || g.awayPkScore != null) && !(g.gameId in shootoutCache);
    // 0-0 무득점 경기를 대상에 새로 포함시키면서(2026-09-26) 이 경기들은 cache[g.gameId] 자체가
    // 아예 없어(!cached) 예산 체크를 건너뛰고 무제한으로 fetch되는 버그 발생 — 실행이 몇 분 만에
    // 끝나던 게 계속 진행중으로 관측됨(실측). live가 아닌 한(실시간 급하지 않음) "완전 신규"도
    // 같은 예산 풀에 넣어서 과거 미완료분처럼 여러 실행에 걸쳐 나눠 처리되게 함.
    const isBackfillOnly = g.status !== 'live' && (
      !cached ||
      (cached.final !== false &&
        ((!('homeNats' in cached) || !('awayNats' in cached) || !('homeANats' in cached) || !('awayANats' in cached) ||
          !('homePids' in cached) || !('awayPids' in cached)) || needsCardBackfill || needsShootoutBackfill))
    );
    if (isBackfillOnly && backfillUsed >= BACKFILL_BUDGET) continue; // 이번 실행 예산 소진 — 다음 실행에서 재시도.
    const needsFetch = !cached || g.status === 'live' || (g.status === 'completed' && cached.final === false) || isBackfillOnly;
    if (isBackfillOnly) backfillUsed++;
    if (needsFetch) {
      try {
        const slug = ESPN_LEAGUE_SLUG[g.league];
        const kickoffMs = naverKickoffUtcMs(g);
        const yyyymmdd = new Date(kickoffMs).toISOString().slice(0, 10).replace(/-/g, '');
        const sbKey = `${slug}:${yyyymmdd}`;
        let events = scoreboardCache.get(sbKey);
        if (!events) {
          await sleep(REQUEST_DELAY_MS);
          events = await fetchEspnScoreboard(slug, yyyymmdd);
          scoreboardCache.set(sbKey, events);
        }
        // 동시킥오프+동일스코어 오매칭 방지 로직 — espn-match-select.mjs 참고(2026-09-28,
        // backfill-player-name-auto.mjs와 공유하도록 분리됨).
        const match = selectUniqueScoreMatch(events, kickoffMs, g.homeScore, g.awayScore);
        if (!match) {
          noMatch++;
          // completed 인데 이벤트 자체를 못 찾으면(ESPN 미중계 등) 영구 불가로 보고 확정 캐시 —
          // live 는 다음 run 에 스코어보드가 갱신될 수 있어 재시도 유지(캐시 안 함).
          if (g.status === 'completed') {
            cache[g.gameId] = { homeAssists: [], awayAssists: [], homeNats: [], awayNats: [], homeANats: [], awayANats: [], final: true };
            // 카드 캐시도 같이 확정 스텁 처리 — 안 그러면 needsCardBackfill이 영원히 true로 남아
            // ESPN 미중계 경기(군소리그에 흔함)가 매 실행마다 예산을 계속 잡아먹어 다른(특히
            // 신규 38개국) 리그의 백필이 굶는 문제 발생(2026-09-26 실측 발견 — 신규 확장 리그들
            // 상당수가 몇 시간째 카드 0건).
            if (!cardCache[g.gameId]) cardCache[g.gameId] = { home: [], away: [], final: true };
          }
          if (!cached) continue;
        } else {
          const comp = match.competitions?.[0];
          const homeC = comp?.competitors?.find((c) => c.homeAway === 'home');
          const awayC = comp?.competitors?.find((c) => c.homeAway === 'away');
          await sleep(REQUEST_DELAY_MS);
          const summary = await fetchEspnSummary(slug, match.id);
          // 카드는 골 개수 일치 여부와 무관하게 독립적으로 추출(zip 불필요라 더 안전).
          const espnCards = await extractEspnCardsBySide(summary, homeC?.team?.displayName, awayC?.team?.displayName, slug, homeC?.team?.id, awayC?.team?.id);
          cardCache[g.gameId] = { home: espnCards.home, away: espnCards.away, final: g.status === 'completed' };
          if (g.homePkScore != null || g.awayPkScore != null) {
            const espnShootout = await extractEspnShootoutBySide(summary, homeC?.team?.displayName, awayC?.team?.displayName, slug, homeC?.team?.id, awayC?.team?.id);
            if (espnShootout.home.length || espnShootout.away.length) {
              shootoutCache[g.gameId] = { home: espnShootout.home, away: espnShootout.away, final: g.status === 'completed' };
            }
          }
          const espnGoals = extractEspnGoalsBySide(summary, homeC?.team?.displayName, awayC?.team?.displayName);
          const naverHomeLen = (g.scorers?.home || []).length;
          const naverAwayLen = (g.scorers?.away || []).length;
          if (espnGoals.home.length !== naverHomeLen || espnGoals.away.length !== naverAwayLen) {
            countMismatch++;
            // completed 인데 골 개수가 계속 안 맞으면(팀명 매칭 실패 등 구조적 문제) 매 10분 재시도해도
            // 안 맞을 확률이 높음 — 확정 캐시로 고정해 무한 재시도 방지(live 는 계속 재시도).
            if (g.status === 'completed') {
              cache[g.gameId] = { homeAssists: [], awayAssists: [], homeNats: [], awayNats: [], homeANats: [], awayANats: [], final: true };
            }
            if (!cached) continue;
          } else {
            // 시간순 정렬 후 짝짓기 — 원본 배열 순서(App 표시 순서)는 건드리지 않고 객체 참조로만
            // a(어시스트)·nat(득점자 국적) 부착. nat은 이름 매칭이 아니라 이미 시각+스코어로 확정된
            // 이 골 이벤트의 athleteId를 그 팀 로스터에서 정확히 조회한 값이라 오매칭 없음. 자책골은
            // team.id(수혜팀)에 실제 득점 선수가 없어 국적 조회가 항상 실패하던 구조적 버그가
            // 있었음(2026-09-28 실사용 리포트로 발견) — oppTeamId(반대팀)로 대신 조회하도록 수정.
            const zip = async (naverArr, espnArr, oppTeamId) => {
              const naverSorted = [...naverArr].sort((a, b) => (a.m ?? 999) - (b.m ?? 999));
              const espnSorted = [...espnArr].sort((a, b) => (a.m ?? 999) - (b.m ?? 999));
              for (let i = 0; i < naverSorted.length; i++) {
                const s = naverSorted[i];
                const espnEntry = espnSorted[i];
                if (espnEntry?.a) s.a = espnEntry.a;
                const scorerTeamId = espnEntry?.og ? oppTeamId : espnEntry?.teamId;
                if (scorerTeamId && espnEntry?.athleteId) {
                  const nat = await getAthleteNationality('soccer', slug, scorerTeamId, espnEntry.athleteId);
                  if (nat) s.nat = nat;
                  // s.n(득점자, 네이버 원문)은 늘 한글 — 이 골이 실제로 어느 ESPN 선수인지는 이미
                  // athleteId로 확정됐으니, 그 선수의 진짜 영문명(displayName)을 자동사전에 적립.
                  // 수작업 사전(PLAYER_NAME_EN)과 달리 ESPN 연동 리그에서 매칭 성공하는 모든 선수를
                  // 자동으로 커버(2026-09-28, "모든 선수 미리 가지고 있으면" 요청 대응).
                  if (s.n) {
                    const displayName = await getAthleteDisplayName('soccer', slug, scorerTeamId, espnEntry.athleteId);
                    if (displayName) autoPlayerNames[s.n] = displayName;
                  }
                  // 동명이인 구분용 고유ID(2026-09-28) — 추가 fetch 불필요, 이미 확정된 athleteId 그대로.
                  s.pid = `espn:${espnEntry.athleteId}`;
                }
                // 어시스트 국적 — 어시스트 선수는 득점자와 같은 팀이라 teamId 재사용(자책골엔
                // 애초에 어시스트가 안 붙음, extractEspnGoalsBySide에서 이미 null 처리).
                if (espnEntry?.teamId && espnEntry?.assistAthleteId) {
                  const aNat = await getAthleteNationality('soccer', slug, espnEntry.teamId, espnEntry.assistAthleteId);
                  if (aNat) s.aNat = aNat;
                  s.apid = `espn:${espnEntry.assistAthleteId}`;
                }
              }
            };
            await zip(g.scorers?.home || [], espnGoals.home, awayC?.team?.id);
            await zip(g.scorers?.away || [], espnGoals.away, homeC?.team?.id);
            cache[g.gameId] = {
              homeAssists: (g.scorers?.home || []).map((s) => s.a || null),
              awayAssists: (g.scorers?.away || []).map((s) => s.a || null),
              homeNats: (g.scorers?.home || []).map((s) => s.nat || null),
              awayNats: (g.scorers?.away || []).map((s) => s.nat || null),
              homeANats: (g.scorers?.home || []).map((s) => s.aNat || null),
              awayANats: (g.scorers?.away || []).map((s) => s.aNat || null),
              homePids: (g.scorers?.home || []).map((s) => s.pid || null),
              awayPids: (g.scorers?.away || []).map((s) => s.pid || null),
              homeAPids: (g.scorers?.home || []).map((s) => s.apid || null),
              awayAPids: (g.scorers?.away || []).map((s) => s.apid || null),
              final: g.status === 'completed',
            };
            fetched++;
          }
        }
      } catch (e) {
        failed++;
        console.warn(`[euroAssists] fetch failed ${g.gameId}: ${e.message}`);
        if (!cached) continue;
      }
    } else {
      fromCache++;
    }
    // 캐시 적중(또는 방금 실패해 이전 캐시로 폴백)이면 캐시된 이름/국적을 원본 순서 그대로 재적용.
    const c = cache[g.gameId];
    if (c && !needsFetch) {
      (g.scorers?.home || []).forEach((s, i) => {
        if (c.homeAssists?.[i]) s.a = c.homeAssists[i];
        if (c.homeNats?.[i]) s.nat = c.homeNats[i];
        if (c.homeANats?.[i]) s.aNat = c.homeANats[i];
        if (c.homePids?.[i]) s.pid = c.homePids[i];
        if (c.homeAPids?.[i]) s.apid = c.homeAPids[i];
      });
      (g.scorers?.away || []).forEach((s, i) => {
        if (c.awayAssists?.[i]) s.a = c.awayAssists[i];
        if (c.awayNats?.[i]) s.nat = c.awayNats[i];
        if (c.awayANats?.[i]) s.aNat = c.awayANats[i];
        if (c.awayPids?.[i]) s.pid = c.awayPids[i];
        if (c.awayAPids?.[i]) s.apid = c.awayAPids[i];
      });
    }
    const cd = cardCache[g.gameId];
    if (cd && ((cd.home && cd.home.length) || (cd.away && cd.away.length))) {
      g.cards = { home: cd.home, away: cd.away };
    }
    const so = shootoutCache[g.gameId];
    if (so && ((so.home && so.home.length) || (so.away && so.away.length))) {
      g.shootout = { home: so.home, away: so.away };
    }
  }

  const validIds = new Set(targets.map((g) => g.gameId));
  const pruned = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) pruned[id] = cache[id];
  }
  await fs.writeFile(EURO_ASSISTS_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf-8');

  const prunedCards = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cardCache, id)) prunedCards[id] = cardCache[id];
  }
  await fs.writeFile(EURO_CARDS_PATH, JSON.stringify(prunedCards, null, 2) + '\n', 'utf-8');

  const prunedShootout = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(shootoutCache, id)) prunedShootout[id] = shootoutCache[id];
  }
  await fs.writeFile(EURO_SHOOTOUT_PATH, JSON.stringify(prunedShootout, null, 2) + '\n', 'utf-8');
  await fs.writeFile(PLAYER_NAME_AUTO_PATH, JSON.stringify(autoPlayerNames, null, 2) + '\n', 'utf-8');

  const withCards = targets.filter((g) => g.cards).length;
  const withShootout = targets.filter((g) => g.shootout).length;
  console.log(
    `[euroAssists] targets=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} noMatch=${noMatch} countMismatch=${countMismatch} backfillUsed=${backfillUsed}/${BACKFILL_BUDGET} withCards=${withCards} withShootout=${withShootout}`,
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
  // 선발투수(경기 전) pid(2026-09-29, 선수 정보 카드용) — player-codes.json 레지스트리 매칭 성공시만.
  if (g.awayPitcherPid) out.awayPitcherPid = g.awayPitcherPid;
  if (g.homePitcherPid) out.homePitcherPid = g.homePitcherPid;
  // 0 도 유효 점수라 typeof 가드 (falsy 체크 금지).
  if (typeof g.awayScore === 'number') out.awayScore = g.awayScore;
  if (typeof g.homeScore === 'number') out.homeScore = g.homeScore;
  // 야구 진행중 인닝 정보 ("5회말" 등) — 앱에서 team 이름과 조합해 공격/수비 표시.
  if (g.inningInfo) out.inningInfo = g.inningInfo;
  if (g.matchPeriod) out.matchPeriod = g.matchPeriod;
  // 종료 경기 승/패/세 투수 (KBO). 있는 것만 — 무승부·세이브 없는 경기는 일부/전부 누락.
  if (g.winPitcher) out.winPitcher = g.winPitcher;
  if (g.losePitcher) out.losePitcher = g.losePitcher;
  if (g.savePitcher) out.savePitcher = g.savePitcher;
  // 선발투수 국적(MLB만, 2026-09-29) — mlb-nationality.mjs의 decisions API 매칭.
  if (g.winPitcherNat) out.winPitcherNat = g.winPitcherNat;
  if (g.losePitcherNat) out.losePitcherNat = g.losePitcherNat;
  if (g.savePitcherNat) out.savePitcherNat = g.savePitcherNat;
  // 투수 pid(MLB personId, 2026-09-29) — 선수 정보 카드에서 statsapi.mlb.com 상세 조회용.
  if (g.winPitcherPid) out.winPitcherPid = g.winPitcherPid;
  if (g.losePitcherPid) out.losePitcherPid = g.losePitcherPid;
  if (g.savePitcherPid) out.savePitcherPid = g.savePitcherPid;
  // 홀드 투수(2026-09-29) — 팀별 배열, 빈 팀 쪽은 생략 가능하니 둘 중 하나라도 있으면 통째로 실음.
  if (g.holds && ((g.holds.home && g.holds.home.length) || (g.holds.away && g.holds.away.length))) out.holds = g.holds;
  // 야구 하이라이트(홈런/2루타/도루/실책/병살타/결승타 등) — KBO/MLB/NPB 최근 3일 경기만.
  if (g.highlights) out.highlights = g.highlights;
  // 축구 득점자 — 종료+진행중 경기, 골 있을 때만. {home,away} 각 [{m,n,pk?,og?}].
  if (g.scorers) out.scorers = g.scorers;
  // 축구 카드(경고/퇴장) — K리그만, 있을 때만. {home,away} 각 [{n,type:'Y'|'R',m?}].
  if (g.cards) out.cards = g.cards;
  // 승부차기 킥별 성공/실패(ESPN 연동 리그만, 2026-09-29). {home,away} 각 [{n,made,order,pid?,nat?}].
  if (g.shootout && ((g.shootout.home && g.shootout.home.length) || (g.shootout.away && g.shootout.away.length))) out.shootout = g.shootout;
  // K리그 어시스트 — 종료+진행중, 이 경기 누적 어시스트 있을 때만. {home,away} 각 [{n,count}].
  // 득점자와 달리 특정 골에 귀속되지 않음(스키마 한계, K리그1/2 전용 — 해외 리그는 미제공).
  if (g.assists) out.assists = g.assists;
  // 토너먼트 라운드/차전 — 있는 리그(국가대표·클럽컵 등)만, 리그전은 필드 자체 없음.
  if (g.phaseCode) out.phaseCode = g.phaseCode;
  if (g.leg) out.leg = g.leg;
  if (typeof g.homeAggregateScore === 'number') out.homeAggregateScore = g.homeAggregateScore;
  if (typeof g.awayAggregateScore === 'number') out.awayAggregateScore = g.awayAggregateScore;
  // 승부차기(PK) 스코어 — convertGame()이 채워도 이 화이트리스트에 없으면 저장 직전에 누락됨.
  if (typeof g.homePkScore === 'number') out.homePkScore = g.homePkScore;
  if (typeof g.awayPkScore === 'number') out.awayPkScore = g.awayPkScore;
  return out;
}

// naverStadiumMap.json은 직접 조사한 원문라벨→venueId 매핑표라 2026-09-21부터 비공개
// 저장소(shadowstadium-secrets)에서 base64로 보관 — PRIVATE_DATA_TOKEN(이 저장소 Contents:
// Read-only 권한의 fine-grained PAT)으로만 읽힘. 로컬 개발 시에도 같은 토큰을 환경변수로
// 설정해야 함 (로컬 평문 사본은 더 이상 이 저장소에 두지 않음).
async function loadStadiumMap() {
  const token = process.env.PRIVATE_DATA_TOKEN;
  if (!token) {
    throw new Error('PRIVATE_DATA_TOKEN 환경변수가 없습니다 — naverStadiumMap.json은 비공개 저장소에서만 읽을 수 있습니다.');
  }
  const res = await fetch(
    'https://api.github.com/repos/janetyoon85/shadowstadium-secrets/contents/naverStadiumMap.json.b64',
    { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.raw' } },
  );
  if (!res.ok) {
    throw new Error(`naverStadiumMap.json 비공개 저장소 fetch 실패: HTTP ${res.status}`);
  }
  const b64 = await res.text();
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

async function main() {
  const startMs = Date.now();
  console.log(`[start] ${new Date().toISOString()}`);

  // 실제 크롤링 없이 Discord 알림 경로만 검증하는 테스트 모드 (workflow_dispatch test_discord=true).
  if (process.env.TEST_DISCORD === 'true') {
    console.log('[test] TEST_DISCORD=true — 크롤링 생략, 가짜 미매핑 구장으로 알림만 발송');
    await notifyMappingFailures([
      { categoryId: 'kleague', stadium: '(테스트) 새로생긴 어딘가 스타디움' },
    ]);
    console.log('[test] 알림 발송 완료 (webhook 미설정이면 조용히 스킵됨)');
    return;
  }

  const stadiumMap = await loadStadiumMap();

  const allGames = [];
  const mapFailures = [];
  const categoryCounts = {};

  for (const cat of CATEGORIES) {
    const raw = await fetchCategory(cat);
    const converted = raw.map((g) => convertGame(g, cat, stadiumMap, mapFailures)).filter(Boolean);
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
    // 승격·강등으로 새 팀/새 구장이 생기면 naverStadiumMap.json에 없는 stadium 텍스트가
    // 나타남 — 그 경기는 venueId 없이 필터되어 조용히 사라지므로(에러 아님, 빌드는 성공)
    // 실패로 처리하지 않고 별도 Discord 알림으로 능동적으로 알림.
    await notifyMappingFailures(uniqueFails);
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
  // 축구 득점자 부착 (종료+진행중, /relay 또는 /schedule/games/{id}?fields=all 캐시).
  await enrichScorers(allGames);
  // K리그 어시스트 부착 (종료+진행중, /lineup 캐시 — K리그1/2 전용).
  await enrichAssists(allGames);
  // 유럽 5대리그 어시스트 부착 (ESPN, 종료+진행중 — 킥오프 시각+골 개수 일치 시에만).
  await enrichEuroAssists(allGames);

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
    console.error(`\n[fail] validator rejected — games.json NOT updated`);
    process.exit(1);
  }

  const prodPath = path.join(REPO_ROOT, 'games.json');
  const exportGames = allGames.filter((g) => g.venueId);
  const filteredOut = allGames.length - exportGames.length;
  const serialized = exportGames.map(serializeGame);

  // 이 스크립트가 모르는 리그(MLB/NPB/EPL/EFL 등 — buildGameData.py가 별도로 채워 넣는 파일럿
  // 리그)는 건드리지 않고 보존한다. 예전엔 games.json을 통째로 덮어써서, 매 크론 실행마다
  // 수동으로 병합해둔 해외 리그 데이터가 지워지는 사고가 있었음(2026-09-09).
  const knownLeagues = new Set(CATEGORIES.map((c) => c.league));
  let preserved = [];
  // 이 스크립트도 실행 시작(체크아웃) 시점 이후 다른 크롤러(AAA·ESPN 등)가 먼저 커밋한 최신
  // 갱신분을 놓치고 있을 수 있음 — preserved 목록을 읽기 직전에 원격 최신으로 동기화해서
  // 이 스크립트가 그 최신 갱신을 되돌리는 경합을 방지(실사용자 리포트: MLB 이닝 정보가
  // 계속 옛날 값으로 되돌아감, 2026-09-27 — 반대 방향 race도 같은 클래스라 여기도 적용).
  try {
    execSync('git pull origin main', { cwd: REPO_ROOT, stdio: 'inherit' });
  } catch (e) {
    console.warn('[preserve] git pull 실패(로컬 상태로 계속 진행):', e.message);
  }
  try {
    const existing = JSON.parse(await fs.readFile(prodPath, 'utf-8'));
    preserved = existing.filter((g) => !knownLeagues.has(g.league));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  console.log(`\n[preserve] keeping ${preserved.length} games from leagues this script doesn't manage`);

  const finalGames = [...serialized, ...preserved];
  sortGames(finalGames);
  await fs.writeFile(prodPath, JSON.stringify(finalGames, null, 2) + '\n', 'utf-8');
  console.log(`\n[update] ${prodPath} replaced (${serialized.length} own + ${preserved.length} preserved = ${finalGames.length} games, ${filteredOut} filtered out for missing venueId)`);

  const dur = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[done] ${new Date().toISOString()} (${dur}s)`);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});

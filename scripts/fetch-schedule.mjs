import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from './validators.mjs';
import { getAthleteNationality } from './espn-nationality.mjs';

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
// 앱은 과거 ~며칠 전 ~ 미래 2주 정도만 화면에서 볼 수 있어(홈 화면 날짜 네비게이션 범위) 시즌
// 초(3월)까지 거슬러 올라가는 카드/어시스트 백필은 사용자 눈엔 절대 안 보이는 낭비 작업 —
// 예산을 화면에 실제로 보이는 최근 경기에만 쓰도록 날짜 컷오프 추가(사용자 지적, 2026-09-26).
const CARD_ENRICH_CUTOFF_DAYS = 3; // 사용자 지시로 30→3일 축소, 백필 대상 대폭 감소(2026-09-26).
function cardEnrichCutoffDateStr() {
  const d = new Date(Date.now() - CARD_ENRICH_CUTOFF_DAYS * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
// etcRecords: [{result, how}] — 홈런/2루타/도루/실책/병살타/결승타 등 이미 정리된 하이라이트인데,
// team 필드가 없어 양팀 선수가 한 문자열에 섞여 나옴(예: "박민우(1회) 한재환(3회)"가 실제론
// 서로 다른 팀 선수). "심판"(그 경기 심판진 명단)만 실제 경기 하이라이트가 아니라서 제외.
// 2026-09-26: 사용자 요청("축구처럼 팀 나누어서 표기해줘야해")으로 팀별 분리 추가 —
// 같은 /record 응답의 battersBoxscore/pitchersBoxscore(홈/원정 로스터, 추가 요청 없음)에서
// 이름 집합을 만들어 각 "이름(디테일)" 토큰을 로스터 매칭으로 홈/원정 귀속.
function classifyHighlightSide(name, homeNames, awayNames) {
  if (homeNames.has(name)) return 'home';
  if (awayNames.has(name)) return 'away';
  return null;
}
function parseBaseballHighlights(rd) {
  const etcRecords = rd?.etcRecords;
  if (!Array.isArray(etcRecords)) return undefined;
  const homeNames = new Set([
    ...(rd?.battersBoxscore?.home || []).map((p) => p?.name).filter(Boolean),
    ...(rd?.pitchersBoxscore?.home || []).map((p) => p?.name).filter(Boolean),
  ]);
  const awayNames = new Set([
    ...(rd?.battersBoxscore?.away || []).map((p) => p?.name).filter(Boolean),
    ...(rd?.pitchersBoxscore?.away || []).map((p) => p?.name).filter(Boolean),
  ]);
  const home = [];
  const away = [];
  // "강백호33호(4회2점 구창모)"처럼 시즌 홈런 개수(숫자+호)가 이름에 바로 붙는 표기도 있어
  // 이름 자체는 한글/영문만(숫자 제외)으로 잡고 그 뒤 숫자+호는 통째로 매치에 포함만 시킴.
  const playerTokenRe = /([가-힣A-Za-z]+)(?:\d+호)?\(([^)]*)\)/g;
  for (const e of etcRecords) {
    if (!e || !e.how || e.how === '심판') continue;
    const result = (e.result || '').trim();
    if (!result) continue;
    playerTokenRe.lastIndex = 0;
    let m;
    let matched = false;
    while ((m = playerTokenRe.exec(result))) {
      matched = true;
      const side = classifyHighlightSide(m[1], homeNames, awayNames);
      const entry = { how: e.how, text: m[0] };
      if (side === 'home') home.push(entry);
      else away.push(entry); // 로스터 매칭 실패(외국인 표기차 등)도 정보 유실 방지로 away 폴백.
    }
    if (!matched) away.push({ how: e.how, text: result }); // 파싱 실패 — 원문 그대로 폴백.
  }
  return { home, away };
}

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
  return { save, highlights: parseBaseballHighlights(rd) };
}
// 하이라이트(홈런 등)는 새 필드라 옛 캐시(saves.json, 지금까지는 savePitcher 문자열만 저장)엔
// 당연히 없음 — 사용자 지시대로 전체 백필은 안 하고 최근 3일 경기만 다시 조회해서 채움
// ("백필할필요없고 백필은 3일전데이터만있으면돼", 2026-09-26). 3일보다 오래된 경기는
// 화면에 안 보이니 옛 문자열 캐시 그대로 둠(불필요한 재조회 없음).
const HIGHLIGHT_CUTOFF_DAYS = 3;
function highlightCutoffDateStr() {
  const d = new Date(Date.now() - HIGHLIGHT_CUTOFF_DAYS * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

  const targets = allGames.filter(
    (g) => BASEBALL_LEAGUES.has(g.league) && g.status === 'completed' && g.gameId,
  );
  let fromCache = 0;
  let fetched = 0;
  let failed = 0;
  const highlightCutoff = highlightCutoffDateStr();

  for (const g of targets) {
    const cached = cache[g.gameId];
    // 옛 캐시는 savePitcher 문자열(또는 null) 그대로 — {save, highlights} 새 포맷과 구분.
    const isNewFormat = cached && typeof cached === 'object';
    // highlights 옛 포맷은 평면 배열(팀 구분 없음), 새 포맷은 {home,away} 객체(2026-09-26,
    // "축구처럼 팀 나누어" 요청으로 분리) — 배열이면 아직 안 갈라진 옛 캐시로 간주해 재조회.
    const isSplitHighlightFormat =
      isNewFormat && cached.highlights && typeof cached.highlights === 'object' && !Array.isArray(cached.highlights);
    const needsHighlightRefetch = g.date >= highlightCutoff && !isSplitHighlightFormat;
    if (cached === undefined || needsHighlightRefetch) {
      try {
        await sleep(REQUEST_DELAY_MS);
        cache[g.gameId] = await fetchGameRecord(g.gameId);
        fetched++;
      } catch (e) {
        failed++;
        console.warn(`[saves] fetch failed ${g.gameId}: ${e.message}`);
        if (cached === undefined) continue; // 캐시 자체가 없으면 다음 run 재시도, 미부착.
        // 옛 캐시가 있으면(리페치 실패해도) 그걸로라도 부착 — 아래에서 사용.
      }
    } else {
      fromCache++;
    }
    const rec = cache[g.gameId];
    if (rec) {
      if (typeof rec === 'string') {
        g.savePitcher = rec; // 옛 포맷
      } else {
        if (rec.save) g.savePitcher = rec.save;
        if (rec.highlights && ((rec.highlights.home && rec.highlights.home.length) || (rec.highlights.away && rec.highlights.away.length))) {
          g.highlights = rec.highlights;
        }
      }
    }
  }

  // prune: 현 데이터셋의 종료 야구(KBO/MLB/NPB) gameId 만 남김 (캐시한 값이 있는 것만).
  const validIds = new Set(targets.map((g) => g.gameId));
  const pruned = {};
  for (const id of validIds) {
    if (Object.prototype.hasOwnProperty.call(cache, id)) pruned[id] = cache[id];
  }
  await fs.writeFile(SAVES_PATH, JSON.stringify(pruned, null, 2) + '\n', 'utf-8');

  const withSave = targets.filter((g) => g.savePitcher).length;
  const withHighlights = targets.filter((g) => g.highlights).length;
  console.log(
    `[saves] completedBaseball=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} withSave=${withSave} withHighlights=${withHighlights}`,
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

async function fetchLineupAssists(gameId) {
  const res = await fetch(LINEUP_API(gameId), { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} lineup ${gameId}`);
  const json = await res.json();
  const lineup = json?.result?.lineUpData?.lineup;
  if (!lineup) return { home: [], away: [] };
  return {
    home: extractAssists(lineup.home?.players),
    away: extractAssists(lineup.away?.players),
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
function extractEspnGoalsBySide(summaryJson, homeTeamName, awayTeamName) {
  const events = summaryJson.keyEvents || [];
  const home = [];
  const away = [];
  for (const e of events) {
    const typeText = (e.type && e.type.text) || '';
    if (!/goal/i.test(typeText)) continue;
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
      teamId: e.team?.id, athleteId: scorerAthleteId, assistAthleteId,
    };
    (side === 'home' ? home : away).push(entry);
  }
  return { home, away };
}

// ESPN keyEvents → 카드(경고/퇴장). type.text가 "Yellow Card"/"Red Card"/"Second Yellow Card"
// 셋 다 있음(실측 확인) — Second Yellow도 퇴장이라 R로 취급.
function extractEspnCardsBySide(summaryJson, homeTeamName, awayTeamName) {
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
    (side === 'home' ? home : away).push(entry);
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

  const cardEnrichCutoff = cardEnrichCutoffDateStr();
  const targets = allGames.filter(
    (g) =>
      (SOCCER_LEAGUES.has(g.league) || STRUCTURED_SCORER_LEAGUES.has(g.league)) &&
      (g.status === 'completed' || g.status === 'live') &&
      g.gameId &&
      // 앱에서 절대 안 보이는 오래된 경기(30일 이전)는 예산 낭비라 아예 대상에서 제외(사용자
      // 지적, 2026-09-26) — live 는 날짜 무관하게 항상 포함.
      (g.status === 'live' || g.date >= cardEnrichCutoff),
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

  for (const g of targets) {
    const cached = cache[g.gameId];
    const isCardBackfillOnly = SOCCER_LEAGUES.has(g.league) && cached && cached.final !== false &&
      g.status !== 'live' && !(g.gameId in cardCache);
    if (isCardBackfillOnly && cardBackfillUsed >= CARD_BACKFILL_BUDGET) continue;
    const needsFetch = !cached || g.status === 'live' || (g.status === 'completed' && cached.final === false) || isCardBackfillOnly;
    if (isCardBackfillOnly) cardBackfillUsed++;
    if (needsFetch) {
      try {
        await sleep(REQUEST_DELAY_MS);
        if (STRUCTURED_SCORER_LEAGUES.has(g.league)) {
          const sc = await fetchStructuredScorers(g.gameId);
          cache[g.gameId] = { home: sc.home, away: sc.away, final: g.status === 'completed' };
        } else {
          const { scorers: sc, cards: cd } = await fetchScorersAndCards(g.gameId);
          cache[g.gameId] = { home: sc.home, away: sc.away, final: g.status === 'completed' };
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
    `[scorers] completedOrLiveSoccer=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} withScorers=${withScorers} withCards=${withCards}`,
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

  for (const g of targets) {
    const cached = cache[g.gameId];
    const needsFetch = !cached || g.status === 'live' || (g.status === 'completed' && cached.final === false);
    if (needsFetch) {
      try {
        await sleep(REQUEST_DELAY_MS);
        const as = await fetchLineupAssists(g.gameId);
        cache[g.gameId] = { home: as.home, away: as.away, final: g.status === 'completed' };
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

  // 0-0 무득점 경기도 카드는 붙어야 해서(사용자 요청, 2026-09-26) g.scorers 존재 요건을 뺌 —
  // 어시스트/국적 로직은 원래대로 scorers가 없으면 그냥 빈 배열([].length===0)로 자연히 스킵됨.
  const euroCutoff = cardEnrichCutoffDateStr();
  const targets = allGames.filter(
    (g) =>
      ESPN_LEAGUE_SLUG[g.league] &&
      (g.status === 'completed' || g.status === 'live') &&
      g.gameId &&
      // 앱 화면에서 절대 안 보이는 오래된 경기(30일 이전)는 예산 낭비라 대상에서 제외
      // (사용자 지적: "백필은어짜피화면에안보이니깐필요없는거아니야?", 2026-09-26).
      (g.status === 'live' || g.date >= euroCutoff),
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
    // 0-0 무득점 경기를 대상에 새로 포함시키면서(2026-09-26) 이 경기들은 cache[g.gameId] 자체가
    // 아예 없어(!cached) 예산 체크를 건너뛰고 무제한으로 fetch되는 버그 발생 — 실행이 몇 분 만에
    // 끝나던 게 계속 진행중으로 관측됨(실측). live가 아닌 한(실시간 급하지 않음) "완전 신규"도
    // 같은 예산 풀에 넣어서 과거 미완료분처럼 여러 실행에 걸쳐 나눠 처리되게 함.
    const isBackfillOnly = g.status !== 'live' && (
      !cached ||
      (cached.final !== false &&
        ((!('homeNats' in cached) || !('awayNats' in cached) || !('homeANats' in cached) || !('awayANats' in cached)) || needsCardBackfill))
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
        // 같은 리그 안에서도 여러 경기가 동시 킥오프하는 경우가 흔함(EPL 토요일 15시 동시킥오프 등) —
        // 시각만으로는 여러 후보 중 아무거나 골라버릴 수 있어(실측 확인: 맨시티전 조회에 브라이턴전이
        // 잘못 매칭됨), 시각으로 후보를 추린 뒤 최종 스코어까지 일치하는 것만 채택.
        const timeCandidates = events.filter((e) => Math.abs(Date.parse(e.date) - kickoffMs) <= 5 * 60 * 1000);
        const match =
          timeCandidates.length <= 1
            ? timeCandidates[0]
            : timeCandidates.find((e) => {
                const comp = e.competitions?.[0];
                const h = comp?.competitors?.find((c) => c.homeAway === 'home');
                const a = comp?.competitors?.find((c) => c.homeAway === 'away');
                return h && a && Number(h.score) === g.homeScore && Number(a.score) === g.awayScore;
              });
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
          const espnCards = extractEspnCardsBySide(summary, homeC?.team?.displayName, awayC?.team?.displayName);
          cardCache[g.gameId] = { home: espnCards.home, away: espnCards.away, final: g.status === 'completed' };
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
            // 이 골 이벤트의 athleteId를 그 팀 로스터에서 정확히 조회한 값이라 오매칭 없음(자책골은
            // e.team이 수혜팀이라 실제 득점자 소속과 달라 로스터에 없어 자연히 nat 미부착 — 안전).
            const zip = async (naverArr, espnArr) => {
              const naverSorted = [...naverArr].sort((a, b) => (a.m ?? 999) - (b.m ?? 999));
              const espnSorted = [...espnArr].sort((a, b) => (a.m ?? 999) - (b.m ?? 999));
              for (let i = 0; i < naverSorted.length; i++) {
                const s = naverSorted[i];
                const espnEntry = espnSorted[i];
                if (espnEntry?.a) s.a = espnEntry.a;
                if (espnEntry?.teamId && espnEntry?.athleteId) {
                  const nat = await getAthleteNationality('soccer', slug, espnEntry.teamId, espnEntry.athleteId);
                  if (nat) s.nat = nat;
                }
                // 어시스트 국적 — 어시스트 선수는 득점자와 같은 팀이라 teamId 재사용.
                if (espnEntry?.teamId && espnEntry?.assistAthleteId) {
                  const aNat = await getAthleteNationality('soccer', slug, espnEntry.teamId, espnEntry.assistAthleteId);
                  if (aNat) s.aNat = aNat;
                }
              }
            };
            await zip(g.scorers?.home || [], espnGoals.home);
            await zip(g.scorers?.away || [], espnGoals.away);
            cache[g.gameId] = {
              homeAssists: (g.scorers?.home || []).map((s) => s.a || null),
              awayAssists: (g.scorers?.away || []).map((s) => s.a || null),
              homeNats: (g.scorers?.home || []).map((s) => s.nat || null),
              awayNats: (g.scorers?.away || []).map((s) => s.nat || null),
              homeANats: (g.scorers?.home || []).map((s) => s.aNat || null),
              awayANats: (g.scorers?.away || []).map((s) => s.aNat || null),
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
      });
      (g.scorers?.away || []).forEach((s, i) => {
        if (c.awayAssists?.[i]) s.a = c.awayAssists[i];
        if (c.awayNats?.[i]) s.nat = c.awayNats[i];
        if (c.awayANats?.[i]) s.aNat = c.awayANats[i];
      });
    }
    const cd = cardCache[g.gameId];
    if (cd && ((cd.home && cd.home.length) || (cd.away && cd.away.length))) {
      g.cards = { home: cd.home, away: cd.away };
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

  const withCards = targets.filter((g) => g.cards).length;
  console.log(
    `[euroAssists] targets=${targets.length} cached=${fromCache} fetched=${fetched} failed=${failed} noMatch=${noMatch} countMismatch=${countMismatch} backfillUsed=${backfillUsed}/${BACKFILL_BUDGET} withCards=${withCards}`,
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
  // 야구 진행중 인닝 정보 ("5회말" 등) — 앱에서 team 이름과 조합해 공격/수비 표시.
  if (g.inningInfo) out.inningInfo = g.inningInfo;
  if (g.matchPeriod) out.matchPeriod = g.matchPeriod;
  // 종료 경기 승/패/세 투수 (KBO). 있는 것만 — 무승부·세이브 없는 경기는 일부/전부 누락.
  if (g.winPitcher) out.winPitcher = g.winPitcher;
  if (g.losePitcher) out.losePitcher = g.losePitcher;
  if (g.savePitcher) out.savePitcher = g.savePitcher;
  // 야구 하이라이트(홈런/2루타/도루/실책/병살타/결승타 등) — KBO/MLB/NPB 최근 3일 경기만.
  if (g.highlights) out.highlights = g.highlights;
  // 축구 득점자 — 종료+진행중 경기, 골 있을 때만. {home,away} 각 [{m,n,pk?,og?}].
  if (g.scorers) out.scorers = g.scorers;
  // 축구 카드(경고/퇴장) — K리그만, 있을 때만. {home,away} 각 [{n,type:'Y'|'R',m?}].
  if (g.cards) out.cards = g.cards;
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

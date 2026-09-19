// WBSC 공식 사이트(wbsc.org 및 대륙연맹 서브사이트 wbscasia.org 등) 기반 연령별 국가대표
// 야구월드컵/대륙선수권(U-18/U-15/U-23 월드컵, BFA U-18 아시아선수권 등) 자동 수집.
// Naver·ESPN 둘 다 커버 안 하는 대회라 세 번째 파이프라인 신설(2026-09). 매일 1회 GitHub
// Actions로 자동 실행(.github/workflows/fetch-wbsc-baseball.yml).
//
// wbsc.org 스케줄 페이지는 서버렌더링 시 <div id="app" data-page="{...}"> 속성 안에 전체 경기
// JSON을 그대로 박아둔다(Inertia.js). ESPN처럼 고정 슬러그로 날짜 롤링 조회가 안 되고 대회
// (edition)마다 URL의 tournamentkey 자체가 바뀌므로 TOURNAMENTS 배열에 아는 tournamentkey를
// 직접 등록해두는 방식 — 새 대회 열리면(다음: 2027 U-18, 2028 U-15/U-23) 여기 추가 필요.
// 이미 끝난 대회(예: 2025 U-18)도 계속 등록해두는 게 안전(재조회해도 gameId 기준 스킵이라
// 데이터 변화 없이 속도만 조금 씀 — 원본 로직은 앱 저장소 scripts/fetchWbscBaseball.mjs 와
// 동일, 저장소 분리라 부득이 복사 유지. 새 국가/구장 나오면 양쪽 다 갱신해야 함).
//
// 대륙선수권(BFA 등)은 wbsc.org 가 아니라 대륙연맹 서브사이트에 있음 — 대회별 domain 필드로
// 지정(생략 시 www.wbsc.org). Super Round처럼 아직 팀 미확정인 경기는 "1st Place After Super
// Round" 같은 플레이스홀더가 오므로 TEAM_KO 미확인(unknown team) 경고 없이 조용히 스킵.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// 실제 브라우저 요청과 더 비슷하게 — GitHub Actions 공유 러너 IP 대역이 wbsc.org의 봇 차단
// (Cloudflare 등)에 걸려 2026-09-13부터 4개 대회 전부 HTTP 403이 뜨기 시작함(User-Agent만
// 보내던 기존 요청은 자동화 트래픽으로 더 쉽게 식별됨). 완전한 브라우저 헤더 세트로 보완.
const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};
const REQUEST_DELAY_MS = 800;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// 403/429는 일시적인 봇 차단/레이트리밋일 수 있어 한 번 더 재시도(간격을 두고) — 완전한 IP
// 차단이면 재시도해도 소용없지만, 일시적 챌린지라면 통과할 수 있음.
async function fetchWithRetry(url, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleepMs(3000 + Math.random() * 2000);
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (res.ok) return res;
    lastErr = new Error(`HTTP ${res.status}`);
    if (res.status !== 403 && res.status !== 429) break;
  }
  throw lastErr;
}

const TEAM_KO = {
  Korea: '대한민국', 'Chinese Taipei': '차이니스 타이베이', 'United States of America': '미국',
  'Puerto Rico': '푸에르토리코', Panama: '파나마', Cuba: '쿠바', Japan: '일본', Italy: '이탈리아',
  China: '중국', Germany: '독일', Australia: '호주', 'South Africa': '남아프리카공화국',
  Czechia: '체코', 'Great Britain': '영국', 'Dominican Republic': '도미니카공화국', Mexico: '멕시코',
  Nicaragua: '니카라과', Venezuela: '베네수엘라',
  'Hong Kong, China': '홍콩', Philippines: '필리핀', Singapore: '싱가포르', 'Sri Lanka': '스리랑카', Thailand: '태국',
  // 네덜란드 혼크발 호프트클라서(NLBASEBALL, 2026-09-19 추가) — 클럽팀 명은 국가대표
  // 팀명과 겹치지 않아 이 dict 하나만 씀(대륙별 클럽리그와 국가대표 dict 분리 안 함).
  'Amsterdam Pirates': '암스테르담 파이러츠', 'Curaçao Neptunus': '퀴라소 넵튠', HCAW: 'HCAW',
  Kinheim: '킨하임', 'Oosterhout Twins': '오스터하우트 트윈스', UVV: 'UVV',
  'Worldwide Pharma Logistics Hoofddorp Pioniers': '호프도르프 파이오니어스',
  // 이탈리아 세리에 A Gold(ITBASEBALL, 2026-09-19 추가) — 그로세토 구단은 시즌중 스폰서명이
  // 바뀌면서 원문 라벨이 두 개(BBC GROSSETO / BIG MAT BSCGROSSETO)로 나오지만 같은 구단·구장이라
  // 같은 한글명으로 병합.
  'NETTUNO 1945': '네투노 1945', 'SAN MARINO BASEBALL': '산마리노 베이스볼', 'UNIPOL FORTITUDO BOLOGNA': '포르티투도 볼로냐',
  '1949 PARMA BASEBALL CLUB': '파르마 베이스볼 클럽 1949', 'FARMA CROCETTA': '크로체타', 'CAMEC COLLECCHIO': '콜레키오',
  'PALFINGER REGGIO EMILIA': '레지오 에밀리아', 'HOTSAND MACERATA': '마체라타',
  'BBC GROSSETO': 'BSC 그로세토', 'BIG MAT BSCGROSSETO': 'BSC 그로세토',
  // 콜롬비아 프로베이스볼리그(COBASEBALL, 2026-09-19 추가).
  'Caimanes de Barranquilla': '카이마네스 바랑키야', 'Tigres de Cartagena': '티그레스 카르타헤나',
  'Toros de Sincelejo': '토로스 신셀레호', 'Vaqueros de Monteria': '바케로스 몬테리아',
  // 체코 베이스볼 엑스트라리가(CZBASEBALL, 2026-09-19 추가).
  Nuclears: '트르제비치 뉴클리어스', Hroši: '브르노 흐로시', Arrows: '오스트라바 애로우스', SaBaT: '프라하 사바트',
  Eagles: '프라하 이글스', Kotlářka: '프라하 코틀라르카', Draci: '브르노 드라치', Hluboká: '흘루보카 소콜',
  // 스페인 División de Honor Oro(ESBASEBALL, 2026-09-19 추가).
  'Antorcha Aacore Supply': '안토르차 발렌시아', 'CB Astros - Natural Greatness': 'CB 아스트로스 발렌시아', 'San Inazio': '산 이나시오',
  'Tenerife Marlins Puerto Cruz (ESP)': '테네리페 말린스', 'Toros de Pamplona': '토로스 데 팜플로나', Irabia: '이라비아',
  'CB Barcelona': 'CB 바르셀로나', 'Béisbol Navarra': '베이스볼 나바라', 'CBS Sant Boi': 'CBS 산트보이', 'Miralbueno Béisbol': '미랄부에노 베이스볼',
  // 영국 내셔널 베이스볼 리그(GBBASEBALL, 2026-09-19 추가).
  'Croydon Pirates': '크로이던 파이러츠', 'Essex Arrows': '에식스 애로우스', 'Herts Toucans': '허츠 투칸스', 'Leicester Blue Sox': '레스터 블루삭스',
  'Liverpool Trojans': '리버풀 트로전스', 'London Mets': '런던 메츠', 'Long Eaton Storm': '롱이튼 스톰', "Manchester A's": '맨체스터 에이스', 'Sheffield Bruins': '셰필드 브루인스',
};

function isTbdPlaceholder(name) {
  return typeof name === 'string' && / Place After /.test(name);
}

// 정규 클럽팀이 아닌 올스타/국가대표 이벤트성 경기 제외(체코 Extraliga 등에서 시즌 중
// 딱 1경기씩 섞여 나옴, 2026-09-19 발견).
const EXHIBITION_TEAM_LABELS = new Set(['Česká reprezentace', 'Hvězdy Extraligy']);

const VENUE_MAP = {
  'Okinawa Cellular Stadium NAHA': 'okinawa_cellular_naha',
  'Nishizaki Stadium': 'itoman_nishizaki_stadium',
  'Estadio Beto Ávila': 'estadio_beto_avila_cancun',
  'Parque Kukulcán Alamo': 'parque_kukulcan_alamo_merida',
  'Estadio Nacional Soberania': 'estadio_nacional_soberania_managua',
  'Estadio Rigoberto López Pérez': 'estadio_rigoberto_lopez_perez_leon',
  'Estadio Roberto Clemente': 'estadio_roberto_clemente_masaya',
  'Taipei Dome': 'taipei_dome',
  'Taipei Tianmu Baseball Stadium': 'tianmu_baseball_stadium',
  'XinZhuang Baseball Stadium': 'xinzhuang_baseball_stadium',
  // 네덜란드 혼크발 호프트클라서(2026-09-19 추가, 실주소 기반 GPS로 앱 저장소에 신규 등록).
  'Loek Loevendie Ballpark': 'sportpark_ookmeer',
  'Neptunus Familiestadion': 'neptunus_familiestadion',
  'Rob Hoffmann Vallei': 'rob_hoffmann_vallei',
  'Pim Mulier Stadion': 'pim_mulier_stadion',
  'Sportpark De Slotbosse Toren': 'sportpark_slotbosse_toren',
  'Sportpark de Paperclip': 'sportpark_de_paperclip',
  'Sportpark Pioniers': 'sportpark_pioniers_hoofddorp',
  // 이탈리아 세리에 A Gold(2026-09-19 추가, 실주소 기반 GPS로 앱 저장소에 신규 등록).
  'STADIO STENO BORGHESE NETTUNO': 'stadio_steno_borghese',
  'Campo Baseball Comunale La Ciarulla Serravalle': 'stadio_serravalle_la_ciarulla',
  'STADIO BASEBALL GIANNI FALCHI': 'stadio_gianni_falchi',
  'STADIO "N. CAVALLI"  c/o CENTRO SPORTIVO "A. NOTARI"': 'stadio_nino_cavalli_parma',
  "CAMPO BASEBALL STUARD 1 POL. BELLE'": 'campo_stuard_parma',
  'STADIO COMUNALE BASEBALL ROBERTO JANNELLA': 'stadio_roberto_jannella',
  'CAMPO BASEBALL COMUNALE COLLECCHIO': 'campo_baseball_collecchio',
  'STADIO BASEBALL CASELLI': 'stadio_giorgio_caselli',
  'CAMPO COMUNALE BASEBALL MACERATA': 'campo_comunale_macerata',
  // 콜롬비아 프로베이스볼리그(2026-09-19 추가, 실주소 기반 GPS로 앱 저장소에 신규 등록).
  // 카르타헤나 구장은 원문 라벨이 두 개("Estadio Once de Noviembre" / "11 de Noviembre \"Abel Leal\"")로
  // 나오지만 같은 구장이라 하나로 병합.
  'Edgar Renteria Baseball Stadium': 'estadio_edgar_renteria_barranquilla',
  'Estadio de Beisbol 20 de Enero': 'estadio_veinte_de_enero_sincelejo',
  'Estadio Once de Noviembre': 'estadio_once_de_noviembre_cartagena',
  '11 de Noviembre "Abel Leal"': 'estadio_once_de_noviembre_cartagena',
  'Estadio de Béisbol 18 de Junio': 'estadio_dieciocho_de_junio_monteria',
  // 체코 베이스볼 엑스트라리가(2026-09-19 추가, 실주소 기반 GPS로 앱 저장소에 신규 등록).
  'Arrows Park Ostrava': 'arrows_park_ostrava',
  'Eagles - Field 1': 'eagles_park_praha',
  'Hluboká Baseball & Softball Club': 'hluboka_baseball_softball_club',
  'Hroši Brno': 'areal_hroch_brno',
  'Kotlářka Na Markétě': 'kotlarka_na_markete',
  'MBS Brno': 'mestsky_baseballovy_stadion_brno',
  SaBaT: 'sabat_praha',
  'Třebíč Na Hvězdě': 'trebic_na_hvezde',
  // 스페인 División de Honor Oro(2026-09-19 추가, 실주소 기반 GPS로 앱 저장소에 신규 등록).
  'Camp Municipal de Beisbol i Sofbol de València': 'campo_beisbol_valencia',
  'Campo de Béisbol El Fango': 'campo_beisbol_el_fango_bilbao',
  'Campo Municipal de Béisbol Néstor Pérez Suárez': 'estadio_nestor_perez_suarez',
  'Campo Municipal de Béisbol y Sófbol Miralbueno': 'campo_beisbol_miralbueno',
  'Camp Municipal de Béisbol Carlos Pérez de Rozas': 'campo_beisbol_perez_de_rozas',
  'Campo de Béisbol Jose Aguadero': 'campo_beisbol_jose_aguadero',
  'Campo de Béisbol Municipal El Soto': 'campo_beisbol_el_soto_burlada',
  'Estadio Municipal de Béisbol Antonio Hervás': 'estadio_beisbol_antonio_hervas',
  // 영국 내셔널 베이스볼 리그(2026-09-19 추가, 실주소 기반 GPS로 앱 저장소에 신규 등록).
  // Grovehill Ballpark는 다이아몬드별로 " - D1"/" - D2" 접미사가 붙어서 나오지만 같은 구장이라 병합.
  'Roundshaw Playing Fields - D1': 'roundshaw_playing_fields',
  'Finsbury Park - D3': 'finsbury_park_ballpark',
  'Thorpe Green Park': 'thorpe_green_park',
  'Norman Wells Ballpark': 'norman_wells_ballpark',
  'Townmead Playing Fields': 'townmead_playing_fields',
  'Grovehill Ballpark - D1': 'grovehill_ballpark',
  'Grovehill Ballpark - D2': 'grovehill_ballpark',
  'West Park': 'west_park_long_eaton',
  'Wythenshawe Park': 'wythenshawe_park',
  'Western Park': 'western_park_leicester',
  'Basing Hill Ballpark': 'basing_hill_ballpark',
  'Somerdale Pavilion - D1': 'somerdale_pavilion',
};

const TOURNAMENTS = [
  { tournamentkey: '2025-u18-baseball-world-cup', league: 'U18BASEBALLWORLDCUP' },
  { tournamentkey: '2026-vii-u-15-baseball-world-cup', league: 'U15BASEBALLWORLDCUP' },
  { tournamentkey: '2026-vi-wbsc-u-23-baseball-world-cup', league: 'U23BASEBALLWORLDCUP' },
  { tournamentkey: '2026-bfa-xiv-u18-championship', league: 'U18ASIANBASEBALL', domain: 'www.wbscasia.org' },
  // 국가별 프로/세미프로 클럽리그(2026-09-19부터 순차 추가, "야구 강국순") — U18/U23
  // 월드컵과 같은 MyWBSC 플랫폼 위에 있어 이 크롤러를 그대로 재사용.
  { tournamentkey: '2026-lucky-day-hoofdklasse', league: 'NLBASEBALL', domain: 'stats.knbsbstats.nl' },
  { tournamentkey: '2026-serie-a-gold-baseball', league: 'ITBASEBALL', domain: 'www.fibs.it' },
  // col.wbsc.org는 /en/ 경로로 접근하면 엉뚱한(이탈리아) 데이터가 나오는 라우팅 버그가 있어
  // /es/ 경로 필수(실측 확인, 2026-09-19).
  { tournamentkey: '2025-liga-profesional-de-beisbol-de-colombiano-2025-2026', league: 'COBASEBALL', domain: 'col.wbsc.org', locale: 'es' },
  { tournamentkey: '2025-extraliga-2025', league: 'CZBASEBALL', domain: 'stats.baseball.cz' },
  // rfebs.es도 /en/ 경로 접근 시 홈페이지로 리다이렉트되는 라우팅 이슈가 있어 /es/ 경로 필수
  // (콜롬비아와 같은 종류의 버그, 실측 확인).
  { tournamentkey: '2025-liga-nacional-de-beisbol-division-de-honor-oro', league: 'ESBASEBALL', domain: 'www.rfebs.es', locale: 'es' },
  { tournamentkey: '2026-nbl', league: 'GBBASEBALL', domain: 'stats.britishbaseball.org.uk' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function fetchTournamentGames(tournamentkey, domain = 'www.wbsc.org', locale = 'en') {
  const url = `https://${domain}/${locale}/events/${tournamentkey}/schedule-and-results`;
  const res = await fetchWithRetry(url);
  const html = await res.text();
  const m = html.match(/data-page="({.*?})"\s*>\s*<\/div>/s);
  if (!m) throw new Error(`data-page attribute not found for ${tournamentkey} (page structure may have changed)`);
  const data = JSON.parse(unescapeHtml(m[1]));
  return data.props.games || [];
}

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

function wbscStatusToOurs(g) {
  if (g.gamestatustext === 'F' || /^F\//.test(g.gamestatustext || '')) return 'completed';
  if (g.gamestatus === 0 && !g.gamestatustext) return 'scheduled';
  return 'live';
}

// 라이브 이닝 정보 — gamestatustext 가 "T2"(2회초)/"B3"(3회말) 형태로 옴(2026-09-19, 이탈리아
// 세리에 A Gold 실측 확인, 다른 MyWBSC 대회에도 동일 필드라 여기서 한 번만 고치면 전부 적용됨.
// 예전엔 이 필드를 F 여부만 확인하고 버려서 U18/U23 월드컵 등 기존 대회도 라이브 중 이닝
// 표시가 아예 없었음 — 부수 효과로 같이 해결).
function wbscInningInfo(gamestatustext) {
  const m = /^([TB])(\d+)$/.exec(gamestatustext || '');
  if (!m) return null;
  const [, half, inning] = m;
  return `${inning}회${half === 'T' ? '초' : '말'}`;
}

async function fetchWbscBaseballTournament(tournamentkey, league, unknownTeams, unknownVenues, domain, locale) {
  const rawGames = await fetchTournamentGames(tournamentkey, domain, locale);
  const games = [];
  for (const g of rawGames) {
    const homeEn = g.homelabel;
    const awayEn = g.awaylabel;
    if (isTbdPlaceholder(homeEn) || isTbdPlaceholder(awayEn)) continue;
    if (EXHIBITION_TEAM_LABELS.has(homeEn) || EXHIBITION_TEAM_LABELS.has(awayEn)) continue;
    const homeKo = TEAM_KO[homeEn];
    const awayKo = TEAM_KO[awayEn];
    if (!homeKo) unknownTeams.add(`${league}:${homeEn}`);
    if (!awayKo) unknownTeams.add(`${league}:${awayEn}`);
    const stadiumName = g.stadium;
    const venueId = stadiumName ? VENUE_MAP[stadiumName] : undefined;
    if (stadiumName && !venueId) unknownVenues.add(`${league}:${stadiumName}`);
    if (!homeKo || !awayKo || !venueId) continue;
    const { date, time } = toKstDateTime(g.utc);
    const status = wbscStatusToOurs(g);
    const out = {
      date, time, league, venueId,
      home: homeKo, away: awayKo,
      stadium: stadiumName, timeTbd: false,
      gameId: `${league}_WBSC_${g.id}`,
      status,
    };
    if (status === 'completed' || status === 'live') {
      out.homeScore = Number(g.homeruns);
      out.awayScore = Number(g.awayruns);
    }
    if (status === 'live') {
      const inningInfo = wbscInningInfo(g.gamestatustext);
      if (inningInfo) out.inningInfo = inningInfo;
    }
    games.push(out);
  }
  return games;
}

async function notifyUnknowns(unknownTeams, unknownVenues) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || (unknownTeams.size === 0 && unknownVenues.size === 0)) return;
  const lines = [];
  if (unknownTeams.size) lines.push(`**미확인 팀명(TEAM_KO에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(VENUE_MAP에 추가 필요)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 ShadeSide — WBSC 야구(U-18/U-15/U-23 월드컵·BFA 아시아선수권) 미확인 항목\nscripts/fetch-wbsc-baseball.mjs 에서 매핑 추가해주세요(구장 실좌표 리서치 필요할 수 있음).\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] wbsc-baseball unknown notify failed:', e.message);
  }
}

// 대회 하나만 조회 실패해도 try/catch로 조용히 넘어가던 게 2026-09-12~13 wbscasia.org
// 장애를 하루 넘게 못 알아챈 원인(다른 3개 wbsc.org 대회는 정상이라 워크플로 자체는 계속
// success로 표시됨) — 이제 실패한 대회 목록을 모아 개별 Discord 알림으로 즉시 노출.
// 5분 주기 트리거라 차단이 길어지면 같은 실패로 계속 알림이 옴(2026-09-13, IP/ASN 차단
// 추정 — 헤더를 바꿔도 그대로 403). 대회별 마지막 알림 시각을 파일로 남겨 쿨다운 동안은
// 재알림하지 않음(그래도 매 실행 로그엔 남으니 완전히 조용해지진 않음).
const ALERT_STATE_PATH = path.join(REPO_ROOT, '.wbsc-alert-state.json');
const ALERT_COOLDOWN_MS = 6 * 3600 * 1000;
async function notifyFetchFailures(failed) {
  if (failed.length === 0) return;
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(ALERT_STATE_PATH, 'utf-8'));
  } catch {}
  const now = Date.now();
  const toAlert = failed.filter(({ tournamentkey }) => {
    const last = state[tournamentkey];
    return !last || now - last > ALERT_COOLDOWN_MS;
  });
  for (const { tournamentkey } of failed) state[tournamentkey] = now;
  await fs.writeFile(ALERT_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  if (toAlert.length === 0 || !webhook) return;
  const lines = toAlert.map(({ league, tournamentkey, error }) => `• ${league} (${tournamentkey}): ${error}`);
  const content = `🔴 ShadeSide — WBSC 야구 일부 대회 조회 실패(워크플로는 success로 표시되지만 데이터 갱신 안 됨, ${ALERT_COOLDOWN_MS / 3600000}시간 쿨다운)\n${lines.join('\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] wbsc-baseball fetch-failure notify failed:', e.message);
  }
}

async function main() {
  const unknownTeams = new Set();
  const unknownVenues = new Set();
  const allNew = [];
  const failedTournaments = [];
  for (const { tournamentkey, league, domain, locale } of TOURNAMENTS) {
    console.log(`Fetching ${league} (${tournamentkey}) ...`);
    await sleep(REQUEST_DELAY_MS);
    let gs;
    try {
      gs = await fetchWbscBaseballTournament(tournamentkey, league, unknownTeams, unknownVenues, domain, locale);
    } catch (e) {
      console.warn(`  failed: ${e.message}`);
      failedTournaments.push({ league, tournamentkey, error: e.message });
      continue;
    }
    console.log(`  -> ${gs.length} games`);
    allNew.push(...gs);
  }
  await notifyUnknowns(unknownTeams, unknownVenues);
  await notifyFetchFailures(failedTournaments);

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
        if (prev.status !== g.status || prev.homeScore !== g.homeScore || prev.awayScore !== g.awayScore) {
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
  console.log(`[wbsc-baseball] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[wbsc-baseball] fatal:', e);
  process.exit(1);
});

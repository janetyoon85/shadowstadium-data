// MLB 공식 API(statsapi.mlb.com) 기반 윈터리그(LVBP/LIDOM/LMP/PWL/ABL/AFL) 자동 수집 — 다섯 번째
// 데이터 소스(Naver/ESPN/WBSC/Bornan 다음). ESPN의 동명 슬러그(venezuelan-winter-league 등)는
// 실제로는 빈 껍데기(시즌 내내 0경기, 확인함)였던 반면 이쪽은 진짜 데이터가 있음.
//
// 카리브해시리즈는 이미 ESPN 파이프라인이 커버 중이라 중복 등록 안 함. 쿠바 세리에 나시오날은
// 이 API에 아예 없음(MLB 윈터볼 네트워크 비참여) — 별도 조사 필요(beisbolencuba.com HTML 스크래핑).
//
// API는 WBSC처럼 이상한 이중 인코딩 없는 표준 JSON. 날짜 범위 한 번에 조회 가능해서 ESPN
// 파이프라인처럼 롤링 윈도우로 매일 갱신 — 시즌(대략 9월 말~2월)이 아닌 리그는 그냥 0경기로
// 조용히 스킵.
//
// 원본 로직은 앱 저장소 scripts/fetchMlbWinterBaseball.mjs 와 동일(저장소 분리라 부득이 복사
// 유지). 매일 1회 GitHub Actions 자동 실행(.github/workflows/fetch-mlb-winter-baseball.yml).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REQUEST_DELAY_MS = 500;

const LEAGUES = [
  { leagueId: 119, code: 'AFL' },
  { leagueId: 132, code: 'LMP' },
  { leagueId: 131, code: 'LIDOM' },
  { leagueId: 595, code: 'ABL' },
  { leagueId: 133, code: 'PWL' },
  { leagueId: 135, code: 'LVBP' },
];

const TEAM_KO = {
  'Glendale Desert Dogs': '글렌데일 데저트독스', 'Salt River Rafters': '솔트리버 래프터스',
  'Surprise Saguaros': '서프라이즈 사구아로스', 'Scottsdale Scorpions': '스코츠데일 스콜피온스',
  'Peoria Javelinas': '피오리아 하벨리나스', 'Mesa Solar Sox': '메사 솔라삭스',
  'Jaguares de Nayarit': '하과레스 데 나야리트', 'Aguilas de Mexicali': '아길라스 데 멕시칼리',
  'Charros de Jalisco': '차로스 데 할리스코', 'Caneros de los Mochis': '카녜로스 데 로스모치스',
  'Mayos de Navojoa': '마요스 데 나보호아', 'Naranjeros de Hermosillo': '나랑헤로스 데 에르모시요',
  'Tomateros de Culiacan': '토마테로스 데 쿨리아칸', 'Venados de Mazatlan': '베나도스 데 마사틀란',
  'Yaquis de Obregon': '야키스 데 오브레곤', 'Algodoneros de Guasave': '알고도네로스 데 과사베',
  'Aguilas Cibaenas': '아길라스 시바에냐스', 'Toros del Este': '토로스 델 에스테',
  'Estrellas Orientales': '에스트레야스 오리엔탈레스', 'Gigantes del Cibao': '히간테스 델 시바오',
  'Leones del Escogido': '레오네스 델 에스코히도', 'Tigres del Licey': '티그레스 델 리세이',
  'Adelaide Giants': '애들레이드 자이언츠', 'Brisbane Bandits': '브리즈번 밴디츠',
  'Canberra Cavalry': '캔버라 캐벌리', 'Melbourne Aces': '멜버른 에이시스',
  'Perth Heat': '퍼스 히트', 'Sydney Blue Sox': '시드니 블루삭스',
  'Cangrejeros de Santurce': '칸그레헤로스 데 산투르세', 'Criollos de Caguas': '크리오요스 데 카과스',
  'Gigantes de Carolina': '히간테스 데 카롤리나', 'Indios de Mayaguez': '인디오스 데 마야궤스',
  'Leones de Ponce': '레오네스 데 폰세', 'Senadores de San Juan': '세나도레스 데 산후안',
  'Aguilas del Zulia': '아길라스 델 술리아', 'Cardenales de Lara': '카르데날레스 데 라라',
  'Caribes de Anzoategui': '카리베스 데 안소아테기', 'Leones del Caracas': '레오네스 델 카라카스',
  'Navegantes del Magallanes': '나베간테스 델 마가야네스', 'Bravos de Margarita': '브라보스 데 마르가리타',
  'Tiburones de La Guaira': '티부로네스 데 라과이라', 'Tigres de Aragua': '티그레스 데 아라과',
};

const VENUE_MAP = {
  'Camelback Ranch': 'camelback_ranch',
  'Salt River Fields at Talking Stick': 'salt_river_fields',
  'Surprise Stadium': 'surprise_stadium',
  'Scottsdale Stadium': 'scottsdale_stadium',
  'Peoria Stadium': 'peoria_stadium_az',
  'Sloan Park': 'sloan_park',
  'Goodyear Ballpark': 'goodyear_ballpark',
  'Kino Veterans Memorial Stadium': 'kino_veterans_memorial_stadium',
  'Estadio Nido de los Aguilas': 'estadio_nido_de_los_aguilas_mexicali',
  'Estadio Emilio Ibarra Almada': 'estadio_emilio_ibarra_almada',
  "Estadio Manuel Ciclon Echeverria": 'estadio_manuel_ciclon_echeverria',
  'Estadio Fernando Valenzuela': 'estadio_fernando_valenzuela',
  'Estadio de los Tomateros': 'estadio_tomateros_culiacan',
  'Estadio Angel Flores': 'estadio_tomateros_culiacan',
  'Estadio Teodoro Mariscal': 'estadio_teodoro_mariscal',
  'Estadio de los Yaquis': 'estadio_yaquis_obregon',
  'Estadio Francisco Carranza Limon': 'estadio_francisco_carranza_limon',
  'Estadio Panamericano de los Charros': 'estadio_panamericano_zapopan',
  'Coloso del Pacifico': 'coloso_del_pacifico_tepic',
  'Estadio Cibao': 'estadio_cibao',
  'Estadio Francisco Micheli': 'estadio_francisco_micheli',
  'Estadio Tetelo Vargas': 'estadio_tetelo_vargas',
  'Estadio Julian Javier': 'estadio_julian_javier',
  'Estadio Quisqueya Juan Marichal': 'estadio_quisqueya_juan_marichal',
  'Dicolor Australia Stadium': 'dicolor_australia_stadium',
  'Viticon Stadium': 'viticon_stadium',
  'EPC Solar Ballpark': 'epc_solar_ballpark',
  'Melbourne Ballpark': 'melbourne_ballpark',
  'NSR Hire Ballpark': 'nsr_hire_ballpark',
  'Blacktown International Sportspark': 'blacktown_international_sportspark',
  'Hiram Bithorn Stadium': 'hiram_bithorn_stadium',
  'Estadio Roberto Clemente Walker': 'estadio_roberto_clemente_walker',
  "Estadio Isidoro 'Cholo' Garcia": 'estadio_isidoro_cholo_garcia',
  'Estadio Francisco Paquito Montaner': 'estadio_francisco_paquito_montaner',
  'Estadio Yldefonso Sola Morales': 'estadio_yldefonso_sola_morales',
  'Estadio Luis Aparicio': 'estadio_luis_aparicio',
  'Estadio Antonio Herrera Gutierrez': 'estadio_antonio_herrera_gutierrez',
  'Estadio Alfonso Carrasquel': 'estadio_alfonso_carrasquel',
  'Monumental Simon Bolivar': 'monumental_simon_bolivar',
  'Estadio Jose Bernardo Perez': 'estadio_jose_bernardo_perez',
  'Estadio Nueva Esparta': 'estadio_nueva_esparta',
  'Estadio Universitario': 'estadio_universitario_caracas',
  'Estadio Jose Perez Colmenares': 'estadio_jose_perez_colmenares',
  'Estadio Jorge Luis Garcia Carneiro': 'estadio_jorge_luis_garcia_carneiro',
  'Estadio Metropolitano de San Cristobal': 'estadio_metropolitano_san_cristobal',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function fetchMlbWinterLeague(leagueId, code, startDate, endDate, unknownTeams, unknownVenues) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=17&leagueId=${leagueId}&startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${code}`);
  const j = await res.json();
  const games = [];
  for (const d of j.dates || []) {
    for (const g of d.games || []) {
      const homeEn = g.teams?.home?.team?.name;
      const awayEn = g.teams?.away?.team?.name;
      const homeKo = TEAM_KO[homeEn];
      const awayKo = TEAM_KO[awayEn];
      if (!homeKo) unknownTeams.add(`${code}:${homeEn}`);
      if (!awayKo) unknownTeams.add(`${code}:${awayEn}`);
      const venueName = g.venue?.name;
      const venueId = venueName ? VENUE_MAP[venueName] : undefined;
      if (venueName && !venueId) unknownVenues.add(`${code}:${venueName}`);
      if (!homeKo || !awayKo || !venueId) continue;
      const { date, time } = toKstDateTime(g.gameDate);
      const status = mlbStatusToOurs(g);
      const out = {
        date, time, league: code, venueId,
        home: homeKo, away: awayKo,
        stadium: venueName, timeTbd: !!g.status?.startTimeTBD,
        gameId: `${code}_MLBSTATS_${g.gamePk}`,
        status,
      };
      if (status === 'completed' || status === 'live') {
        const hs = g.teams?.home?.score;
        const as = g.teams?.away?.score;
        if (typeof hs === 'number') out.homeScore = hs;
        if (typeof as === 'number') out.awayScore = as;
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
  const content = `🟡 그늘각 — MLB 윈터리그(LVBP/LIDOM/LMP/PWL/ABL/AFL) 미확인 항목\nscripts/fetch-mlb-winter-baseball.mjs 에서 매핑 추가해주세요. 올스타전 등 일회성 예외 경기는 무시해도 됩니다.\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] mlb-winter unknown notify failed:', e.message);
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
  const allNew = [];
  for (const { leagueId, code } of LEAGUES) {
    console.log(`Fetching ${code} (league ${leagueId}) ${startDate}~${endDate} ...`);
    await sleep(REQUEST_DELAY_MS);
    let gs;
    try {
      gs = await fetchMlbWinterLeague(leagueId, code, startDate, endDate, unknownTeams, unknownVenues);
    } catch (e) {
      console.warn(`  failed: ${e.message}`);
      continue;
    }
    console.log(`  -> ${gs.length} games`);
    allNew.push(...gs);
  }
  await notifyUnknowns(unknownTeams, unknownVenues);

  const gamesPath = path.join(REPO_ROOT, 'games_2026.json');
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
  console.log(`[mlb-winter] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[mlb-winter] fatal:', e);
  process.exit(1);
});

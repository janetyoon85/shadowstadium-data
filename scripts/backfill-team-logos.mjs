// 팀 로고 백필(2026-09-30, 사용자: "팀 로고도 같이 진행") — 지금까지 앱은 팀을 텍스트+국기
// 이모지로만 표시(엠블럼 없음). TheSportsDB(선수 사진에 이미 쓰는 무료 소스, App.tsx 참고)가
// 팀 배지(strBadge)도 제공 — 실측 확인(삼성 라이온즈 등)으로 동그란 엠블럼 형태, 컴팩트 표시에
// 적합.
//
// 매 실행 API 호출하는 대신(경기 목록마다 팀 로고가 여러 번 뜨면 사용자 트래픽에 비례해서
// 무료 공유키(분당 30회, 전 세계 개발자 공유) 한도를 바로 넘김 — 사용자 우려: "1분에 30번
// 조회?? 하면 유료로 바꿔야되지않나??") 크롤러가 하루 1회만 백필해서 team-logos.json에
// 영구 캐시. 앱은 이 파일을 fetch만 하고 런타임 API 호출 0회.
//
// 우리 팀명은 전부 한글 표기(games.json 실측 확인: "삼성","바르셀로나" 등)인데 TheSportsDB는
// 라틴 문자 색인이라 한글 검색은 항상 0건 — App.tsx의 TEAM_NAME_EN 딕셔너리(1,372개, 한글→
// 영문 약칭)를 그대로 재사용(team-name-en.json으로 1회 추출해 이 저장소에 커밋). 축약형
// 영문("Samsung","Jeonbuk")도 TheSportsDB 검색이 fuzzy match라 정상 매칭됨(실측 확인).

import fs from 'node:fs/promises';
import { fetchLogoByEnTitle } from './team-logo-wikipedia.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_PATH = path.join(REPO_ROOT, 'games.json');
const TEAM_NAME_EN_PATH = path.join(REPO_ROOT, 'team-name-en.json');
const LOGOS_PATH = path.join(REPO_ROOT, 'team-logos.json');
// 무료 공유키(분당 30회, thesportsdb.com/documentation)를 다른 개발자들과 나눠 쓰므로 여유
// 있게(하루 1회 실행 기준 REQUEST_DELAY_MS로 이미 분당 한도 안쪽, BUDGET은 실행시간 제한용).
const REQUEST_DELAY_MS = 2200; // 분당 약 27회 — 30회 한도 안쪽으로 여유.
const BUDGET = 200; // 팀 수가 유한(수백 개)이라 며칠 안에 전체 백필 완료, 이후엔 매일 0건.
const WIKI_TRIED_PATH = path.join(REPO_ROOT, 'team-logos-wiki-tried.json');
const WIKI_BUDGET = 250;
const TITLES_PATH = path.join(REPO_ROOT, 'team-logo-wiki-titles.json');
const TITLES_TRIED_PATH = path.join(REPO_ROOT, 'team-logos-titles-tried.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 야구 리그 판정(2026-09-30, "mlb인데축구장사진이있네" 리포트로 구장사진 백필에서 발견한 동일
// 버그 클래스를 여기도 같이 수정 — "Houston" 검색이 야구팀 없이 무관한 스포츠 팀 1건만 반환하는
// 경우, 스포츠 필터 없이 무조건 teams[0]을 쓰면 완전히 다른 스포츠의 배지가 붙을 수 있음).
// fetch-schedule.mjs의 BASEBALL_LEAGUES(KBO/MLB/NPB/PREMIER12)는 Naver 소스 리그만 포함해서
// 부족 — WBC/카리브해시리즈/윈터리그(LIDOM/LMP/LVBP/LMB/PWL/ABL/AFL)와 "*BASEBALL" 접미사가
// 붙는 대회들(올림픽야구, 아시안게임야구 등)까지 games.json 실측 리그 목록 기준으로 보강.
const EXTRA_BASEBALL_LEAGUES = new Set(['WBC', 'CARIBBEANSERIES', 'LIDOM', 'LMP', 'LVBP', 'LMB', 'PWL', 'ABL', 'AFL']);
function isBaseballLeague(league) {
  return league === 'KBO' || league === 'MLB' || league === 'NPB' || league === 'PREMIER12' ||
    EXTRA_BASEBALL_LEAGUES.has(league) || /BASEBALL/.test(league || '');
}

// team-logos.json은 한글 팀명 문자열 하나를 키로 배지 하나만 캐시하는데, MLB/MLS 도시명이
// 겹치는 9곳([[project_i18n_japanese]] 메모의 "휴스턴 등 9개")은 실제로는 서로 다른 두 구단이
// 같은 "휴스턴" 문자열을 씀 — 이 스크립트가 sportLabel로 한쪽(예: MLB 애스트로스)을 정확히
// 찾아 캐시해도, 다른 쪽(MLS 다이나모) 경기 화면엔 그 잘못된 배지가 그대로 노출됨(캐시 키가
// 스포츠 구분이 없어서). 리그별로 따로 캐싱하려면 App.tsx의 TEAM_LOGOS 조회 쪽도 함께 바꿔야
// 하는 스키마 변경이 필요해 지금 스코프 밖 — 안전하게 이 9곳은 아예 캐싱을 건너뛰어("배지
// 없음"으로 통일) 한쪽 스포츠에 다른 쪽 배지가 잘못 붙는 걸 막음(오귀속보단 유실이 안전).
// 2026-09-30 후속("필라델피아도로고수집안되고있음"): 스킵하면 영구히 로고가 없어서, 캐시 키를
// "한글명|스포츠"(예: "필라델피아|Baseball")로 나눠 저장하도록 변경 — App.tsx 조회도 같은 규칙.
// 규칙: league==='MLB' 이면 Baseball, 그 외는 Soccer (겹치는 건 MLB/MLS 뿐).
const AMBIGUOUS_TEAM_KO_NAMES = new Set(['휴스턴', '시애틀', '마이애미', '토론토', '신시내티', '콜로라도', '미네소타', '필라델피아', '세인트루이스']);
const AMBIGUOUS_CITY_TEAM_OVERRIDES = {
  '휴스턴': { Baseball: 'Houston Astros', Soccer: 'Houston Dynamo' },
  '시애틀': { Baseball: 'Seattle Mariners', Soccer: 'Seattle Sounders' },
  '마이애미': { Baseball: 'Miami Marlins', Soccer: 'Inter Miami' },
  '토론토': { Baseball: 'Toronto Blue Jays', Soccer: 'Toronto FC' },
  '신시내티': { Baseball: 'Cincinnati Reds', Soccer: 'FC Cincinnati' },
  '콜로라도': { Baseball: 'Colorado Rockies', Soccer: 'Colorado Rapids' },
  '미네소타': { Baseball: 'Minnesota Twins', Soccer: 'Minnesota United' },
  '필라델피아': { Baseball: 'Philadelphia Phillies', Soccer: 'Philadelphia Union' },
  '세인트루이스': { Baseball: 'St. Louis Cardinals', Soccer: 'St. Louis City SC' },
};

// 남자팀/여자팀 이름 겹침(2026-09-30, "이건맞아?" 리포트 — backfill-venue-photos.mjs와 동일 발견,
// 자세한 사유는 그쪽 주석 참고). 발견되는 대로 추가.
const TEAM_SEARCH_NAME_OVERRIDES = {
  '알라베스': 'Deportivo Alaves',
  '닛폰햄': 'Nippon Ham Fighters',
  '드로게다': 'Drogheda United',
  '트라브존': 'Trabzonspor',
  '맨유': 'Manchester United',
  '맨시티': 'Manchester City',
};

async function fetchTeamBadge(englishName, sportLabel) {
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(englishName)}`);
    if (!res.ok) return null;
    const j = await res.json();
    const teams = j.teams || [];
    // sportLabel 필터 — 못 찾으면 잘못된 스포츠 배지보단 "없음"이 안전(구장사진 백필과 동일 철학).
    // strGender 필터(2026-09-30, "이건맞아?" 리포트로 구장사진 백필에서 발견한 동일 버그 클래스 —
    // "Alaves" 검색이 여자팀(Alavés Gloriosas) 1건만 반환) — 우리 데이터는 전부 남자 클럽/대표팀.
    const team = teams.find((t) => t.strSport === sportLabel && t.strGender !== 'Female');
    return team?.strBadge || null;
  } catch {
    return null;
  }
}

// 위키백과 폴백(2026-09-30, "정체된거 개선" — 로고 null 115개 + 영문명 없어 아예 시도 못한 108팀).
// 한국어 위키에서 팀 문서를 찾아 (1) 영문 문서 제목(TheSportsDB 재검색용) (2) 인포박스 대표 이미지를 로고로 사용.
// 오귀속 방지: 문서 소개문에 팀/구단 단어가 있고, 이미지 파일명이 logo/crest/emblem류일 때만 채택.
const TEAM_WORD_RE = /축구|야구|구단|클럽|프로팀|football|baseball|soccer|club|team/i;
const LOGO_FILE_RE = /logo|crest|badge|emblem|symbol|escudo|wappen|blason|logotipo|shield/i;
async function wikiTeamLookup(koName, sport) {
  const q = koName + (sport === 'Baseball' ? ' 야구' : ' 축구');
  const url = 'https://ko.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrlimit: '1',
    prop: 'langlinks|pageimages|extracts', lllang: 'en', piprop: 'thumbnail', pithumbsize: '200',
    exintro: '1', explaintext: '1', exchars: '300', origin: '*',
  });
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const pages = Object.values((await res.json()).query?.pages || {});
    const p = pages[0];
    if (!p || !TEAM_WORD_RE.test(p.extract || '')) return { en: null, logo: null };
    const en = p.langlinks?.[0]?.['*'] || null;
    const thumb = p.thumbnail?.source || null;
    let fileName = '';
    try { fileName = thumb ? decodeURIComponent(thumb) : ''; } catch {}
    return { en, logo: thumb && LOGO_FILE_RE.test(fileName) ? thumb : null };
  } catch {
    return undefined;
  }
}

async function main() {
  const games = JSON.parse(await fs.readFile(GAMES_PATH, 'utf-8'));
  const teamNameEn = JSON.parse(await fs.readFile(TEAM_NAME_EN_PATH, 'utf-8'));
  // 팀명→스포츠 맵(sportLabel 필터용). AMBIGUOUS_TEAM_KO_NAMES 9곳은 실제로 여러 스포츠에
  // 걸치지만(위 주석 참고) 그 목록에서 아예 건너뛰므로 여기선 "첫 관측 스포츠 고정"이 안전.
  const koTeamSport = new Map(); // cacheKey → sportLabel
  const keyToKo = new Map(); // cacheKey → 한글 팀명
  const addTeam = (ko, league) => {
    if (!ko) return;
    if (AMBIGUOUS_TEAM_KO_NAMES.has(ko)) {
      const sport = league === 'MLB' ? 'Baseball' : 'Soccer';
      const key = `${ko}|${sport}`;
      if (!koTeamSport.has(key)) { koTeamSport.set(key, sport); keyToKo.set(key, ko); }
      return;
    }
    if (!koTeamSport.has(ko)) {
      koTeamSport.set(ko, isBaseballLeague(league) ? 'Baseball' : 'Soccer');
      keyToKo.set(ko, ko);
    }
  };
  for (const g of games) { addTeam(g.home, g.league); addTeam(g.away, g.league); }
  const koTeamNames = new Set(koTeamSport.keys());

  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(LOGOS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[team-logos] no team-logos.json yet — backfilling from scratch');
  }

  let used = 0;
  let found = 0;
  let noEnglishName = 0;
  for (const cacheKey of koTeamNames) {
    if (cacheKey in cache) continue; // 이미 시도함(null도 캐시 — "찾아봤지만 없음"과 "아직 안 찾아봄" 구분).
    const koName = keyToKo.get(cacheKey);
    const sport = koTeamSport.get(cacheKey);
    const englishName = AMBIGUOUS_CITY_TEAM_OVERRIDES[koName]?.[sport] || TEAM_SEARCH_NAME_OVERRIDES[koName] || teamNameEn[koName];
    if (!englishName) {
      noEnglishName++;
      continue; // TEAM_NAME_EN에 없는 팀(신생 팀 등) — 다음에 그 딕셔너리 갱신되면 자동으로 잡힘.
    }
    if (used >= BUDGET) break;
    used++;
    await sleep(REQUEST_DELAY_MS);
    const badge = await fetchTeamBadge(englishName, sport);
    cache[cacheKey] = badge;
    if (badge) found++;
  }

  // 위키 폴백: TheSportsDB에서 못 찾은(null) 팀 + 영문명 없는 팀, 팀당 1회만 시도(tried 파일로 기록).
  let wikiTried = {};
  try { wikiTried = JSON.parse(await fs.readFile(WIKI_TRIED_PATH, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let wikiUsed = 0;
  let wikiFound = 0;
  for (const cacheKey of koTeamNames) {
    if (wikiUsed >= WIKI_BUDGET) break;
    if (wikiTried[cacheKey]) continue;
    if (cache[cacheKey]) continue;
    const koName = keyToKo.get(cacheKey);
    const sport = koTeamSport.get(cacheKey);
    wikiUsed++;
    await sleep(300);
    const w = await wikiTeamLookup(koName, sport);
    if (w === undefined) continue;
    wikiTried[cacheKey] = true;
    let badge = null;
    if (w.en && !(AMBIGUOUS_CITY_TEAM_OVERRIDES[koName] || TEAM_SEARCH_NAME_OVERRIDES[koName] || teamNameEn[koName])) {
      await sleep(REQUEST_DELAY_MS);
      badge = await fetchTeamBadge(w.en, sport);
    }
    // 위키 이미지 직접 사용은 오귀속(세인트루이스→MLB 리그 로고) 실측으로 제외 — 영문명→TheSportsDB 경로만 사용.
    if (badge) { cache[cacheKey] = badge; wikiFound++; }
  }
  await fs.writeFile(WIKI_TRIED_PATH, JSON.stringify(wikiTried, null, 2) + '\n', 'utf-8');
  console.log('[team-logos] wikiUsed=' + wikiUsed + ' wikiFound=' + wikiFound);

  // 3차: 수동 매핑한 영문 위키백과 제목 → 인포박스 로고/Wikidata P154. 팀당 1회(tried 파일).
  let titles = {};
  try { titles = JSON.parse(await fs.readFile(TITLES_PATH, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let titlesTried = {};
  try { titlesTried = JSON.parse(await fs.readFile(TITLES_TRIED_PATH, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let tUsed = 0;
  let tFound = 0;
  for (const cacheKey of koTeamNames) {
    if (cache[cacheKey] || titlesTried[cacheKey]) continue;
    const title = titles[keyToKo.get(cacheKey)];
    if (!title) continue;
    tUsed++;
    await sleep(300);
    const logo = await fetchLogoByEnTitle(title);
    if (logo === undefined) continue;
    titlesTried[cacheKey] = true;
    if (logo) { cache[cacheKey] = logo; tFound++; }
  }
  await fs.writeFile(TITLES_TRIED_PATH, JSON.stringify(titlesTried, null, 2) + '\n', 'utf-8');
  console.log('[team-logos] titlesUsed=' + tUsed + ' titlesFound=' + tFound);

  await fs.writeFile(LOGOS_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[team-logos] totalTeams=${koTeamNames.size} cached=${Object.keys(cache).length} thisRunUsed=${used} thisRunFound=${found} noEnglishName=${noEnglishName}`);
}

main().catch((e) => {
  console.error('[team-logos] FATAL:', e);
  process.exit(1);
});

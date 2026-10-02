// 경기장 사진 백필(2026-09-30, 사용자: "예전에 얘기한 경기장 사진이라던지") — TheSportsDB(선수/팀
// 로고에 이미 쓰는 무료 소스)의 팀 검색으로 얻은 idVenue를 lookupvenue.php로 조회하면 실제
// 구장 외관 사진(strThumb)을 얻을 수 있음(실측: 대구삼성라이온즈파크 확인, K리그/KBO 구장도
// 커버됨). searchvenues.php(구장명 직접검색)는 실측상 항상 빈 응답이라(원인 불명, API 자체
// 결함으로 추정) 팀 검색 경유가 유일한 방법.
//
// venues-meta.json(App.tsx VENUES 배열에서 1회 추출: id/name/teams/sport)과 team-name-en.json
// (한글→영문 약칭, 팀 로고 백필과 동일 파일 재사용)이 필요. 팀 로고와 동일하게 하루 1회만
// 실행해 venue-photos.json에 영구 캐시(런타임 API 호출 0회 원칙, 무료 공유키 절약).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchVenuePhotoFromWikipedia, WIKI_REQUEST_DELAY_MS } from './venue-photo-wiki.mjs';
import { fetchVenuePhotoFromCommons } from './venue-photo-commons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const VENUES_META_PATH = path.join(REPO_ROOT, 'venues-meta.json');
const TEAM_NAME_EN_PATH = path.join(REPO_ROOT, 'team-name-en.json');
const VENUE_NAME_EN_PATH = path.join(REPO_ROOT, 'venue-name-en.json');
const VENUE_PHOTOS_PATH = path.join(REPO_ROOT, 'venue-photos.json');
const COMMONS_TRIED_PATH = path.join(REPO_ROOT, 'venue-photos-commons-tried.json');
const COMMONS_BUDGET = 150;
const REQUEST_DELAY_MS = 2200; // team-logos와 동일 이유(무료 공유키 분당 30회 한도).
const BUDGET = 150; // 팀 검색 1회 + venue lookup 1회 = 구장당 최대 2호출, 여유 있게.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 위키피디아 폴백(2026-09-30, 사용자: "근데어짜피국대경기도클럽구장에서 시합하거든" — 소속팀이
// 없는(국가대표 친선/컵대회 결승 등) 경기도 실제로는 어느 클럽의 진짜 구장에서 열리는 경우가
// 대부분이라, "팀이 없다"가 "구장 자체를 못 찾는다"는 뜻은 아니라는 지적). App.tsx의
// VENUE_NAME_EN(구장 id→영문 정식명+도시, 1회 추출해 venue-name-en.json으로 커밋)을 그대로
// 검색어로 써서 위키피디아에서 그 구장 자체를 직접 찾음 — 팀 소속 여부와 완전히 무관해서
// team-name-en.json에 없는 641개 구장 대부분(1,491개 중 629개가 영문명 확보됨)을 커버 가능.
// 실제 fetch 로직(fetchVenuePhotoFromWikipedia)은 venue-photo-wiki.mjs로 분리(테스트 자동화용,
// baseball-highlight-parse.mjs와 동일 이유).
const WIKI_BUDGET = 80; // 검색 1회 + 요약 1회 = 구장당 최대 2호출.

// MLB/MLS 도시명 겹침 9곳(2026-09-30, "mlb인데축구장사진이있네" 리포트 조사 중 발견 —
// team-name-en.json은 이 9곳을 구단 접미사 없는 "지명만"으로 등록해둠, [[project_i18n_japanese]]
// 메모 기록과 동일한 휴스턴/시애틀/마이애미/토론토/신시내티/콜로라도/미네소타/필라델피아/
// 세인트루이스). "Houston"처럼 지명만 검색하면 TheSportsDB가 무관한 스포츠(미식축구/농구 등) 팀
// 1건만 반환해 sportLabel 필터를 걸어도 "못 찾음"으로 남음 — 정식 구단명으로 검색하면 정확히
// 찾아짐을 실측 확인, 이 9곳만 오버라이드로 정식 구단명 사용. 세인트루이스(카디널스)는 어떤
// 검색어 포맷으로도 무관한 팀만 나와(실측: Louisville 등으로 오매칭) 오버라이드 없이 미해결
// 유지(오귀속보단 유실이 안전).
const AMBIGUOUS_CITY_TEAM_OVERRIDES = {
  '휴스턴': { Baseball: 'Houston Astros', Soccer: 'Houston Dynamo' },
  '시애틀': { Baseball: 'Seattle Mariners', Soccer: 'Seattle Sounders' },
  '마이애미': { Baseball: 'Miami Marlins', Soccer: 'Inter Miami' },
  '토론토': { Baseball: 'Toronto Blue Jays', Soccer: 'Toronto FC' },
  '신시내티': { Baseball: 'Cincinnati Reds', Soccer: 'FC Cincinnati' },
  '콜로라도': { Baseball: 'Colorado Rockies', Soccer: 'Colorado Rapids' },
  '미네소타': { Baseball: 'Minnesota Twins', Soccer: 'Minnesota United' },
  '필라델피아': { Baseball: 'Philadelphia Phillies', Soccer: 'Philadelphia Union' },
};

// 남자팀/여자팀 이름 겹침(2026-09-30, "이건맞아?" 리포트로 발견 — "Alaves" 검색이 여자팀
// (Alavés Gloriosas) 1건만 반환해 strGender 필터를 걸면 아예 못 찾음) — 정식 구단명으로 검색하면
// 남자팀이 정확히 찾아짐을 실측 확인. 위 도시명 겹침과 원인이 달라 별도 맵으로 관리(발견되는
// 대로 추가, 지금은 알라베스 1건만 확인됨).
const TEAM_SEARCH_NAME_OVERRIDES = {
  '알라베스': 'Deportivo Alaves',
};

// fetch 타임아웃(2026-09-30, 실측 발견) — 위키 폴백 추가 후 배치 하나가 20분+ 멈춰있던 사고를
// 조사하던 중, 이 TheSportsDB 호출도 애초에 타임아웃이 전혀 없었다는 걸 확인(원래부터 있던
// 문제, 위키 쪽만 먼저 고치고 보니 재발 — 같은 사고가 이쪽 fetch에서도 날 수 있음). 10초 안에
// 응답 없으면 그 후보만 포기.
const FETCH_TIMEOUT_MS = 10000;
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 반환값 3가지 상태(2026-09-30, "아직부족해 100프로백필다채워야지" 요청으로 재조사 중 발견한
// 버그 수정 — venue-photo-wiki.mjs의 fetchVenuePhotoFromWikipedia와 동일 계약) — 타임아웃/
// 일시적 응답 실패까지 null로 뭉뚱그려 캐시해버리면 그 실패가 영구 고정됨(같은 세션에서 여러
// 번 고친 "final:true 스테일 스냅샷" 버그와 동일 클래스). string(찾음) | null(확인했지만 진짜
// 없음) | undefined(일시적 실패, 재시도 대상)로 명확히 구분.
async function fetchVenuePhoto(englishTeamName, sportLabel) {
  let res;
  try {
    res = await fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(englishTeamName)}`);
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  const j = await res.json();
  const teams = j.teams || [];
  // 검색어가 fuzzy match라 다른 스포츠 동명 팀이 섞일 수 있어(예: 같은 도시명 축구/야구단)
  // sportLabel로 걸러냄. 버그 수정(2026-09-30, "mlb인데축구장사진이있네" 리포트로 발견 —
  // 다이킨 파크(휴스턴 애스트로스 MLB 구장)에 휴스턴 쿠거스(미식축구) TDECU 스타디움 사진이
  // 붙어있었음): "Houston" 검색이 TheSportsDB에서 야구팀 없이 미식축구팀 딱 1건만 반환하는
  // 경우가 실측 확인됨 — 이전엔 스포츠 불일치여도 teams[0]로 폴백해서 엉뚱한 스포츠의 구장이
  // 그대로 붙었음. 잘못된 사진보단 "사진 없음"이 안전(다른 배필들과 동일 철학) — 폴백 제거.
  // 추가 버그(2026-09-30, "이건맞아?" 리포트 — 멘디소로차(알라베스 라리가 남자팀 홈구장)에
  // 알라베스 여자팀(Alavés Gloriosas) 훈련장 사진이 붙어있었음): "Alaves" 검색이 스포츠는
  // 맞지만(Soccer) 여자팀 1건만 반환하는 경우가 실측 확인됨 — 우리 데이터는 전부 남자
  // 클럽/대표팀이라 strGender==='Female'인 결과는 제외(성별 필드 자체가 없는 국가대표 등은
  // 그대로 허용 — 명시적으로 여자팀이라고 확인된 것만 배제).
  const team = teams.find((t) => t.strSport === sportLabel && t.strGender !== 'Female');
  if (!team?.idVenue) return null; // 검색 결과 자체가 없거나 스포츠/성별 안 맞음 — 확정적으로 없음.
  await sleep(REQUEST_DELAY_MS);
  let vres;
  try {
    vres = await fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/lookupvenue.php?id=${team.idVenue}`);
  } catch {
    return undefined;
  }
  if (!vres.ok) return undefined;
  const vj = await vres.json();
  const venue = (vj.venues || [])[0];
  if (!venue) return null;
  // 사진 여러 장(2026-09-30, "구장사진 한장이잖어 여러장은 못가져오나" 요청) — TheSportsDB
  // venue lookup은 strThumb(대표) 외에 strFanart1~4(추가 사진)도 같이 줌(실측 확인: 레알
  // 마드리드 홈구장은 5장 전부 있음). 예전엔 strThumb 하나만 쓰고 나머지를 버렸음.
  const photos = [venue.strThumb, venue.strFanart1, venue.strFanart2, venue.strFanart3, venue.strFanart4].filter(Boolean);
  return photos.length > 0 ? photos : null;
}

async function main() {
  const venuesMeta = JSON.parse(await fs.readFile(VENUES_META_PATH, 'utf-8'));
  const teamNameEn = JSON.parse(await fs.readFile(TEAM_NAME_EN_PATH, 'utf-8'));
  let venueNameEn = {};
  try {
    venueNameEn = JSON.parse(await fs.readFile(VENUE_NAME_EN_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[venue-photos] no venue-name-en.json — 위키 폴백 비활성');
  }
  // 농구 구장(basketball/venues.json, id 'bk_*')도 같은 파이프라인 — 사진은 같은 venue-photos.json에 id로 저장.
  try {
    const bkV = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'venues.json'), 'utf-8'));
    const bkEn = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'venue-name-en.json'), 'utf-8'));
    const bkTeamEn = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'team-name-en.json'), 'utf-8'));
    Object.assign(venueNameEn, bkEn);
    for (const [id, v] of Object.entries(bkV)) {
      const tk = (v.teams || [])[0];
      const tn = tk && bkTeamEn['bk:' + tk];
      if (tn) teamNameEn['bk:' + tk] = tn;
      venuesMeta.push({ id, name: v.name, teams: tn ? 'bk:' + tk : '', sport: 'basketball' });
    }
  } catch {}

  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(VENUE_PHOTOS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[venue-photos] no venue-photos.json yet — backfilling from scratch');
  }

  let used = 0;
  let found = 0;
  let noEnglishName = 0;
  let wikiUsed = 0;
  let wikiFound = 0;
  const sportLabel = { baseball: 'Baseball', football: 'Soccer', basketball: 'Basketball' };
  for (const v of venuesMeta) {
    if (v.id in cache) continue;
    const firstTeam = (v.teams || '').split('·')[0]?.trim();
    const sport = sportLabel[v.sport] || 'Soccer';
    const englishName = firstTeam
      ? (AMBIGUOUS_CITY_TEAM_OVERRIDES[firstTeam]?.[sport] || TEAM_SEARCH_NAME_OVERRIDES[firstTeam] || teamNameEn[firstTeam])
      : undefined;
    if (!englishName) noEnglishName++;
    const venueEn = venueNameEn[v.id];

    const canTrySportsDb = !!englishName && used < BUDGET && v.sport !== 'basketball';
    const canTryWiki = !!venueEn?.name && wikiUsed < WIKI_BUDGET;
    if (!canTrySportsDb && !canTryWiki) {
      // 이번 실행에서 시도할 방법이 아예 없음 — 팀/영문 구장명 둘 다 없으면(재시도해도 의미
      // 없음) null로 확정, 예산만 소진된 경우면 그냥 건너뛰어 다음 실행에 재시도.
      if (!englishName && !venueEn?.name) cache[v.id] = null;
      continue;
    }

    let photos = null;
    if (canTrySportsDb) {
      used++;
      await sleep(REQUEST_DELAY_MS);
      photos = await fetchVenuePhoto(englishName, sport);
      if (photos) found++;
    }
    if (!photos && canTryWiki) {
      wikiUsed++;
      await sleep(WIKI_REQUEST_DELAY_MS);
      const wikiPhoto = await fetchVenuePhotoFromWikipedia(venueEn.name);
      if (wikiPhoto) { photos = [wikiPhoto]; wikiFound++; }
      else photos = wikiPhoto; // null 또는 undefined 그대로 전달(재시도 계약 유지).
    }
    cache[v.id] = photos;
  }

  // Commons 2차 폴백(2026-09-30): TheSportsDB/영문 위키에서 못 찾아 null로 굳은 구장을 구장당 1회 재시도.
  let commonsTried = {};
  try { commonsTried = JSON.parse(await fs.readFile(COMMONS_TRIED_PATH, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let commonsUsed = 0;
  let commonsFound = 0;
  for (const v of venuesMeta) {
    if (commonsUsed >= COMMONS_BUDGET) break;
    const cur = cache[v.id];
    if (!(v.id in cache) || (cur && cur.length) || commonsTried[v.id]) continue;
    const venueEn = venueNameEn[v.id];
    if (!venueEn?.name) continue;
    commonsUsed++;
    await sleep(WIKI_REQUEST_DELAY_MS);
    const photo = await fetchVenuePhotoFromCommons(venueEn.name, venueEn.city);
    if (photo === undefined) continue;
    commonsTried[v.id] = true;
    if (photo) { cache[v.id] = [photo]; commonsFound++; }
  }
  await fs.writeFile(COMMONS_TRIED_PATH, JSON.stringify(commonsTried, null, 2) + '\n', 'utf-8');
  console.log('[venue-photos] commonsUsed=' + commonsUsed + ' commonsFound=' + commonsFound);

  await fs.writeFile(VENUE_PHOTOS_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[venue-photos] totalVenues=${venuesMeta.length} cached=${Object.keys(cache).length} thisRunUsed=${used} thisRunFound=${found} wikiUsed=${wikiUsed} wikiFound=${wikiFound} noEnglishName=${noEnglishName}`);
}

main().catch((e) => {
  console.error('[venue-photos] FATAL:', e);
  process.exit(1);
});

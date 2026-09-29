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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const VENUES_META_PATH = path.join(REPO_ROOT, 'venues-meta.json');
const TEAM_NAME_EN_PATH = path.join(REPO_ROOT, 'team-name-en.json');
const VENUE_PHOTOS_PATH = path.join(REPO_ROOT, 'venue-photos.json');
const REQUEST_DELAY_MS = 2200; // team-logos와 동일 이유(무료 공유키 분당 30회 한도).
const BUDGET = 150; // 팀 검색 1회 + venue lookup 1회 = 구장당 최대 2호출, 여유 있게.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function fetchVenuePhoto(englishTeamName, sportLabel) {
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(englishTeamName)}`);
    if (!res.ok) return null;
    const j = await res.json();
    const teams = j.teams || [];
    // 검색어가 fuzzy match라 다른 스포츠 동명 팀이 섞일 수 있어(예: 같은 도시명 축구/야구단)
    // sportLabel로 걸러냄. 버그 수정(2026-09-30, "mlb인데축구장사진이있네" 리포트로 발견 —
    // 다이킨 파크(휴스턴 애스트로스 MLB 구장)에 휴스턴 쿠거스(미식축구) TDECU 스타디움 사진이
    // 붙어있었음): "Houston" 검색이 TheSportsDB에서 야구팀 없이 미식축구팀 딱 1건만 반환하는
    // 경우가 실측 확인됨 — 이전엔 스포츠 불일치여도 teams[0]로 폴백해서 엉뚱한 스포츠의 구장이
    // 그대로 붙었음. 잘못된 사진보단 "사진 없음"이 안전(다른 배필들과 동일 철학) — 폴백 제거.
    const team = teams.find((t) => t.strSport === sportLabel);
    if (!team?.idVenue) return null;
    await sleep(REQUEST_DELAY_MS);
    const vres = await fetch(`https://www.thesportsdb.com/api/v1/json/3/lookupvenue.php?id=${team.idVenue}`);
    if (!vres.ok) return null;
    const vj = await vres.json();
    const venue = (vj.venues || [])[0];
    return venue?.strThumb || venue?.strFanart1 || null;
  } catch {
    return null;
  }
}

async function main() {
  const venuesMeta = JSON.parse(await fs.readFile(VENUES_META_PATH, 'utf-8'));
  const teamNameEn = JSON.parse(await fs.readFile(TEAM_NAME_EN_PATH, 'utf-8'));

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
  const sportLabel = { baseball: 'Baseball', football: 'Soccer' };
  for (const v of venuesMeta) {
    if (v.id in cache) continue;
    const firstTeam = (v.teams || '').split('·')[0]?.trim();
    const sport = sportLabel[v.sport] || 'Soccer';
    const englishName = firstTeam ? (AMBIGUOUS_CITY_TEAM_OVERRIDES[firstTeam]?.[sport] || teamNameEn[firstTeam]) : undefined;
    if (!englishName) {
      noEnglishName++;
      continue;
    }
    if (used >= BUDGET) break;
    used++;
    await sleep(REQUEST_DELAY_MS);
    const photo = await fetchVenuePhoto(englishName, sport);
    cache[v.id] = photo;
    if (photo) found++;
  }

  await fs.writeFile(VENUE_PHOTOS_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[venue-photos] totalVenues=${venuesMeta.length} cached=${Object.keys(cache).length} thisRunUsed=${used} thisRunFound=${found} noEnglishName=${noEnglishName}`);
}

main().catch((e) => {
  console.error('[venue-photos] FATAL:', e);
  process.exit(1);
});

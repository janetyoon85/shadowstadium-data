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

async function fetchVenuePhoto(englishTeamName, sportLabel) {
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(englishTeamName)}`);
    if (!res.ok) return null;
    const j = await res.json();
    const teams = j.teams || [];
    // 검색어가 fuzzy match라 다른 스포츠 동명 팀이 섞일 수 있어(예: 같은 도시명 축구/야구단)
    // sportLabel로 걸러냄 — 못 찾으면 스포츠 무관하게 첫 결과로 폴백.
    const team = teams.find((t) => t.strSport === sportLabel) || teams[0];
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
    const englishName = firstTeam ? teamNameEn[firstTeam] : undefined;
    if (!englishName) {
      noEnglishName++;
      continue;
    }
    if (used >= BUDGET) break;
    used++;
    await sleep(REQUEST_DELAY_MS);
    const photo = await fetchVenuePhoto(englishName, sportLabel[v.sport] || 'Soccer');
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

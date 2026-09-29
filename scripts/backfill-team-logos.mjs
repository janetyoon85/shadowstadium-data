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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTeamBadge(englishName) {
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(englishName)}`);
    if (!res.ok) return null;
    const j = await res.json();
    const team = (j.teams || [])[0];
    return team?.strBadge || null;
  } catch {
    return null;
  }
}

async function main() {
  const games = JSON.parse(await fs.readFile(GAMES_PATH, 'utf-8'));
  const teamNameEn = JSON.parse(await fs.readFile(TEAM_NAME_EN_PATH, 'utf-8'));
  const koTeamNames = new Set();
  for (const g of games) {
    if (g.home) koTeamNames.add(g.home);
    if (g.away) koTeamNames.add(g.away);
  }

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
  for (const koName of koTeamNames) {
    if (koName in cache) continue; // 이미 시도함(null도 캐시 — "찾아봤지만 없음"과 "아직 안 찾아봄" 구분).
    const englishName = teamNameEn[koName];
    if (!englishName) {
      noEnglishName++;
      continue; // TEAM_NAME_EN에 없는 팀(신생 팀 등) — 다음에 그 딕셔너리 갱신되면 자동으로 잡힘.
    }
    if (used >= BUDGET) break;
    used++;
    await sleep(REQUEST_DELAY_MS);
    const badge = await fetchTeamBadge(englishName);
    cache[koName] = badge;
    if (badge) found++;
  }

  await fs.writeFile(LOGOS_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[team-logos] totalTeams=${koTeamNames.size} cached=${Object.keys(cache).length} thisRunUsed=${used} thisRunFound=${found} noEnglishName=${noEnglishName}`);
}

main().catch((e) => {
  console.error('[team-logos] FATAL:', e);
  process.exit(1);
});

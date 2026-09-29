// 위키피디아 구장 사진 폴백(2026-09-30, 사용자: "근데어짜피국대경기도클럽구장에서 시합하거든" —
// 소속팀이 없는(국가대표 친선/컵대회 결승 등) 경기도 실제로는 어느 클럽의 진짜 구장에서 열리는
// 경우가 대부분이라, "팀이 없다"가 "구장 자체를 못 찾는다"는 뜻은 아니라는 지적). App.tsx의
// VENUE_NAME_EN(구장 id→영문 정식명+도시, 1회 추출해 venue-name-en.json으로 커밋)을 그대로
// 검색어로 써서 위키피디아에서 그 구장 자체를 직접 찾음 — 팀 소속 여부와 완전히 무관해서
// team-name-en.json에 없는 641개 구장 대부분(1,491개 중 629개가 영문명 확보됨)을 커버 가능.
// 위키 검색 API(fuzzy)+요약 API 2단계 조합, 실측 확인(2026-09-30): 정확한 문서 제목을 몰라도
// 검색으로 찾은 1위 결과가 대부분 정확함. 단, 동명이인/동명장소 위험 있음(실측: "Field of
// Dreams" 검색이 실제 구장 대신 1989년 영화 문서로 감) — description에 stadium/arena/park 등
// 구장 관련 키워드가 없으면 폐기(틀린 사진보단 없는 게 낫다, 이 세션 전체와 동일 원칙).
//
// backfill-venue-photos.mjs의 main() 자동실행(fs 읽기+실 네트워크 호출) 없이 테스트가 이 함수만
// 독립적으로 불러와 검증할 수 있게 별도 파일로 분리(2026-09-28 baseball-highlight-parse.mjs와
// 동일한 이유).
export const WIKI_REQUEST_DELAY_MS = 1200; // 실측(2026-09-30): 빠르게 연속 요청하면 "You are
// making too many requests" 429류 응답 — 1.2초 간격이면 안전(공식 rate limit 문서화 안 돼있어
// 보수적으로 설정).
export const WIKI_UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
export const STADIUM_KEYWORDS = ['stadium', 'arena', 'ballpark', 'park', 'field', 'ground', 'dome', 'coliseum', 'colosseum', 'estadio', 'venue', 'sportanlage', 'stade'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch 타임아웃(2026-09-30, 실측 발견) — 위키 요청 하나가 응답도 에러도 없이 무한 대기하면서
// 배치 전체(80건)가 20분 넘게 멈춰있던 사고를 실측 확인(원인 불명 — 위키 쪽 순간 장애로 추정,
// AbortController 자체가 아예 없었던 게 진짜 원인). 10초 안에 응답 없으면 그 후보만 포기(다음
// venue로 계속 진행) — 이 크롤러의 다른 fetch들(TheSportsDB 등)은 지금까지 이 문제가 실측된
// 적이 없어 그대로 두고, 여기만 우선 추가.
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

export async function fetchVenuePhotoFromWikipedia(venueName) {
  try {
    const sres = await fetchWithTimeout(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(venueName)}&format=json&srlimit=1`, { headers: { 'User-Agent': WIKI_UA } });
    if (!sres.ok) return null;
    const sj = await sres.json();
    const title = sj.query?.search?.[0]?.title;
    if (!title) return null;
    await sleep(WIKI_REQUEST_DELAY_MS);
    const pres = await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: { 'User-Agent': WIKI_UA } });
    if (!pres.ok) return null;
    const pj = await pres.json();
    const desc = (pj.description || '').toLowerCase();
    if (!STADIUM_KEYWORDS.some((k) => desc.includes(k))) return null; // 동명이인/동명장소 방지.
    return pj.thumbnail?.source || pj.originalimage?.source || null;
  } catch {
    return null;
  }
}

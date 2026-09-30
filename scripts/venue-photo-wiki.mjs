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
// 버그 수정(2026-09-30, "이거" 리포트 — 에너자이저 파크(세인트루이스 시티 SC 구장)에 전혀
// 무관한 "City Park, Saint Louis"(그냥 일반 공원) 사진이 붙어있었음) — "park"/"field"/"ground"/
// "venue"/"dome"은 스포츠 시설이 아닌 것도 흔히 이렇게 불려서(실측: 문제의 문서 설명이 그냥
// "Park in St. Louis, Missouri" — 스포츠 관련 단어가 전혀 없었음) 이 단어들만으로는 동명이인
// 방지가 안 됨. "stadium"/"arena"/"ballpark" 등은 그 자체로 스포츠 시설임이 명확해 단독으로도
// 안전(STRONG). "park"/"field"/"ground"/"venue"/"dome"은 스포츠 맥락 단어(baseball/football/
// soccer/sports 등)와 같이 나올 때만 인정(WEAK — 실측: 정상 매칭 Truist Park의 설명은 "Baseball
// park in Metro Atlanta, Georgia"처럼 항상 스포츠 단어와 붙어 나옴).
export const STRONG_STADIUM_KEYWORDS = ['stadium', 'arena', 'ballpark', 'coliseum', 'colosseum', 'estadio', 'stade', 'sportanlage'];
export const WEAK_STADIUM_KEYWORDS = ['park', 'field', 'ground', 'venue', 'dome'];
// "track" 추가(2026-09-30, 재검증 중 발견) — Icahn Stadium(뉴욕 실제 육상경기장) 재검증에서
// description이 "Track and field facility in Manhattan, New York"라 어떤 컨텍스트 단어에도
// 안 걸려 잘못 탈락(가양성)했음 — 육상(track and field)도 흔한 스포츠 시설 유형이라 추가.
export const SPORT_CONTEXT_WORDS = ['baseball', 'football', 'soccer', 'sports', 'sport', 'multi-purpose', 'multipurpose', 'athletic', 'rugby', 'cricket', 'hockey', 'track'];
export function isPlausibleStadiumDescription(desc) {
  const d = (desc || '').toLowerCase();
  if (STRONG_STADIUM_KEYWORDS.some((k) => d.includes(k))) return true;
  return WEAK_STADIUM_KEYWORDS.some((k) => d.includes(k)) && SPORT_CONTEXT_WORDS.some((k) => d.includes(k));
}
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

// 반환값 3가지 상태(2026-09-30, "아직부족해 100프로백필다채워야지" 요청으로 재조사 중 발견한
// 버그 수정) — 예전엔 네트워크 타임아웃/일시적 429/API 장애까지 전부 그냥 null로 뭉뚱그려서
// 호출부가 그걸 "확인해봤지만 사진 없음(영구)"으로 캐시해버렸음. 실측 확인: Groupama Arena/
// MCH Arena/Old Peter Mokaba Stadium처럼 지금 다시 조회하면 멀쩡히 찾아지는 유명 구장들이
// 이전 실행의 일시적 실패 때문에 영구 null로 굳어있었음(같은 세션에서 여러 번 고친 "final:true
// 스테일 스냅샷" 버그와 동일 클래스). 이제 string(찾음) | null(확인했지만 진짜 없음 — 동명이인/
// 검색결과 자체 없음/썸네일 없는 문서) | undefined(일시적 실패, 다음 실행에 재시도해야 함)로
// 명확히 구분 — 호출부가 undefined는 캐시하지 않고 넘어가게 함.
// 검색 결과 순위 불안정(2026-09-30, "이거" 후속 재조사 중 발견) — 같은 검색어("Energizer Park")를
// 완전히 동일한 코드로 여러 번 호출했는데 결과가 "Energizer Park"(정답)와 "City Park, Saint
// Louis"(오답, "energizer"란 단어와 무관한 fuzzy 매치)로 실행마다 갈리는 걸 실측 확인 — 코드
// 문제가 아니라 위키 검색 백엔드가 여러 복제본에 분산돼있어 어느 복제본이 응답하냐에 따라 랭킹이
// 달라지는 것으로 추정. srlimit=1(1위만) 대신 상위 5개를 받아서, 검색어와 제목이 정확히 일치하는
// 후보가 있으면 그걸 우선 사용 — 백엔드 랭킹이 흔들려도 "정확히 이 이름인 문서"는 항상 같은
// 결과를 주므로 안정적.
export async function fetchVenuePhotoFromWikipedia(venueName) {
  let sres;
  try {
    sres = await fetchWithTimeout(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(venueName)}&format=json&srlimit=5`, { headers: { 'User-Agent': WIKI_UA } });
  } catch {
    return undefined; // 타임아웃/네트워크 오류 — 재시도 대상.
  }
  if (!sres.ok) return undefined; // 429/5xx 등 일시적 응답으로 간주 — 재시도 대상.
  const sj = await sres.json();
  const results = sj.query?.search || [];
  const exactMatch = results.find((r) => r.title?.toLowerCase() === venueName.toLowerCase());
  const title = exactMatch?.title ?? results[0]?.title;
  if (!title) return null; // 검색 결과 자체가 없음 — 이 이름으론 확정적으로 없음.
  await sleep(WIKI_REQUEST_DELAY_MS);
  let pres;
  try {
    pres = await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: { 'User-Agent': WIKI_UA } });
  } catch {
    return undefined;
  }
  if (!pres.ok) return undefined;
  const pj = await pres.json();
  if (!isPlausibleStadiumDescription(pj.description)) return null; // 동명이인/동명장소 방지.
  const cand = pj.thumbnail?.source || pj.originalimage?.source || null;
  // 로고/치수도/배치도/svg 렌더는 사진이 아님(2026-10-01, 마쓰다 스타디움 치수도가 사진으로 뜸).
  if (cand && /\.svg|dimen[st]?i?on|diagram|layout|seating|logo|locator|schematic|flag_of|coat_of_arms/i.test(decodeURIComponent(cand.split('/').pop() || ''))) return null;
  return cand; // 문서는 맞는데 사진이 없음 — 확정.
}

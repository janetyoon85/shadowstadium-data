// YouTube search.list 절약용 "성공률 기반 예산 배분"(2026-10-09, 사용자: 검색 한도 승인 전까지 검색 사용을 줄여라).
// 배경: 구글 할당량의 "Search Queries per day"는 하루 100회 고정이고(실측: 99/100 소진), 하이라이트 보강 검색(65)과
// 선수 응원가 검색(30)이 이 한도를 나눠 쓴다. 그런데 소스별 성공률이 크게 다르다(실측 2026-10-09):
//   응원가: kbo 65%(269/411) · nbk:kbl 37%(49/131) · naver(K리그 등) 9%(43/442)
//   하이라이트 검색: UNL 34/34 · AMATCHFRIENDLY 16/20 · AFL 0/12(31회 검색)
// → 성공률이 낮은 곳에 한도를 쓰지 않고, 처음 보는 소스는 소량 탐색(exploration)해서 성공률을 측정한다.
// 순수 함수라 단위 테스트가 가능하다(scripts/__tests__/search-yield.test.mjs).

export const PRIOR_RATE = 0.25; // 아직 모르는 소스는 25%로 가정(탐색 대상이 되도록 너무 낮게 잡지 않음)
export const PRIOR_WEIGHT = 4; // 가상 시도 횟수 — 표본이 적을 때 비율이 출렁이지 않게
export const LOW_YIELD_RATE = 0.12; // 이 밑이면 저성공으로 본다
export const LOW_YIELD_MIN_TRIES = 8; // 표본이 이만큼 쌓인 뒤에만 저성공 판정

/** 시도 n회 중 성공 h회 → 사전확률로 보정한 성공률. */
export function smoothedRate(stat) {
  const n = stat?.n || 0;
  const h = stat?.h || 0;
  return (h + PRIOR_RATE * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);
}

export function isLowYield(stat, minTries = LOW_YIELD_MIN_TRIES, minRate = LOW_YIELD_RATE) {
  return (stat?.n || 0) >= minTries && smoothedRate(stat) < minRate;
}

/**
 * 하이라이트 검색 후보 게이팅 — 저성공 리그는 7일에 한 번만 프로브(1회)해서 상황이 바뀌었는지(새 공식 채널·업로드 등) 확인한다.
 * 허용하면 stat.probeT 를 갱신한다(호출부가 stat 을 저장).
 */
export function allowSearch(stat, now, probeIntervalMs = 7 * 86400e3) {
  if (!isLowYield(stat)) return true;
  if (!stat.probeT || now - stat.probeT >= probeIntervalMs) { stat.probeT = now; return true; }
  return false;
}

/** 이미 있는 시도 기록(tried)과 결과로 리그별 통계를 1회 시드한다(저장된 통계가 없을 때만). */
export function seedStats(tried, hasResult, leagueOf) {
  const stats = {};
  for (const id of Object.keys(tried || {})) {
    const lg = leagueOf(id);
    if (!lg) continue;
    const s = (stats[lg] ??= { n: 0, h: 0 });
    s.n += 1;
    if (hasResult(id)) s.h += 1;
  }
  return stats;
}

/**
 * 응원가 검색 예산 배분. queues: { source: [대상...] } (각 큐는 이미 우선순위대로 정렬됨), stats: { source: {n,h} }.
 *  1) 탐색: 표본이 EXPLORE_MIN 미만인 소스는 실행당 EXPLORE_SLOTS 건까지 먼저 시도해 성공률을 측정.
 *  2) 본 배분: 보정 성공률이 높은 소스부터 예산을 채움.
 *  3) 저성공 소스는 남는 예산이 있어도 실행당 LOW_YIELD_SLOTS 건까지만(완전 중단하지 않고 계속 측정).
 */
export const EXPLORE_MIN = 20;
export const EXPLORE_SLOTS = 5;
export const LOW_YIELD_SLOTS = 3;

export function allocateBySource(stats, queues, budget) {
  const out = [];
  const taken = {};
  const take = (src, k) => {
    const q = queues[src] || [];
    const from = taken[src] || 0;
    const items = q.slice(from, from + Math.max(0, Math.min(k, budget - out.length)));
    taken[src] = from + items.length;
    out.push(...items);
  };
  const sources = Object.keys(queues).filter((s) => (queues[s] || []).length > 0).sort();
  // 1) 탐색
  for (const s of sources) if ((stats[s]?.n || 0) < EXPLORE_MIN) take(s, EXPLORE_SLOTS);
  // 2) 본 배분 — 성공률 높은 순(동률은 소스명), 저성공은 뒤로
  const ranked = [...sources].sort((a, b) => {
    const la = isLowYield(stats[a]), lb = isLowYield(stats[b]);
    if (la !== lb) return la ? 1 : -1;
    return smoothedRate(stats[b]) - smoothedRate(stats[a]) || a.localeCompare(b);
  });
  for (const s of ranked) {
    if (out.length >= budget) break;
    if (isLowYield(stats[s])) take(s, Math.max(0, LOW_YIELD_SLOTS - (taken[s] || 0)));
    else take(s, budget);
  }
  return out;
}

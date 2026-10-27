// 유럽 축구 ESPN 보강(EURO_ENRICH_ONLY, 네이버 정지 대응)의 결과를 기존 games.json 에 "안전하게" 합치는 규칙(2026-10-27).
// enrichEuroAssists 는 원래 일정 수집 전체 데이터(내부 형태)로 도는 함수라, 출력 형태 games.json 으로 돌리면 일부 기존 필드(선수 pid 승계 등)가 달라질 수 있다.
// 그래서 결과를 통째로 쓰지 않고: (1) 카드는 "원래 없거나, 개수가 늘었을 때만" 채택하되 기존 항목의 pid·nat 는 보존, (2) 승부차기는 원래 없을 때만 채택. 그 외 필드는 절대 바꾸지 않는다.
const total = (c) => (c?.home?.length || 0) + (c?.away?.length || 0);
const key = (e) => `${e.n}|${e.type}|${e.m}`;

function mergeSide(origList = [], nextList = []) {
  const prev = new Map(origList.map((e) => [key(e), e]));
  return nextList.map((e) => {
    const o = prev.get(key(e));
    return o ? { ...e, ...(o.pid ? { pid: o.pid } : {}), ...(o.nat ? { nat: o.nat } : {}) } : e;
  });
}

// orig/enriched: 같은 gameId 의 경기 객체. 바뀐 필드만 담은 patch 를 돌려준다.
export function euroEnrichPatch(orig, enriched) {
  const patch = {};
  if (enriched?.cards && (!orig.cards || total(enriched.cards) > total(orig.cards))) {
    const merged = { home: mergeSide(orig.cards?.home, enriched.cards.home || []), away: mergeSide(orig.cards?.away, enriched.cards.away || []) };
    patch.cards = merged;
  }
  if (enriched?.shootout && !orig.shootout) patch.shootout = enriched.shootout;
  return patch;
}

export function mergeEuroEnrichment(origGames, enrichedGames) {
  const byId = new Map(enrichedGames.map((g) => [g.gameId, g]));
  let changed = 0;
  const out = origGames.map((g) => {
    const e = g.gameId ? byId.get(g.gameId) : null;
    if (!e) return g;
    const p = euroEnrichPatch(g, e);
    if (!Object.keys(p).length) return g;
    changed++;
    return { ...g, ...p };
  });
  return { games: out, changed };
}

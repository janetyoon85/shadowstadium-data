// 네이버가 구장 표기를 바꿔도 경기가 조용히 사라지지 않게 하는 자동 보정(2026-10-26).
// 배경: 네이버가 오늘 구장 이름을 한꺼번에 바꿔(스폰서명·영문 표기 등 60여 개) 매핑표에 없는 이름이 된 경기가 크롤에서 빠져 국가대표 친선 78경기가 사라졌다.
// 규칙: 매핑표에 없는 이름이라도 ① 같은 gameId 의 이전(커밋된 games.json) 경기가 이미 구장을 알고 있으면 그 구장을 쓰고, ② 같은 카테고리·같은 이름이 이번 실행이나 이전에 위 방식으로 풀린 적이 있으면 그 구장을 쓴다.
// 완전히 새 구장(이전 기록이 없는 경기)은 예전처럼 미매핑 알림. 자동 보정한 항목은 알림으로 알려 사람이 확인 후 매핑표에 정식 추가한다.
// 한계: 네이버가 같은 경기의 구장을 "실제로 다른 곳"으로 바로잡은 경우(예: 닛산→도쿄 국립경기장)는 이전 구장을 그대로 따라가므로, 알림에서 이름을 보고 확인해야 한다.

export const isTbcVenue = (id) => !id || /(^|_)tbc$/.test(id) || id === 'venue_tbc';

// prevVenue: Map<gameId, venueId> (이전 games.json), learned: { 'cat::label': venueId }, ctx.auto 에 보정 내역을 쌓는다.
export function fallbackVenue({ gameId, categoryId, stadium }, ctx) {
  if (!ctx || !stadium) return null;
  const key = `${categoryId}::${stadium}`;
  const prev = ctx.prevVenue?.get(gameId);
  if (prev && !isTbcVenue(prev)) {
    if (ctx.learned[key] !== prev) { ctx.learned[key] = prev; ctx.dirty = true; }
    ctx.auto.push({ categoryId, stadium, venueId: prev, via: 'prev-game' });
    return prev;
  }
  const hit = ctx.learned[key];
  if (hit && !isTbcVenue(hit)) {
    ctx.auto.push({ categoryId, stadium, venueId: hit, via: 'learned' });
    return hit;
  }
  return null;
}

export function makeAutofixCtx(prevGames, learned = {}) {
  const prevVenue = new Map();
  for (const g of prevGames || []) if (g?.gameId && g.venueId) prevVenue.set(String(g.gameId), g.venueId);
  return { prevVenue, learned: { ...learned }, auto: [], dirty: false };
}

// 같은 (카테고리, 이름) 은 한 번만 알린다.
export function uniqueAuto(auto) {
  return Array.from(new Map(auto.map((a) => [`${a.categoryId}::${a.stadium}`, a])).values());
}

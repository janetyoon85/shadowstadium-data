// 종료 경기 득점자 정합성(2026-10-26 전수 점검) — 종료된 경기에서 한 팀의 득점자 수가 그 팀 스코어보다 많을 수는 없다.
// 원인 둘: ① ESPN 이 경기 후 골을 취소(VAR 등)해 지금은 득점 기록이 없는데, 병합이 "빈 값"으로 옛 득점자를 덮지 못해 0-0 인데 득점자가 남음
//          ② ESPN 원본이 같은 골을 두 번 기록(톨루카 1-1 인데 득점 이벤트 4건)
// 스코어가 정답이므로 득점자를 스코어에 맞춘다(같은 선수의 중복 기록부터, 그다음 뒤쪽 기록부터 뺀다). 스코어 이상으로 줄이거나 지어내지는 않는다.
import { carryAssists } from './espn-assists.mjs';

export function reconcileScorers(g) {
  if (!g || g.status !== 'completed' || !g.scorers) return false;
  let changed = false;
  for (const [side, score] of [['home', g.homeScore], ['away', g.awayScore]]) {
    const list = g.scorers[side];
    if (!Array.isArray(list) || !Number.isFinite(score) || list.length <= score) continue;
    const seen = new Set();
    const keep = [];
    let excess = list.length - score;
    for (const s of list) {
      const key = s.pid || s.n;
      if (seen.has(key) && excess > 0) { excess--; continue; } // 같은 선수의 중복 기록 우선 제거
      seen.add(key);
      keep.push(s);
    }
    while (keep.length > score) keep.pop(); // 그래도 남으면 뒤쪽 기록부터
    g.scorers[side] = keep;
    changed = true;
  }
  if (g.scorers && !(g.scorers.home || []).length && !(g.scorers.away || []).length) delete g.scorers;
  return changed;
}

// 크롤러 병합용 — 새로 받은 g 가 득점자 없이 0-0 으로 끝난 경기면 옛 득점자를 지운다. 스코어가 있는데 득점자만 비어 있으면 ESPN 지연일 수 있어 옛 값을 유지한다.
export function mergeGame(prev, g) {
  const merged = carryAssists(prev, { ...prev, ...g });
  if (!g.scorers && merged.scorers && merged.status === 'completed' && (merged.homeScore ?? 0) + (merged.awayScore ?? 0) === 0) delete merged.scorers;
  reconcileScorers(merged);
  return merged;
}

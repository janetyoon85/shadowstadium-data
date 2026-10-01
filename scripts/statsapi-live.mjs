// statsapi linescore(hydrate=linescore)에서 진행중 경기의 이닝/투수/타자/카운트/주자를 뽑는다.
export function inningInfoFrom(linescore) {
  const inning = linescore?.currentInning;
  const state = linescore?.inningState;
  if (!inning || !state) return undefined;
  const half = /^(Top|Middle)$/i.test(state) ? '초' : '말';
  return `${inning}회${half}`;
}

export function liveStateFrom(ls) {
  if (!ls) return undefined;
  const out = {};
  const pitcher = ls.defense?.pitcher?.fullName;
  const batter = ls.offense?.batter?.fullName;
  if (pitcher) out.pitcher = pitcher;
  if (batter) out.batter = batter;
  if (typeof ls.balls === 'number') out.ball = ls.balls;
  if (typeof ls.strikes === 'number') out.strike = ls.strikes;
  if (typeof ls.outs === 'number') out.out = ls.outs;
  out.bases = [ls.offense?.first && 1, ls.offense?.second && 2, ls.offense?.third && 3].filter(Boolean);
  return out.pitcher || out.batter ? out : undefined;
}

export function applyLive(prev, g) {
  const merged = { ...prev, ...g };
  if (g.status !== 'live') { delete merged.liveState; if (g.status === 'completed') delete merged.inningInfo; }
  else if (!g.liveState) delete merged.liveState;
  return merged;
}
export const liveChanged = (prev, g) => prev.inningInfo !== g.inningInfo || JSON.stringify(prev.liveState) !== JSON.stringify(g.liveState);

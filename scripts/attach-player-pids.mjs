// 선수 정보가 "정보를 찾을 수 없어요"로 뜨는 근본 원인 — 경기 데이터의 선수 참조(득점·카드·하이라이트·투수·어시스트 등) 중
// pid 가 없는 것(전수조사 2026-10-12: 전체 69,660건 중 약 8%)은 앱이 이름으로 위키를 뒤지는 약한 경로로만 간다.
// 같은 데이터 안에 이미 pid 로 나온 (리그·팀·이름) 정보를 모아 색인을 만들고, 색인에서 pid 가 정확히 하나로 확정되는 참조에만 붙인다
// (동명이인이 있으면 붙이지 않는다 — 틀린 선수 정보보다 빈 정보가 낫다).
// 순서: ① 같은 리그·같은 팀·같은 이름 → ② 같은 팀(리그 무관)·같은 이름 → ③ 같은 리그·팀 무관·같은 이름(투수 승패 등 팀을 모르는 참조).
export const PID_RE = /^(espn|naver|kbo:[bp]|npb|mlb|nbk|bk):?/;

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

function* refs(g) {
  for (const side of ['home', 'away']) {
    const team = g[side];
    for (const kind of ['scorers', 'cards']) for (const x of g[kind]?.[side] || []) yield { team, name: x.n, get: () => x.pid, set: (v) => { x.pid = v; } };
    for (const x of g.assists?.[side] || []) yield { team, name: x.n, get: () => x.pid, set: (v) => { x.pid = v; } };
    for (const x of g.highlights?.[side] || []) yield { team, name: x.player, get: () => x.pid, set: (v) => { x.pid = v; } };
    const sp = g[`${side}Pitcher`];
    if (sp) yield { team, name: sp, get: () => g[`${side}PitcherPid`], set: (v) => { g[`${side}PitcherPid`] = v; } };
  }
  for (const f of ['win', 'lose', 'save']) {
    if (g[`${f}Pitcher`]) yield { team: null, name: g[`${f}Pitcher`], get: () => g[`${f}PitcherPid`], set: (v) => { g[`${f}PitcherPid`] = v; } };
  }
}

function addTo(map, key, pid) {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(pid);
}

export function attachPlayerPids(games) {
  const byLgTeam = new Map(); // league|team|name
  const byTeam = new Map(); // team|name
  const byLg = new Map(); // league|name
  for (const g of games) {
    for (const r of refs(g)) {
      const pid = r.get();
      const name = norm(r.name);
      if (!pid || !name) continue;
      if (r.team) { addTo(byLgTeam, `${g.league}|${r.team}|${name}`, pid); addTo(byTeam, `${r.team}|${name}`, pid); }
      addTo(byLg, `${g.league}|${name}`, pid);
    }
  }
  const one = (set) => (set && set.size === 1 ? [...set][0] : undefined);
  let attached = 0;
  for (const g of games) {
    for (const r of refs(g)) {
      const name = norm(r.name);
      if (!name || r.get()) continue;
      const pid = (r.team && (one(byLgTeam.get(`${g.league}|${r.team}|${name}`)) ?? one(byTeam.get(`${r.team}|${name}`)))) ?? one(byLg.get(`${g.league}|${name}`));
      // 팀 정보가 있는 참조는 ③(팀 무관)로 내려가지 않는다 — 다른 팀 동명이인 방지. 팀을 모르는 참조(승·패·세이브)만 ③.
      if (!pid) continue;
      if (r.team && !one(byLgTeam.get(`${g.league}|${r.team}|${name}`)) && !one(byTeam.get(`${r.team}|${name}`))) continue;
      r.set(pid);
      attached++;
    }
  }
  return attached;
}

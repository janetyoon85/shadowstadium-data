// 선수 정보가 "정보를 찾을 수 없어요"로 뜨는 근본 원인 — 경기 데이터의 선수 참조(득점·카드·하이라이트·투수·어시스트 등) 중
// pid 가 없는 것(전수조사 2026-10-12: 전체 69,660건 중 약 8%)은 앱이 이름으로 위키를 뒤지는 약한 경로로만 간다.
// 같은 데이터 안에 이미 pid 로 나온 (리그·팀·이름) 정보를 모아 색인을 만들고, 색인에서 pid 가 정확히 하나로 확정되는 참조에만 붙인다
// (동명이인이 있으면 붙이지 않는다 — 틀린 선수 정보보다 빈 정보가 낫다).
// 순서: ① 같은 리그·같은 팀·같은 이름 → ② 같은 팀(리그 무관)·같은 이름 → ③ 같은 리그·팀 무관·같은 이름(투수 승패 등 팀을 모르는 참조).
import { NATIONAL_SENIOR_LEAGUES } from './backfill-national-pids.mjs';

export const PID_RE = /^(espn|naver|kbo:[bp]|npb|mlb|nbk|bk):?/;

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

function* refs(g) {
  for (const side of ['home', 'away']) {
    const team = g[side];
    for (const kind of ['scorers', 'cards']) for (const x of g[kind]?.[side] || []) yield { team, name: x.n, role: 'b', get: () => x.pid, set: (v) => { x.pid = v; } };
    for (const x of g.assists?.[side] || []) yield { team, name: x.n, role: 'b', get: () => x.pid, set: (v) => { x.pid = v; } };
    for (const x of g.highlights?.[side] || []) yield { team, name: x.player, role: 'b', get: () => x.pid, set: (v) => { x.pid = v; } };
    // 홀드 투수(2026-10-13 "유리베 정보 없음" — 방금 끝난 MLB 경기의 홀드 투수는 pid 확정 전이라 비어 있었다): 같은 팀·같은 이름으로 다른 경기에서 알려진 pid 로 채운다.
    for (const x of g.holds?.[side] || []) yield { team, name: x.n, role: 'p', get: () => x.pid, set: (v) => { x.pid = v; } };
    const sp = g[`${side}Pitcher`];
    if (sp) yield { team, name: sp, role: 'p', slot: side, get: () => g[`${side}PitcherPid`], set: (v) => { g[`${side}PitcherPid`] = v; } };
  }
  // 승·패·세이브 투수의 소속 팀은 점수로 알 수 있다(승·세이브=이긴 팀, 패=진 팀) — 팀을 알면 같은 팀의 다른 경기에서 확정된 pid 로 더 정확히 채운다(동명이인 위험도 줄어듦).
  const hs = g.homeScore, as = g.awayScore;
  const decided = typeof hs === 'number' && typeof as === 'number' && hs !== as;
  const winTeam = decided ? (hs > as ? g.home : g.away) : null;
  const loseTeam = decided ? (hs > as ? g.away : g.home) : null;
  for (const f of ['win', 'lose', 'save']) {
    if (g[`${f}Pitcher`]) yield { team: f === 'lose' ? loseTeam : winTeam, name: g[`${f}Pitcher`], role: 'p', get: () => g[`${f}PitcherPid`], set: (v) => { g[`${f}PitcherPid`] = v; } };
  }
}

function addTo(map, key, pid) {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(pid);
}

const LEAGUE_PREFIX = { MLB: 'mlb:', KBO: 'kbo:', NPB: 'npb:' };

export function attachPlayerPids(games, gamePids = {}, nationalLinks = {}) {
  // 리그와 pid 접두어가 안 맞는 기존 값은 오류다(MLB 경기의 npb: 야마모토, KBO·NPB 선발의 mlb: 등) — 먼저 비워서 아래 단계가 올바른 값으로 다시 채운다.
  for (const g of games) {
    const want = LEAGUE_PREFIX[g.league];
    if (!want) continue;
    for (const r of refs(g)) { const v = r.get(); if (v && !String(v).startsWith(want)) r.set(undefined); }
    if (g.liveState) {
      if (g.liveState.pitcherPid && !String(g.liveState.pitcherPid).startsWith(want)) delete g.liveState.pitcherPid;
      if (g.liveState.batterPid && !String(g.liveState.batterPid).startsWith(want)) delete g.liveState.batterPid;
    }
  }
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
      // ⓪ 경기 단위 정확 표(backfill-baseball-pids: 네이버 박스스코어 이름→코드) — 경기·이름이 유일하므로 가장 신뢰한다.
      // ⓪' 대표팀 검증 연결표(backfill-national-pids: 국적·선수단 대조를 통과한 것만) — 성인 대표팀 대회 득점·카드에만 적용.
      if (r.team && NATIONAL_SENIOR_LEAGUES.has(g.league)) {
        const lp = nationalLinks?.[`${r.team}|${name}`]?.pid;
        if (lp) { r.set(lp); attached++; continue; }
      }
      const slotPid = r.slot && gamePids?.[g.gameId]?._s?.[r.slot];
      if (slotPid) { r.set(slotPid); attached++; continue; }
      const gp = gamePids?.[g.gameId]?.[name];
      const gpid = gp && (r.role === 'p' ? (gp.p ?? gp.b) : (gp.b ?? gp.p));
      if (gpid) { r.set(gpid); attached++; continue; }
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

// 다음스포츠 → basketball/games.json(KBL·WKBL) 보강 — 네이버가 막혔을 때 농구 점수·상태를 잇는 보조 경로(2026-10-27).
// 형식 차이: 농구 경기는 { id, lg, st: scheduled|live|final, per, t(ms), h:{k,s,ls?}, a:{...} } 이고 팀 한글명은 teams.json[k].ko 에 있다.
// 원칙은 daum-fallback.mjs 와 같다 — 기존 id 유지 · 킥오프 ±10분 + 양 팀 한글명이 모두 맞는 후보가 정확히 1개일 때만 · 상태·점수 퇴행 금지 · 멱등.
// 순수 함수만(I/O 없음).
import { fromDaumGame, sameTeamKo } from './daum-fallback.mjs';

export const DAUM_BASKETBALL_LEAGUE = { KBL: 'kbl', WKBL: 'wkbl' };
const RANK = { scheduled: 0, live: 1, final: 2 };

// 다음 농구 경기 → 공통 형태(+ 쿼터 점수). 점수는 total, 쿼터는 quarter1..4 + extra.
export function fromDaumBasketball(g, nowMs = Date.now()) {
  const base = fromDaumGame(g, nowMs);
  if (!base) return null;
  const q = (s) => {
    if (!s || typeof s !== 'object') return [];
    const out = [];
    for (const k of ['quarter1', 'quarter2', 'quarter3', 'quarter4']) if (typeof s[k] === 'number') out.push(s[k]);
    if (typeof s.extra === 'number') out.push(s.extra);
    return out;
  };
  const hq = q(g.homeScore), aq = q(g.awayScore);
  return { ...base, st: base.status === 'completed' ? 'final' : base.status, homeQ: hq, awayQ: aq, hasExtra: typeof g.homeScore?.extra === 'number' || typeof g.awayScore?.extra === 'number' };
}

// 진행 단계 문구 — 네이버 표기('4쿼터' 등)에 맞춘다. 진행 중에는 채워진 쿼터 수로 추정(다음의 periodType 값은 농구 진행 경기에서 아직 미확인).
export function periodLabel(m) {
  if (m.st === 'final') return m.hasExtra ? '연장' : '4쿼터';
  if (m.st === 'live') {
    const n = Math.max(m.homeQ.length, m.awayQ.length);
    if (m.hasExtra) return '연장';
    return n >= 1 ? `${Math.min(n, 4)}쿼터` : '';
  }
  return '';
}

export function buildBasketballPatch(game, m) {
  const patch = {};
  if (!m || m.st === 'skip') return patch;
  const cur = RANK[game.st] ?? -1, next = RANK[m.st] ?? -1;
  if (next < cur) return patch; // 상태 퇴행 금지
  if (next > cur) patch.st = m.st;
  if (m.st === 'live' || m.st === 'final') {
    for (const [side, v] of [['h', m.homeScore], ['a', m.awayScore]]) {
      if (typeof v !== 'number') continue;
      const old = typeof game[side]?.s === 'number' ? game[side].s : 0;
      if (v > old) patch[side] = { ...game[side], s: v };
    }
    const per = periodLabel(m);
    // 단계 문구는 상태가 올라가거나(예정→진행/종료) 진행 중 단계가 앞서갈 때만 — 이미 더 최신인 네이버 값을 되돌리지 않는다.
    if (per && per !== game.per && (patch.st || (game.st === 'live' && String(per) > String(game.per || '')))) patch.per = per;
  }
  return patch;
}

// bkGames: basketball/games.json 의 games 배열. teams: teams.json(키→{ko}). 반환: { games, changes }
export function applyDaumBasketball(bkGames, candsByLeague, teams, nowMs = Date.now(), { hoursBefore = 6, hoursAfter = 36 } = {}) {
  const changes = [];
  const out = bkGames.map((g) => {
    const cands = candsByLeague[g.lg];
    if (!cands || !g.id || !g.h?.k || !g.a?.k) return g;
    if (g.st === 'final') return g;
    const t = g.t;
    if (!Number.isFinite(t) || t - nowMs > hoursBefore * 3600e3 || nowMs - t > hoursAfter * 3600e3) return g;
    const hk = teams[g.h.k]?.ko, ak = teams[g.a.k]?.ko;
    if (!hk || !ak) return g;
    const hits = cands.filter((c) => Math.abs(c.kickoff - t) <= 10 * 60e3
      && (sameTeamKo(hk, c.homeShort) || sameTeamKo(hk, c.home))
      && (sameTeamKo(ak, c.awayShort) || sameTeamKo(ak, c.away)));
    if (hits.length !== 1) return g;
    const patch = buildBasketballPatch(g, hits[0]);
    if (!Object.keys(patch).length) return g;
    changes.push({ id: g.id, lg: g.lg, patch, via: `daum:${hits[0].id}` });
    return { ...g, ...patch };
  });
  return { games: out, changes };
}

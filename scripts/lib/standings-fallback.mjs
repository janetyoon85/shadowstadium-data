// 순위표 보조 갱신 — 네이버(fetch-standings)가 막힌 동안 K리그1·2 순위를 다음스포츠(/api/arms/SPORTS_TEAM_RANK)로 잇는다(2026-10-27).
// 안전 원칙: (1) 순위표가 "뒤처졌을 때"만 갱신(완료 경기 수 > 순위표 경기 수 합/2) — 평소엔 요청 0건
//            (2) 모든 팀이 1:1 로 이름 매칭될 때만 적용(하나라도 안 맞으면 건드리지 않음) (3) 기존 group(파이널 그룹)은 보존하고 그룹 경계 안에서 순위를 매긴다
//            (4) 숫자 필드만 갱신(played·win·loss·draw·pts·gd, rank) — 새 필드를 만들지 않는다. 순수 함수만(I/O 없음).
import { sameTeamKo, normKo } from './daum-fallback.mjs';

export const DAUM_STANDINGS_LEAGUE = { 'K리그1': 'KL', 'K리그2': 'KL2' };

// 우리 순위표(rows) 경기 수 합 /2 가 완료 경기 수보다 작으면 뒤처짐.
export function isStale(rows, completedCount) {
  const played = (rows || []).reduce((n, r) => n + (Number(r.played) || 0), 0);
  return completedCount * 2 > played;
}

// 다음 SPORTS_TEAM_RANK 의 list[] → 공통 행. rank 객체: {rank, game, win, draw, loss, gf, ga, gd, pts}
export function fromDaumRank(list) {
  return (list || []).map((t) => {
    const r = t.rank || {};
    return { team: t.shortNameKo || t.nameKo || '', teamFull: t.nameKo || '', rank: r.rank, played: r.game, win: r.win, draw: r.draw, loss: r.loss, pts: r.pts, gd: r.gd };
  }).filter((x) => x.team && Number.isFinite(x.rank) && Number.isFinite(x.played));
}

// oldRows(우리) 와 newRows(다음)를 1:1 매칭해 갱신된 rows 를 돌려준다. 실패 시 { ok:false, reason }.
export function mergeStandings(oldRows, newRows) {
  if (!Array.isArray(oldRows) || !oldRows.length) return { ok: false, reason: '기존 순위표 없음' };
  if (oldRows.length !== newRows.length) return { ok: false, reason: `팀 수 불일치(${oldRows.length} vs ${newRows.length})` };
  const used = new Set();
  const pairs = [];
  for (const o of oldRows) {
    // 정확 일치 우선(수원 vs 수원FC 처럼 한쪽이 다른 쪽에 포함되는 팀 구분), 없으면 부분 일치.
    let hits = newRows.filter((n, i) => !used.has(i) && (normKo(o.team) === normKo(n.team) || normKo(o.team) === normKo(n.teamFull)));
    if (!hits.length) hits = newRows.filter((n, i) => !used.has(i) && (sameTeamKo(o.team, n.team) || sameTeamKo(o.team, n.teamFull)));
    if (hits.length !== 1) return { ok: false, reason: `팀 매칭 실패(${o.team}: ${hits.length}건)` };
    used.add(newRows.indexOf(hits[0]));
    pairs.push([o, hits[0]]);
  }
  // 경기 수가 줄어든 팀이 있으면 오래된 값 — 적용 안 함(앞으로만).
  if (pairs.some(([o, n]) => n.played < o.played)) return { ok: false, reason: '다음 쪽이 더 오래된 값' };
  let changed = false;
  let rows = pairs.map(([o, n]) => {
    const next = { ...o, played: n.played, win: n.win, loss: n.loss, draw: n.draw, pts: n.pts, gd: n.gd, _r: n.rank };
    for (const k of ['played', 'win', 'loss', 'draw', 'pts', 'gd']) if (next[k] !== o[k]) changed = true;
    return next;
  });
  // 순위: 그룹이 있으면 그룹(기존 순서) 경계 안에서 다음의 순위 순으로, 없으면 다음 순위 그대로.
  const groupOrder = [...new Set(oldRows.map((r) => r.group).filter(Boolean))];
  rows.sort((a, b) => (groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group)) || (a._r - b._r));
  rows = rows.map((r, i) => { const { _r, ...rest } = r; const rank = i + 1; if (rank !== oldRows.find((o) => o.team === r.team)?.rank) changed = true; return { ...rest, rank }; });
  return { ok: true, rows, changed };
}

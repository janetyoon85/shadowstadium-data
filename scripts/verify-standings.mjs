// 순위표 ↔ 경기 결과 정합 점검 — 독립 원본이 없는 리그(KBO·NPB·K리그·MLB)에서, 같은 제공처의 "순위표"와 우리 "경기 결과"가 서로 맞는지 본다.
// 순위표의 팀별 경기수·승·무·패를 우리 경기 목록(정규시즌 종료 경기)으로 다시 세어 비교해서, 경기 누락·점수 오기·중복 등록을 잡는다(제공처 오류 자체는 못 잡음).
// 포스트시즌/플레이오프 경기는 round 필드(ps_*)가 붙어 제외한다. 시범경기는 날짜가 앞서서 "팀별 최근 N경기(N=순위표 경기수)"만 보면 자연히 빠지고,
// 우리 쪽에 경기가 빠져 있으면 그 자리를 시범경기가 채워 승패가 어긋나므로 누락도 잡힌다.

// games: games.json 배열, entry: standings.json[league] ({ updatedAt, rows:[{team,played,win,loss,draw}] }) → [{ key, kind, text }]
export function compareStandings(games, league, entry, { nowMs = Date.now(), lagMs = 3 * 3600e3 } = {}) {
  const out = [];
  const rows = entry?.rows;
  if (!Array.isArray(rows) || !rows.length) return out;
  const mine = games.filter((g) => g.league === league && g.status === 'completed' && !g.round && Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore));
  if (!mine.length) return out;
  // 순위표가 마지막 경기 반영보다 오래됐으면(제공처 지연) 비교하지 않는다
  const upd = Date.parse(entry.updatedAt || '');
  const lastTs = Math.max(...mine.map((g) => Date.parse(`${g.date}T${/^\d\d:\d\d$/.test(g.time) ? g.time : '12:00'}:00Z`) - 9 * 3600e3));
  if (Number.isFinite(upd) && upd < lastTs + lagMs && nowMs - lastTs < 24 * 3600e3) return out;
  const teams = new Set(rows.map((r) => r.team));
  const per = new Map();
  for (const g of mine) for (const [t, own, opp] of [[g.home, g.homeScore, g.awayScore], [g.away, g.awayScore, g.homeScore]]) {
    if (!teams.has(t)) continue;
    (per.get(t) ?? per.set(t, []).get(t)).push({ d: `${g.date} ${g.time || ''}`, r: own > opp ? 'w' : own < opp ? 'l' : 'd' });
  }
  for (const r of rows) {
    const list = (per.get(r.team) || []).sort((a, b) => (a.d < b.d ? -1 : 1));
    const last = list.slice(-r.played);
    const c = { w: 0, l: 0, d: 0 };
    for (const x of last) c[x.r]++;
    const have = list.length;
    const same = last.length === r.played && c.w === r.win && c.l === r.loss && c.d === (r.draw || 0);
    if (!same) out.push({ key: `${league}|${r.team}`, kind: '순위표↔경기결과 불일치', text: `${league} ${r.team} — 순위표 ${r.played}경기 ${r.win}승 ${r.draw || 0}무 ${r.loss}패 / 우리 경기 기록 ${last.length}경기 ${c.w}승 ${c.d}무 ${c.l}패(보유 ${have}경기)` });
  }
  return out;
}

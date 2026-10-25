// NBA 는 네이버와 ESPN 이 둘 다 같은 경기를 내려줘서(2026-10-21 시즌 개막부터) 홈 목록에 같은 경기가 두 장씩 보였다(2026-10-25, "유타경기가 왜 2개지?").
// 같은 경기 = 같은 리그·같은 날짜·두 팀(약어 정규화)이 같은 것. 중복이면 구장·박스스코어가 정확한 ESPN 쪽을 남기고 네이버 쪽을 지운다. 팀 한글명 매핑은 teams.json 의 네이버 팀 항목이 계속 담당하므로 그대로 둔다.
const ABBR = { UTAH: 'UTA', PHX: 'PHO', WSH: 'WAS', NOP: 'NO', GSW: 'GS', SAS: 'SA', NYK: 'NY' };
export const norm = (a) => ABBR[a] || a;
const pairKey = (g, teams) => {
  const a = teams[g.h?.k]?.abbr, b = teams[g.a?.k]?.abbr;
  if (!a || !b) return null;
  return `${g.lg}|${g.date}|${[norm(a), norm(b)].sort().join('~')}`;
};

// 같은 NBA 경기를 네이버와 ESPN 이 각각 주므로 서로 독립인 두 소스다 — 중복을 지우기 "전에" 둘을 비교해 불일치(스코어·상태·킥오프 시각)를 돌려준다(2026-10-26 원본 대조).
// 홈/원정 정의가 같은 두 소스라 팀 약어로 맞춰서 비교한다. 불일치가 없으면 빈 배열.
export function crossCheckNaverVsEspnNba(byId, teams) {
  const espn = new Map();
  for (const g of byId.values()) if (g.src === 'espn' && g.lg === 'NBA') { const k = pairKey(g, teams); if (k) espn.set(k, g); }
  const out = [];
  for (const g of byId.values()) {
    if (g.src !== 'naver' || g.lg !== 'NBA') continue;
    const k = pairKey(g, teams);
    const e = k && espn.get(k);
    if (!e) continue;
    const sideScore = (game, abbr) => (norm(teams[game.h.k]?.abbr) === abbr ? game.h.s : norm(teams[game.a.k]?.abbr) === abbr ? game.a.s : undefined);
    const name = `${g.date} NBA ${teams[g.h.k]?.abbr}-${teams[g.a.k]?.abbr}`;
    if (Math.abs((g.t ?? 0) - (e.t ?? 0)) > 45 * 60e3 && g.st === 'scheduled' && e.st === 'scheduled') out.push({ id: `${g.id}|${e.id}`, kind: '농구 킥오프 불일치(네이버/ESPN)', text: `${name} — 네이버 ${new Date(g.t + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} / ESPN ${new Date(e.t + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} (KST)` });
    if (g.st === 'final' && e.st === 'final') {
      const hAbbr = norm(teams[g.h.k]?.abbr), aAbbr = norm(teams[g.a.k]?.abbr);
      if (sideScore(g, hAbbr) !== sideScore(e, hAbbr) || sideScore(g, aAbbr) !== sideScore(e, aAbbr)) out.push({ id: `${g.id}|${e.id}`, kind: '농구 스코어 불일치(네이버/ESPN)', text: `${name} — 네이버 ${g.h.s}-${g.a.s} / ESPN ${sideScore(e, hAbbr)}-${sideScore(e, aAbbr)}` });
    } else if ((g.st === 'final') !== (e.st === 'final') && Date.now() - Math.min(g.t, e.t) > 5 * 3600e3) {
      out.push({ id: `${g.id}|${e.id}`, kind: '농구 종료 상태 불일치(네이버/ESPN)', text: `${name} — 네이버 ${g.st} / ESPN ${e.st}` });
    }
  }
  return out;
}

// byId: Map<id, game> — 지운 네이버 NBA 경기 수를 돌려준다.
export function dropDuplicateNaverNba(byId, teams) {
  const espn = new Set();
  for (const g of byId.values()) {
    if (g.src !== 'espn' || g.lg !== 'NBA') continue;
    const k = pairKey(g, teams);
    if (k) espn.add(k);
  }
  let dropped = 0;
  for (const [id, g] of [...byId]) {
    if (g.src !== 'naver' || g.lg !== 'NBA') continue;
    const k = pairKey(g, teams);
    if (k && espn.has(k)) { byId.delete(id); dropped++; }
  }
  return dropped;
}

// NBA 는 네이버와 ESPN 이 둘 다 같은 경기를 내려줘서(2026-10-21 시즌 개막부터) 홈 목록에 같은 경기가 두 장씩 보였다(2026-10-25, "유타경기가 왜 2개지?").
// 같은 경기 = 같은 리그·같은 날짜·두 팀(약어 정규화)이 같은 것. 중복이면 구장·박스스코어가 정확한 ESPN 쪽을 남기고 네이버 쪽을 지운다. 팀 한글명 매핑은 teams.json 의 네이버 팀 항목이 계속 담당하므로 그대로 둔다.
const ABBR = { UTAH: 'UTA', PHX: 'PHO', WSH: 'WAS', NOP: 'NO', GSW: 'GS', SAS: 'SA', NYK: 'NY' };
const norm = (a) => ABBR[a] || a;
const pairKey = (g, teams) => {
  const a = teams[g.h?.k]?.abbr, b = teams[g.a?.k]?.abbr;
  if (!a || !b) return null;
  return `${g.lg}|${g.date}|${[norm(a), norm(b)].sort().join('~')}`;
};

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

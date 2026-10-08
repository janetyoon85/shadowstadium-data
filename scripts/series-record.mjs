// 포스트시즌 시리즈 전적 — "이 경기 직전까지" 각 팀의 시리즈 승수(serH/serA).
// 사용자 요청(2026-10-08): "시리즈 3차전이면 2차전까지 승패도 표기" → 3차전 카드에 "LG 2-0".
//
// 입력: round(+rn)가 이미 붙은 경기 배열(fetch-schedule.mjs의 assignSeriesNum 이후, 또는
// MLB StatsAPI 크롤러가 round/rn을 직접 채운 뒤). 출력: 해당 경기에 serH/serA 정수 필드를 붙이고,
// 계산할 수 없으면 기존 값까지 지운다(스테일 방지 — 재호출해도 같은 결과, 멱등).
//
// 보수적 규칙(틀린 전적을 보여주느니 안 보여준다):
//  - 시리즈 첫 경기(i=0)는 0-0이라 의미 없어 생략.
//  - rn !== 그룹 내 순번(i+1)이면 앞 경기가 수집 범위 밖에 있다는 뜻이라 생략.
//  - 앞선 경기 중 하나라도 completed+정수 스코어가 아니면(예정/연기/중단) 생략.
//  - 무승부(KBO/NPB 포스트시즌 무승부)는 어느 팀 승수에도 안 넣음.
// 시리즈 구분: 같은 리그+라운드+두 팀, 단 경기 사이 간격이 GAP_DAYS를 넘으면 별개 시리즈.

const GAP_DAYS = 14;

function dayNum(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

export function assignSeriesRecord(games) {
  const groups = new Map();
  for (const g of games) {
    if (!g.round || g.status === 'cancelled') continue;
    const key = `${g.league}|${g.round}|${[g.home, g.away].sort().join('|')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  for (const grp of groups.values()) {
    grp.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    // 간격이 큰 곳에서 시리즈를 끊는다 (같은 대진이 다른 시즌/다른 시리즈로 다시 나오는 경우).
    const series = [];
    for (const g of grp) {
      const cur = series[series.length - 1];
      if (cur && dayNum(g.date) - dayNum(cur[cur.length - 1].date) <= GAP_DAYS) cur.push(g);
      else series.push([g]);
    }
    for (const s of series) {
      const wins = new Map();
      let known = true; // 지금까지의 모든 경기 결과를 알고 있는가
      s.forEach((g, i) => {
        delete g.serH;
        delete g.serA;
        if (i > 0 && known && g.rn === i + 1) {
          g.serH = wins.get(g.home) || 0;
          g.serA = wins.get(g.away) || 0;
        }
        const done = g.status === 'completed' && Number.isInteger(g.homeScore) && Number.isInteger(g.awayScore);
        if (!done) {
          known = false;
          return;
        }
        if (g.homeScore > g.awayScore) wins.set(g.home, (wins.get(g.home) || 0) + 1);
        else if (g.awayScore > g.homeScore) wins.set(g.away, (wins.get(g.away) || 0) + 1);
      });
    }
  }
  return games;
}

// 2차전 카드에 붙일 "1차전 결과" — 합계(aggregateScore)는 2차전이 시작돼야 생기므로, 경기 전에는
// 같은 대진의 1차전 스코어를 직접 찾아 l1H/l1A(이 2차전의 홈/원정 팀이 1차전에서 넣은 골)로 싣는다.
// 보수적 규칙: 같은 리그+단계+두 팀의 1차전이 2차전보다 먼저, LEG_GAP_DAYS 이내에 있고 종료+정수 스코어일 때만.
// 못 찾으면 기존 값까지 지운다(멱등).
const LEG_GAP_DAYS = 60;

export function assignLegOneResult(games) {
  const groups = new Map();
  for (const g of games) {
    if ((g.leg !== 1 && g.leg !== 2) || g.status === 'cancelled') continue;
    const key = `${g.league}|${g.phaseCode || ''}|${[g.home, g.away].sort().join('|')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  for (const grp of groups.values()) {
    for (const g2 of grp) {
      if (g2.leg !== 2) continue;
      delete g2.l1H;
      delete g2.l1A;
      const cands = grp.filter((x) => x.leg === 1 && x.date <= g2.date && dayNum(g2.date) - dayNum(x.date) <= LEG_GAP_DAYS);
      if (!cands.length) continue;
      cands.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const g1 = cands[cands.length - 1];
      if (g1.status !== 'completed' || !Number.isInteger(g1.homeScore) || !Number.isInteger(g1.awayScore)) continue;
      const goals = new Map([[g1.home, g1.homeScore], [g1.away, g1.awayScore]]);
      g2.l1H = goals.get(g2.home);
      g2.l1A = goals.get(g2.away);
    }
  }
  return games;
}

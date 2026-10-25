// 선수 이벤트(득점·도움·카드, MLB 투수 기록) 원본 대조용 순수 비교 함수(2026-10-26, "득점 도움 카드 모든 종목 모든 경기 모든 선수 이벤트 다").
// verify-against-source.mjs 가 원본(ESPN 경기 요약·MLB StatsAPI·네이버 경기 기록)을 받아 이 함수들에 넘기고, 결과를 알림 규칙(연속 2회·24시간 1회)에 태운다.
const minuteOf = (e) => { const n = parseInt((e.clock && e.clock.displayValue) || '', 10); return Number.isFinite(n) ? n : null; };
const espnId = (pid) => String(pid || '').startsWith('espn:') ? String(pid).slice(5) : null;

// ESPN summary → 정규화 이벤트 { goals:[{m,side,sid,aid,aname,og,pk}], cards:[{m,side,pid,type}], home/away teamId, goalTotal, scoreTotal }
export function parseEspnEvents(j) {
  const c = j.header?.competitions?.[0];
  const homeC = c?.competitors?.find((x) => x.homeAway === 'home'), awayC = c?.competitors?.find((x) => x.homeAway === 'away');
  const sideOf = (teamId) => (String(teamId) === String(homeC?.team?.id) ? 'home' : String(teamId) === String(awayC?.team?.id) ? 'away' : null);
  const goals = [], cards = [];
  for (const e of j.keyEvents || []) {
    const typeText = e.type?.text || '';
    if (e.scoringPlay === true && !e.shootout && !/shootout/i.test(typeText)) {
      const og = /own goal/i.test(typeText);
      goals.push({ m: minuteOf(e), side: sideOf(e.team?.id), sid: String(e.participants?.[0]?.athlete?.id ?? ''), aid: og ? '' : String(e.participants?.[1]?.athlete?.id ?? ''), aname: og ? '' : (/Assisted by ([^.]+?)(?:\s+with\s|\s+following\s|\s+after\s|\.|$)/.exec(e.text || '') || [])[1]?.trim() || '', og, pk: /penalty/i.test(typeText) });
    } else if (/yellow card|red card|second yellow/i.test(typeText)) {
      cards.push({ m: minuteOf(e), side: sideOf(e.team?.id), pid: String(e.participants?.[0]?.athlete?.id ?? ''), type: /red|second yellow/i.test(typeText) ? 'R' : 'Y' });
    }
  }
  const scoreTotal = (Number.parseInt(homeC?.score, 10) || 0) + (Number.parseInt(awayC?.score, 10) || 0);
  return { goals, cards, goalTotal: goals.length, scoreTotal, ok: !!(homeC && awayC) };
}

// ours: games.json 경기, ev: parseEspnEvents 결과. tol: 분 허용 오차(ESPN 출처는 같은 원본이라 1, 네이버 출처에 ESPN pid 를 시간순으로 붙인 경기는 3)
export function compareSoccerEvents(ours, ev, { tol = 1 } = {}) {
  const out = [];
  if (!ev.ok || ev.goalTotal !== ev.scoreTotal) return { items: out, skipped: 'espn-unreliable' }; // ESPN 이벤트 수가 최종 스코어와 안 맞으면(같은 골 중복 기록 등) 원본이 불안정해 건너뛴다
  const label = `${ours.date} ${ours.league} ${ours.home} vs ${ours.away}`;
  const near = (a, b) => a == null || b == null || Math.abs(a - b) <= tol;
  // ── 득점 ──
  if (ours.scorers) {
    const oursGoals = [];
    for (const side of ['home', 'away']) for (const s of ours.scorers[side] || []) oursGoals.push({ ...s, side });
    const used = new Set();
    for (const g of ev.goals) {
      const i = oursGoals.findIndex((s, k) => !used.has(k) && near(s.m, g.m) && ((espnId(s.pid) && espnId(s.pid) === g.sid) || !espnId(s.pid)));
      if (i < 0) { out.push({ kind: '득점 누락', key: `g|${g.m}|${g.sid}`, text: `${label} — ESPN ${g.m}' ${g.og ? '(자책골) ' : ''}선수 ${g.sid} 득점이 우리 데이터에 없음` }); continue; }
      used.add(i);
      const s = oursGoals[i];
      // ── 도움 ──
      if (g.aid && !g.og) {
        if (!s.a && !s.apid) out.push({ kind: '도움 누락', key: `a|${g.m}|${g.aid}`, text: `${label} — ${g.m}' 득점의 도움(${g.aname || g.aid})이 우리 데이터에 없음` });
        else if (espnId(s.apid) && espnId(s.apid) !== g.aid) out.push({ kind: '도움 불일치', key: `a|${g.m}|${g.aid}`, text: `${label} — ${g.m}' 도움 우리 ${s.a || s.apid} / ESPN ${g.aname || g.aid}` });
      } else if (s.a && !g.aid && !g.og) out.push({ kind: '도움 불일치', key: `a|${g.m}|none`, text: `${label} — ${g.m}' 도움 우리 ${s.a} / ESPN 도움 없음` });
    }
    oursGoals.forEach((s, k) => { if (!used.has(k)) out.push({ kind: '득점 불일치', key: `x|${s.m}|${s.pid || s.n}`, text: `${label} — 우리 ${s.m}' ${s.n}(${s.side}) 득점이 ESPN 에 없음` }); });
  }
  // ── 카드 ──
  if (ours.cards) {
    const oursCards = [];
    for (const side of ['home', 'away']) for (const c of ours.cards[side] || []) oursCards.push({ ...c, side });
    const used = new Set();
    for (const c of ev.cards) {
      const i = oursCards.findIndex((o, k) => !used.has(k) && o.type === c.type && near(o.m, c.m) && ((espnId(o.pid) && espnId(o.pid) === c.pid) || !espnId(o.pid)));
      if (i < 0) out.push({ kind: '카드 누락', key: `c|${c.type}|${c.m}|${c.pid}`, text: `${label} — ESPN ${c.m}' ${c.type === 'R' ? '퇴장' : '경고'}(선수 ${c.pid})이 우리 데이터에 없음` });
      else used.add(i);
    }
    oursCards.forEach((o, k) => { if (!used.has(k) && espnId(o.pid)) out.push({ kind: '카드 불일치', key: `x|${o.type}|${o.m}|${o.pid}`, text: `${label} — 우리 ${o.m}' ${o.type === 'R' ? '퇴장' : '경고'} ${o.n} 이 ESPN 에 없음` }); });
  }
  return { items: out };
}

// MLB: statsapi decisions(winner/loser/save) vs 우리 winPitcherPid/losePitcherPid/savePitcherPid('mlb:<id>')
export function compareMlbDecisions(ours, decisions) {
  const out = [];
  if (!decisions) return out;
  const label = `${ours.date} MLB ${ours.home} vs ${ours.away}`;
  const chk = (role, ourPid, official) => {
    const id = official?.id ? `mlb:${official.id}` : null;
    if (id && !ourPid) out.push({ kind: `${role} 투수 누락`, key: `d|${role}`, text: `${label} — ${role} 투수 ${official.fullName}(공식)가 우리 데이터에 없음` });
    else if (id && ourPid && ourPid !== id) out.push({ kind: `${role} 투수 불일치`, key: `d|${role}`, text: `${label} — ${role} 투수 우리 ${ourPid} / 공식 ${official.fullName}(${id})` });
  };
  chk('승리', ours.winPitcherPid, decisions.winner);
  chk('패전', ours.losePitcherPid, decisions.loser);
  if (decisions.save) chk('세이브', ours.savePitcherPid, decisions.save);
  return out;
}

// 네이버 /record timeline(K리그 등) vs 우리 득점·카드 — 같은 제공처의 "새로 받은" 값과 비교해 우리 크롤러의 누락·오류를 잡는다. 이름은 한글 원문 그대로.
export function compareNaverTimeline(ours, timeline) {
  const out = [];
  const label = `${ours.date} ${ours.league} ${ours.home} vs ${ours.away}`;
  const goalsN = { home: [], away: [] }, cardsN = { home: [], away: [] };
  // 시간은 "14'" 또는 추가시간 "+6"(분 불명) — 숫자로 시작할 때만 분으로 쓴다.
  const minute = (t) => { const m = /^(\d+)/.exec(String(t || '')); return m ? Number(m[1]) : null; };
  for (const t of timeline || []) {
    const m = minute(t.time); const name = (t.text || '').replace(/\s*(골|자책골|경고|퇴장|PK골|페널티골).*$/, '').trim();
    if (t.eventType === 'goal' || t.eventType === 'penaltyGoal') goalsN[t.side]?.push({ m, name });
    else if (t.eventType === 'ownGoal') goalsN[t.side]?.push({ m, name, og: true }); // 네이버 타임라인의 자책골 side 는 "득점 수혜팀"(우리 데이터와 같은 관례) — 2026-10-26 K리그2 두 경기로 확인
    else if (t.eventType === 'yellow') cardsN[t.side]?.push({ m, name });
    else if (t.eventType === 'red' || t.eventType === 'dismissal') cardsN[t.side]?.push({ m, name }); // 퇴장은 네이버가 dismissal 로 준다(2026-10-26 실측)
    // secondYellow 는 같은 선수의 두 번째 경고(퇴장)라 yellow 이벤트와 함께 이미 한 장으로 세는 쪽이 우리 기록과 같다 — 개수 비교에서 제외
  }
  const cmp = (kind, ourList, theirs, getOurs) => {
    if (!ourList) return;
    for (const side of ['home', 'away']) {
      const o = (ourList[side] || []).map(getOurs), n = theirs[side];
      if (kind === '카드') {
        // 카드는 퇴장(2번째 경고)이 우리 쪽에서 한 장/두 장으로 달리 기록될 수 있어 선수 이름 집합만 비교한다.
        const on = new Set(o.map((x) => x.name)), nn = new Set(n.map((x) => x.name));
        for (const x of nn) if (!on.has(x)) out.push({ kind: '카드 누락(네이버)', key: `카드|${side}|${x}`, text: `${label} — 네이버에는 ${x} 카드가 있는데 우리 데이터에 없음` });
        for (const x of on) if (!nn.has(x)) out.push({ kind: '카드 불일치(네이버)', key: `카드|${side}|${x}|extra`, text: `${label} — 우리 데이터에만 ${x} 카드가 있음` });
        continue;
      }
      if (o.length !== n.length) { out.push({ kind: `${kind} 개수 불일치(네이버)`, key: `${kind}|${side}`, text: `${label} — ${side === 'home' ? ours.home : ours.away} ${kind} 우리 ${o.length}건 / 네이버 ${n.length}건` }); continue; }
      for (const x of n) if (!o.some((y) => y.name === x.name && (y.m == null || x.m == null || Math.abs(y.m - x.m) <= 2))) out.push({ kind: `${kind} 선수·분 불일치(네이버)`, key: `${kind}|${side}|${x.name}|${x.m}`, text: `${label} — 네이버 ${x.m ?? '?'}' ${x.name} ${kind} 이 우리 데이터와 다름` });
    }
  };
  if (ours.scorers) cmp('득점', ours.scorers, goalsN, (s) => ({ name: s.n, m: s.m }));
  if (ours.cards) cmp('카드', ours.cards, cardsN, (c) => ({ name: c.n, m: c.m }));
  return out;
}

// 야구(KBO·NPB·MLB): 네이버 /record 의 타자별 기록(battersBoxscore: name·hr·sb)을 새로 받아 우리 하이라이트의 홈런·도루와 선수 단위로 비교한다.
// 우리 홈런 항목은 "나성범1호2호(…)"처럼 한 항목에 여러 개가 들어올 수 있어 "N호" 개수로 센다. 도루는 항목 하나가 한 개.
export function compareNaverBatters(ours, battersBoxscore) { // battersBoxscore: KBO 는 recordData.battersBoxscore, NPB·MLB 는 { home: recordData.homeBatter, away: recordData.awayBatter }
  const out = [];
  if (!ours.highlights || !battersBoxscore) return out;
  const label = `${ours.date} ${ours.league} ${ours.home} vs ${ours.away}`;
  for (const side of ['home', 'away']) {
    const rows = battersBoxscore[side] || battersBoxscore[side + 'Batter']; // KBO: battersBoxscore.home/away, NPB·MLB: recordData.homeBatter/awayBatter
    if (!Array.isArray(rows)) continue;
    const hrN = {}, sbN = {}, hrO = {}, sbO = {};
    for (const b of rows) { if (b.name) { if (b.hr) hrN[b.name] = (hrN[b.name] || 0) + b.hr; if (b.sb) sbN[b.name] = (sbN[b.name] || 0) + b.sb; } }
    for (const h of ours.highlights[side] || []) {
      const cnt = (String(h.text).match(/(\d+)개/) || [])[1]; // NPB·MLB 표기: "미모리 2개"
      if (h.how === '홈런') hrO[h.player] = (hrO[h.player] || 0) + (cnt ? Number(cnt) : Math.max(1, (String(h.text).match(/\d+호/g) || []).length));
      else if (h.how === '도루') sbO[h.player] = (sbO[h.player] || 0) + (cnt ? Number(cnt) : 1);
    }
    const cmp = (kind, n, o) => { for (const name of new Set([...Object.keys(n), ...Object.keys(o)])) if ((n[name] || 0) !== (o[name] || 0)) out.push({ kind: `${kind} 불일치(네이버 기록)`, key: `${kind}|${side}|${name}`, text: `${label} — ${name} ${kind} 우리 ${o[name] || 0} / 네이버 기록 ${n[name] || 0}` }); };
    cmp('홈런', hrN, hrO); cmp('도루', sbN, sbO);
  }
  return out;
}

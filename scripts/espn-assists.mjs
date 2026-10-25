// ESPN 출처 리그(포르투갈·아르헨티나·브라질·리가MX·노르웨이·터키·벨기에 …) 어시스트 부착(2026-10-26, 사용자 "송민규 어시스트 맞아?").
// ESPN 요약(summary.keyEvents)에는 "… Assisted by Song Min-Kyu." 가 있는데, 이 크롤러들은 득점자만 붙이고 어시스트는 붙이지 않아 이 리그들의 어시스트가 0%였다(EPL 등 네이버 경기는 fetch-schedule 이 붙임).
// 종료된 경기마다 summary 를 한 번만 조회해(assistsChecked 표시) scorers[].a / apid / aNat 를 채운다. 무도움 골은 a 없이 두고, 그 경기도 다시 조회하지 않는다.
import { getAthleteNationality } from './espn-nationality.mjs';

const ASSIST_KEYS = ['a', 'apid', 'aNat'];

export function parseAssistFromText(text) {
  const m = /Assisted by ([^.]+?)(?:\s+with\s|\s+following\s|\s+after\s|\.|$)/.exec(text || '');
  return m ? m[1].trim() : null;
}

// 득점자 배열 비교에서 어시스트 필드는 무시(어시스트를 붙인 뒤에도 "변경 없음"으로 봐야 매 실행 덮어쓰기·재조회 루프가 안 생긴다).
export function sameScorers(a, b) {
  const strip = (v) => JSON.stringify(v ?? null, (k, x) => (ASSIST_KEYS.includes(k) ? undefined : x));
  return strip(a) === strip(b);
}

// 크롤러가 새로 만든 game 객체(g)로 덮어쓸 때 이전 어시스트를 같은 골(선수 id+분)에 이어 붙인다. 골 구성이 달라졌으면 assistsChecked 를 해제해 다시 조회한다.
export function carryAssists(prev, g) {
  if (!prev?.scorers || !g?.scorers) { delete g.assistsChecked; return g; }
  let allMatched = true;
  for (const side of ['home', 'away']) {
    const old = prev.scorers[side] || [];
    for (const s of g.scorers[side] || []) {
      const o = old.find((x) => x.pid === s.pid && x.m === s.m && x.n === s.n);
      if (!o) { allMatched = false; continue; }
      for (const k of ASSIST_KEYS) if (o[k] !== undefined && s[k] === undefined) s[k] = o[k];
    }
    if ((g.scorers[side] || []).length !== old.length) allMatched = false;
  }
  if (prev.assistsChecked && allMatched) g.assistsChecked = true; else delete g.assistsChecked;
  return g;
}

const minuteOf = (e) => { const n = parseInt((e.clock && e.clock.displayValue) || '', 10); return Number.isFinite(n) ? n : null; };

// slug: ESPN 리그 슬러그(game.gameId 가 `<CODE>_ESPN_<eventId>`). 반환: 새로 붙인 어시스트 수(-1 = 조회 실패)
export async function attachAssists(game, slug) {
  const eventId = String(game.gameId).split('_ESPN_')[1];
  if (!eventId) return 0;
  let j;
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return -1;
    j = await res.json();
  } catch { return -1; }
  const events = (j.keyEvents || []).filter((e) => e.scoringPlay === true && !/own goal/i.test((e.type && e.type.text) || ''));
  let n = 0;
  for (const side of ['home', 'away']) {
    for (const s of game.scorers?.[side] || []) {
      if (s.og || s.a) continue;
      const sid = String(s.pid || '').replace(/^espn:/, '');
      const e = events.find((x) => sid && String(x.participants?.[0]?.athlete?.id) === sid && (s.m == null || minuteOf(x) === s.m))
        || events.find((x) => s.m != null && minuteOf(x) === s.m && (x.participants?.[0]?.athlete?.displayName || '') === s.n);
      if (!e) continue;
      const name = parseAssistFromText(e.text);
      if (!name) continue;
      s.a = name;
      const aid = e.participants?.[1]?.athlete?.id;
      if (aid) {
        s.apid = `espn:${aid}`;
        try { const nat = await getAthleteNationality('soccer', slug, e.team?.id, aid); if (nat) s.aNat = nat; } catch { /* 국적 조회 실패는 무시 */ }
      }
      n++;
    }
  }
  game.assistsChecked = true;
  return n;
}

// games: games.json 배열(제자리 수정). slugByCode: { 리그코드: ESPN 슬러그 }. 최근 sinceDays 일 안의 종료 경기 중 아직 확인 안 한 것을 최신순으로 maxPerRun 건까지.
export async function enrichEspnAssists(games, slugByCode, { maxPerRun = 25, sinceDays = 14 } = {}) {
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const todo = games
    .filter((g) => slugByCode[g.league] && /_ESPN_/.test(g.gameId || '') && g.status === 'completed' && !g.assistsChecked && g.date >= cutoff
      && ['home', 'away'].some((s) => (g.scorers?.[s] || []).length > 0))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))
    .slice(0, maxPerRun);
  let done = 0, added = 0, failed = 0;
  for (const g of todo) {
    const r = await attachAssists(g, slugByCode[g.league]);
    if (r < 0) { failed++; continue; }
    done++; added += r;
    await new Promise((res) => setTimeout(res, 150));
  }
  console.log(`[espn-assists] checked=${done} assistsAdded=${added} failed=${failed} pending=${Math.max(0, games.filter((g) => slugByCode[g.league] && /_ESPN_/.test(g.gameId || '') && g.status === 'completed' && !g.assistsChecked && g.date >= cutoff && ['home', 'away'].some((s) => (g.scorers?.[s] || []).length > 0)).length)}`);
  return added;
}

// 다음스포츠에는 있는데 games.json 에 없는 "새 경기" 추가 + 시간 변경 반영 — 네이버가 막혀 일정 수집이 멈춘 동안 KBO 한국시리즈 같은 새 일정이 비지 않게(2026-10-27).
// 안전 원칙:
//  · 대상 리그만(KBO·K리그1·K리그2), 앞으로 N일 이내, 한 번에 최대 MAX_NEW 건.
//  · 이미 정확히 매칭되는 경기는 건드리지 않는다(추가 안 함). 같은 팀·근접 시각(48시간)의 "예정" 경기가 하나 있고 그 경기가 다른 다음 경기와 매칭되지 않았다면 시간 변경으로 보고 date/time 만 고친다(더블헤더 보호).
//  · 구장은 이미 매칭된 경기에서 학습한 (다음 구장명 → venueId·stadium) 표로만 정한다 — 모르는 구장이면 추가하지 않고 unmapped 로 돌려준다(추측 금지).
//  · gameId: KBO 는 다음 cpGameId 에서 '|' 만 뺀 값(네이버 gameId 와 같음 — 20/20 실측), 그 외는 'daum:<id>' (네이버가 돌아와 리그를 다시 쓰면 자연히 대체됨).
// 순수 함수만(I/O 없음).
import { kickoffMs } from './fallback-match.mjs';
import { findMatchKo, sameTeamKo } from './daum-fallback.mjs';

export const NEWGAME_LEAGUES = new Set(['KBO', 'K리그1', 'K리그2']);
export const MAX_NEW = 30;

const kstParts = (ms) => {
  const d = new Date(ms + 9 * 3600e3).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};

// 이미 매칭된 경기(다음 후보 ↔ 우리 경기)에서 구장 표 학습: { league: { '다음 구장명': { venueId, stadium } } }
export function learnVenues(games, candsByLeague) {
  const map = {};
  for (const [lg, cands] of Object.entries(candsByLeague)) {
    for (const g of games) {
      if (g.league !== lg || !g.venueId) continue;
      const m = findMatchKo(g, cands);
      if (!m || !m.field) continue;
      (map[lg] ||= {})[m.field] = { venueId: g.venueId, stadium: g.stadium };
    }
  }
  return map;
}

export function newGameId(league, m) {
  return league === 'KBO' && m.cpGameId ? String(m.cpGameId).replace('|', '') : `daum:${m.id}`;
}

// 반환: { games(새 배열), added:[{gameId,...}], retimed:[{gameId,from,to}], unmapped:[필드명] }
export function planNewGames(games, candsByLeague, venueMap, nowMs = Date.now(), { daysAhead = 14, max = MAX_NEW } = {}) {
  const out = games.map((g) => g);
  const added = [], retimed = [], unmapped = new Set();
  const existingIds = new Set(games.map((g) => g.gameId));
  for (const league of Object.keys(candsByLeague)) {
    if (!NEWGAME_LEAGUES.has(league)) continue;
    const cands = candsByLeague[league];
    const mine = out.map((g, i) => ({ g, i })).filter(({ g }) => g.league === league);
    // 우리 경기 중 어떤 다음 경기와도 엄격 매칭되는 것 / 다음 경기 중 우리와 엄격 매칭되는 것
    const mineMatched = new Set();
    const candMatched = new Set();
    for (const c of cands) {
      for (const { g, i } of mine) {
        if (Math.abs(kickoffMs(g) - c.kickoff) <= 10 * 60e3 && findMatchKo(g, [c])) { mineMatched.add(i); candMatched.add(c.id); }
      }
    }
    for (const c of cands) {
      if (candMatched.has(c.id)) continue;
      if (c.status === 'skip' || c.status === 'cancelled' || c.status === 'postponed') continue; // 새로 만들 이유 없음
      if (c.kickoff < nowMs - 6 * 3600e3 || c.kickoff - nowMs > daysAhead * 86400e3) continue;
      // 시간 변경 후보: 같은 팀, 48시간 이내, 아직 예정, 다른 다음 경기와 매칭되지 않음 — 정확히 1개일 때만
      const relaxed = mine.filter(({ g, i }) => !mineMatched.has(i) && g.status === 'scheduled'
        && Math.abs(kickoffMs(g) - c.kickoff) <= 48 * 3600e3
        && (sameTeamKo(g.home, c.homeShort) || sameTeamKo(g.home, c.home)) && (sameTeamKo(g.away, c.awayShort) || sameTeamKo(g.away, c.away)));
      if (relaxed.length === 1) {
        const { g, i } = relaxed[0];
        const p = kstParts(c.kickoff);
        if (g.date !== p.date || g.time !== p.time) {
          retimed.push({ gameId: g.gameId, league, from: `${g.date} ${g.time}`, to: `${p.date} ${p.time}` });
          out[i] = { ...g, date: p.date, time: p.time };
        }
        mineMatched.add(i); candMatched.add(c.id);
        continue;
      }
      if (relaxed.length > 1) continue; // 모호 — 건드리지 않음
      if (added.length >= max) continue;
      const v = venueMap[league]?.[c.field];
      if (!v) { unmapped.add(`${league}:${c.field || '(구장 없음)'}`); continue; }
      const gameId = newGameId(league, c);
      if (existingIds.has(gameId)) continue;
      const p = kstParts(c.kickoff);
      const rec = { date: p.date, time: p.time, league, venueId: v.venueId, home: c.homeShort || c.home, away: c.awayShort || c.away, stadium: v.stadium, timeTbd: false, gameId, status: 'scheduled' };
      out.push(rec);
      existingIds.add(gameId);
      added.push({ gameId, league, date: rec.date, time: rec.time, home: rec.home, away: rec.away, venueId: rec.venueId });
    }
  }
  return { games: out, added, retimed, unmapped: [...unmapped] };
}

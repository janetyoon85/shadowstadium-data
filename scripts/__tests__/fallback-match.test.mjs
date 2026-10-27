import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normTeam, sameTeam, kickoffMs, fromEspnEvent, fromMlbGame, findMatch, buildPatch, applyFallback, espnPeriodKo } from '../lib/fallback-match.mjs';

const EN = { 뉴캐슬: 'Newcastle', 크리스탈팰리스: 'Crystal Palace', 밀워키: 'Milwaukee', 탬파베이: 'Tampa Bay', 토트넘: 'Tottenham', 첼시: 'Chelsea' };
const espnEv = (o = {}) => ({
  id: '1', date: '2026-10-25T14:00Z',
  status: { type: { name: o.name || 'STATUS_FULL_TIME', state: o.state || 'post', shortDetail: 'FT' }, period: o.period ?? 2 },
  competitions: [{ competitors: [
    { homeAway: 'home', score: String(o.h ?? 0), team: { displayName: o.home || 'Crystal Palace' } },
    { homeAway: 'away', score: String(o.a ?? 2), team: { displayName: o.away || 'Newcastle United' } },
  ] }],
});
const game = (o = {}) => ({ date: '2026-10-25', time: '23:00', league: 'EPL', home: '크리스탈팰리스', away: '뉴캐슬', gameId: 'XYZ', status: 'scheduled', ...o });

test('팀명 정규화·동일팀 판정', () => {
  assert.equal(normTeam('Newcastle United FC'), 'newcastle united');
  assert.equal(sameTeam('Newcastle', 'Newcastle United'), true);
  assert.equal(sameTeam('Milwaukee', 'Milwaukee Brewers'), true);
  assert.equal(sameTeam('Chelsea', 'Tottenham Hotspur'), false);
  assert.equal(sameTeam('', 'x'), false);
});
test('킥오프 변환 — KST→UTC', () => {
  assert.equal(kickoffMs(game()), Date.parse('2026-10-25T14:00:00Z'));
});
test('ESPN 변환 — 종료·진행·예정·연기', () => {
  const f = fromEspnEvent(espnEv());
  assert.deepEqual([f.status, f.homeScore, f.awayScore, f.home], ['completed', 0, 2, 'Crystal Palace']);
  assert.equal(fromEspnEvent(espnEv({ name: 'STATUS_IN_PROGRESS', state: 'in', period: 1 })).status, 'live');
  assert.equal(fromEspnEvent(espnEv({ name: 'STATUS_SCHEDULED', state: 'pre' })).status, 'scheduled');
  assert.equal(fromEspnEvent(espnEv({ name: 'STATUS_POSTPONED', state: 'post' })).status, 'skip');
});
test('MLB 변환 — 인닝 문구', () => {
  const g = { gamePk: 9, gameDate: '2026-10-27T00:00:00Z', status: { abstractGameState: 'Live', detailedState: 'In Progress' }, teams: { home: { team: { name: 'Tampa Bay Rays' }, score: 1 }, away: { team: { name: 'Milwaukee Brewers' }, score: 4 } }, linescore: { currentInning: 3, inningState: 'Bottom' } };
  const m = fromMlbGame(g);
  assert.deepEqual([m.status, m.inningInfo, m.homeScore, m.awayScore], ['live', '3회말', 1, 4]);
  assert.equal(fromMlbGame({ ...g, status: { abstractGameState: 'Final', detailedState: 'Final' } }).status, 'completed');
  assert.equal(fromMlbGame({ ...g, status: { abstractGameState: 'Preview', detailedState: 'Postponed' } }).status, 'skip');
});
test('매칭 — 정확히 1개일 때만, 사전에 없는 팀·시간 어긋남은 건너뜀', () => {
  const c = fromEspnEvent(espnEv());
  assert.equal(findMatch(game(), [c], EN).id, '1');
  assert.equal(findMatch(game({ home: '모르는팀' }), [c], EN), null); // 사전 없음
  assert.equal(findMatch(game({ time: '23:30' }), [c], EN), null); // 30분 차이
  assert.equal(findMatch(game({ away: '첼시' }), [c], EN), null); // 팀 불일치
  assert.equal(findMatch(game(), [c, { ...c, id: '2' }], EN), null); // 후보 2개 → 모호
});
test('병합 — 앞으로만(상태·점수 max), 멱등', () => {
  const c = fromEspnEvent(espnEv());
  const p = buildPatch(game(), c);
  assert.deepEqual(p, { status: 'completed', homeScore: 0, awayScore: 2 });
  const done = { ...game(), ...p };
  assert.deepEqual(buildPatch(done, c), {}); // 같은 값 다시 적용해도 변화 없음
});
test('병합 — 퇴행 금지(종료인데 보조가 진행 중), 점수 감소 금지, 취소/연기 보호', () => {
  const live = fromEspnEvent(espnEv({ name: 'STATUS_IN_PROGRESS', state: 'in', h: 0, a: 1, period: 2 }));
  assert.deepEqual(buildPatch(game({ status: 'completed', homeScore: 0, awayScore: 2 }), live), {});
  assert.deepEqual(buildPatch(game({ status: 'live', homeScore: 2, awayScore: 1 }), { ...live, homeScore: 1, awayScore: 0 }), {}); // 보조가 뒤처짐 → 무시
  assert.deepEqual(buildPatch(game({ status: 'postponed' }), live), {});
  assert.deepEqual(buildPatch(game(), fromEspnEvent(espnEv({ name: 'STATUS_POSTPONED', state: 'post' }))), {});
});
test('병합 — 예정→진행 승격과 단계·인닝 갱신', () => {
  const live = fromEspnEvent(espnEv({ name: 'STATUS_IN_PROGRESS', state: 'in', h: 1, a: 0, period: 2 }));
  assert.deepEqual(buildPatch(game(), live), { status: 'live', homeScore: 1, awayScore: 0, matchPeriod: '후반' });
  const mlb = fromMlbGame({ gamePk: 9, gameDate: '2026-10-27T00:00:00Z', status: { abstractGameState: 'Live', detailedState: 'In Progress' }, teams: { home: { team: { name: 'Tampa Bay Rays' }, score: 1 }, away: { team: { name: 'Milwaukee Brewers' }, score: 4 } }, linescore: { currentInning: 6, inningState: 'Top' } });
  const g = { date: '2026-10-27', time: '09:00', league: 'MLB', home: '탬파베이', away: '밀워키', gameId: 'M1', status: 'live', homeScore: 1, awayScore: 3, inningInfo: '5회말' };
  assert.deepEqual(buildPatch(g, mlb), { awayScore: 4, inningInfo: '6회초' });
});
test('단계 문구', () => {
  assert.equal(espnPeriodKo({ typeName: 'STATUS_HALFTIME', period: 1 }), '하프타임');
  assert.equal(espnPeriodKo({ typeName: 'STATUS_IN_PROGRESS', period: 4 }), '연장후반');
  assert.equal(espnPeriodKo({ typeName: 'STATUS_IN_PROGRESS', period: 0 }), '');
});
test('applyFallback — 오늘 전후 경기만, 원본 배열 불변, 변경 목록 반환', () => {
  const now = Date.parse('2026-10-25T15:30:00Z');
  const c = fromEspnEvent(espnEv());
  const games = [game(), game({ date: '2026-08-01', gameId: 'OLD' }), game({ league: 'LALIGA', gameId: 'OTHER' })];
  const { games: out, changes } = applyFallback(games, { EPL: [c] }, EN, now);
  assert.equal(changes.length, 1); assert.equal(changes[0].gameId, 'XYZ');
  assert.equal(out[0].status, 'completed'); assert.equal(games[0].status, 'scheduled');
  assert.equal(out[1].status, 'scheduled'); // 오래된 경기는 대상 아님
});

import fs from 'node:fs';
import { ESPN_LEAGUE_SLUG } from '../lib/espn-league-slugs.mjs';
test('표기 차이 흡수 — Man City·Brøndby·D.C.·Sporting KC·Red Star', () => {
  assert.equal(sameTeam('Man City', 'Manchester City'), true);
  assert.equal(sameTeam('Brondby', 'Brøndby IF'), true);
  assert.equal(sameTeam('DC United', 'D.C. United'), true);
  assert.equal(sameTeam('Sporting KC', 'Sporting Kansas City'), true);
  assert.equal(sameTeam('Crvena Zvezda', 'Red Star Belgrade'), true);
  assert.equal(sameTeam('Man City', 'Manchester United'), false);
});
test('ESPN 슬러그 사전이 fetch-schedule.mjs 의 ESPN_LEAGUE_SLUG 와 일치(복사본 드리프트 방지)', () => {
  const src = fs.readFileSync(new URL('../fetch-schedule.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const ESPN_LEAGUE_SLUG = {'));
  const body = block.slice(0, block.indexOf('\n};'));
  const orig = Object.fromEntries([...body.matchAll(/^\s{2}([A-Z0-9]+): '([^']+)'/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(ESPN_LEAGUE_SLUG, orig);
});

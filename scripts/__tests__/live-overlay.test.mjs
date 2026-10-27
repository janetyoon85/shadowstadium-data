import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGame, applyEventOverlay, applyBasketballOverlay } from '../lib/live-overlay.mjs';

const NOW = 1_800_000_000_000;
const ov = (games, extra = {}) => ({ ts: NOW - 5000, bkTs: NOW - 5000, games, ...extra });

test('진행 중이면 점수·이닝·카운트를 덮어쓴다', () => {
  const g = { gameId: 'a', status: 'live', homeScore: 1, awayScore: 0, inningInfo: '3회초' };
  const m = mergeGame(g, { status: 'live', homeScore: 2, awayScore: 0, inningInfo: '3회말', liveState: { out: 1 } });
  assert.equal(m.homeScore, 2);
  assert.equal(m.inningInfo, '3회말');
  assert.deepEqual(m.liveState, { out: 1 });
});
test('상태는 앞으로만: 오버레이가 scheduled 면 live 를 되돌리지 않는다', () => {
  const g = { gameId: 'a', status: 'live', homeScore: 3, awayScore: 1 };
  assert.equal(mergeGame(g, { status: 'scheduled', homeScore: 0, awayScore: 0 }), g);
});
test('scheduled → live 전환은 반영', () => {
  const g = { gameId: 'a', status: 'scheduled' };
  assert.equal(mergeGame(g, { status: 'live', homeScore: 0, awayScore: 0 }).status, 'live');
});
test('득점자: 항목이 늘면 반영, 줄면 커밋된 값 유지(중복 알림 방지)', () => {
  const g = { gameId: 'a', status: 'live', scorers: { home: [{ n: 'A' }], away: [] } };
  const more = mergeGame(g, { status: 'live', scorers: { home: [{ n: 'A' }], away: [{ n: 'B' }] } });
  assert.equal(more.scorers.away.length, 1);
  const fewer = mergeGame(g, { status: 'live', scorers: { home: [], away: [] } });
  assert.equal(fewer, g, '줄어든 값은 무시');
});
test('하이라이트: 길어질 때만 반영', () => {
  const g = { gameId: 'a', status: 'live', highlights: [{ player: 'x' }] };
  assert.equal(mergeGame(g, { status: 'live', highlights: [{ player: 'x' }, { player: 'y' }] }).highlights.length, 2);
  assert.equal(mergeGame(g, { status: 'live', highlights: [] }), g);
});
test('오래된(90초+) 오버레이는 아무것도 바꾸지 않는다', () => {
  const games = [{ gameId: 'a', status: 'live', homeScore: 0 }];
  const old = { ts: NOW - 120e3, games: { a: { status: 'live', homeScore: 5 } } };
  assert.equal(applyEventOverlay(games, old, NOW), games);
  assert.equal(applyEventOverlay(games, null, NOW), games);
});
test('applyEventOverlay: 일치하는 경기만 바뀐다', () => {
  const games = [{ gameId: 'a', status: 'live', homeScore: 0 }, { gameId: 'b', status: 'live', homeScore: 1 }];
  const out = applyEventOverlay(games, ov({ a: { status: 'live', homeScore: 1 } }), NOW);
  assert.equal(out[0].homeScore, 1);
  assert.equal(out[1], games[1]);
});
test('농구: 진행 중이면 per·점수·쿼터 점수 반영, st 는 앞으로만', () => {
  const games = [{ id: 'x', st: 'live', per: '5:00 - 2nd', h: { k: 'h', s: 40, ls: [20, 20] }, a: { k: 'a', s: 38, ls: [18, 20] } }];
  const out = applyBasketballOverlay(games, ov({}, { bk: { x: { st: 'live', per: '4:10 - 2nd', h: { s: 42, ls: [20, 22] }, a: { s: 38, ls: [18, 20] } } } }), NOW);
  assert.equal(out[0].per, '4:10 - 2nd');
  assert.equal(out[0].h.s, 42);
  const back = applyBasketballOverlay(games, ov({}, { bk: { x: { st: 'scheduled', per: '', h: { s: 0 }, a: { s: 0 } } } }), NOW);
  assert.equal(back, games);
});

import { mergeBk } from '../alert-loop.mjs';
test('mergeBk: 빠른 노드가 신선하고 더 최신이면 위에 덮어쓰고, 오래되면 느린 노드만', () => {
  const now = 1_800_000_000_000;
  const live = { basketball: { ts: now - 40e3, games: { a: { id: 'x', st: 'live', per: 'old' } } }, basketball_fast: { ts: now - 10e3, games: { b: { id: 'x', st: 'live', per: 'new' } } } };
  assert.equal(mergeBk(live, now).bk.x.per, 'new');
  live.basketball_fast.ts = now - 120e3; // 오래됨
  assert.equal(mergeBk(live, now).bk.x.per, 'old');
  assert.equal(mergeBk({}, now), null);
});

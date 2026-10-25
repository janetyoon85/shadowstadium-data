import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileScorers, mergeGame } from '../espn-reconcile.mjs';

const S = (n, m, pid) => ({ n, m, pid: pid || 'espn:' + n });
test('원본이 같은 골을 두 번 기록하면(톨루카 1-1, 득점 4건) 같은 선수 중복부터 뺀다', () => {
  const g = { status: 'completed', homeScore: 1, awayScore: 1, scorers: { home: [S('Gutierrez', 62), S('Gutierrez', 67)], away: [S('Llorente', 71), S('Llorente', 73)] } };
  assert.equal(reconcileScorers(g), true);
  assert.deepEqual(g.scorers.home.map((s) => s.m), [62]);
  assert.deepEqual(g.scorers.away.map((s) => s.m), [71]);
});
test('정상 경기·진행중 경기는 건드리지 않는다', () => {
  const ok = { status: 'completed', homeScore: 2, awayScore: 0, scorers: { home: [S('A', 10), S('B', 80)], away: [] } };
  assert.equal(reconcileScorers(ok), false);
  const live = { status: 'live', homeScore: 0, awayScore: 0, scorers: { home: [S('A', 10)], away: [] } };
  assert.equal(reconcileScorers(live), false);
});
test('취소된 골: 0-0 종료인데 득점자만 남으면 비운다', () => {
  const g = { status: 'completed', homeScore: 0, awayScore: 0, scorers: { home: [S('A', 38)], away: [] } };
  reconcileScorers(g);
  assert.equal(g.scorers, undefined);
});
test('mergeGame: 새 응답에 득점자가 없고 0-0 으로 끝났으면 옛 득점자를 지운다 / 스코어가 있으면 유지', () => {
  const prev = { status: 'completed', homeScore: 0, awayScore: 0, scorers: { home: [S('A', 38)], away: [] } };
  assert.equal(mergeGame(prev, { status: 'completed', homeScore: 0, awayScore: 0 }).scorers, undefined);
  const prev2 = { status: 'completed', homeScore: 1, awayScore: 0, scorers: { home: [S('A', 38)], away: [] } };
  assert.equal(mergeGame(prev2, { status: 'completed', homeScore: 1, awayScore: 0 }).scorers.home.length, 1);
});

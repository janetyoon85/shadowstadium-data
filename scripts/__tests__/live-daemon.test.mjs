import test from 'node:test';
import assert from 'node:assert/strict';
import { gamesActive, basketballActive, guardScores } from '../lib/live-select.mjs';

const NOW = Date.parse('2026-10-27T01:00:00+09:00');
const kg = (status, hhmm, date = '2026-10-27') => ({ gameId: 'g' + hhmm + status, status, date, time: hhmm });

test('gamesActive: 시작 45분 전 ~ 5시간 뒤 경기가 있으면 활성', () => {
  assert.equal(gamesActive([kg('scheduled', '01:30')], NOW), true); // 30분 뒤
  assert.equal(gamesActive([kg('live', '18:00', '2026-10-26')], NOW), false); // 7시간 전 — 찌꺼기
  assert.equal(gamesActive([kg('live', '22:00', '2026-10-26')], NOW), true); // 3시간 전
  assert.equal(gamesActive([kg('scheduled', '05:00')], NOW), false); // 4시간 뒤
  assert.equal(gamesActive([kg('cancelled', '00:30')], NOW), false);
  assert.equal(gamesActive([], NOW), false);
});

test('basketballActive: 진행 중 또는 곧 시작', () => {
  const g = (st, dt) => ({ id: 'x', st, t: NOW + dt, h: { s: 0 }, a: { s: 0 } });
  assert.equal(basketballActive([g('live', -3600e3)], NOW), true);
  assert.equal(basketballActive([g('scheduled', 20 * 60e3)], NOW), true);
  assert.equal(basketballActive([g('scheduled', 5 * 3600e3)], NOW), false);
  assert.equal(basketballActive([g('final', -3600e3)], NOW), false);
});

test('guardScores: 진행 중 경기가 0-0 으로 역행하면 직전 점수를 유지', () => {
  const prev = { a: { status: 'live', homeScore: 2, awayScore: 1 }, b: { status: 'live', homeScore: 0, awayScore: 0 } };
  const next = { a: { status: 'live', homeScore: 0, awayScore: 0 }, b: { status: 'live', homeScore: 0, awayScore: 0 }, c: { status: 'live', homeScore: 0, awayScore: 0 } };
  assert.equal(guardScores(prev, next), 1);
  assert.deepEqual([next.a.homeScore, next.a.awayScore], [2, 1]);
  assert.deepEqual([next.b.homeScore, next.c.homeScore], [0, 0]);
});
test('guardScores: 정상 득점 증가는 건드리지 않는다', () => {
  const prev = { a: { status: 'live', homeScore: 1, awayScore: 0 } };
  const next = { a: { status: 'live', homeScore: 2, awayScore: 0 } };
  assert.equal(guardScores(prev, next), 0);
  assert.equal(next.a.homeScore, 2);
});

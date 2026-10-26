import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareGame, decideAlerts } from '../verify-against-source.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const ev = (o = {}) => ({ id: '1', startMs: NOW - 5 * 3600e3, completed: true, state: 'post', status: 'STATUS_FULL_TIME', home: { name: 'A', score: 2 }, away: { name: 'B', score: 1 }, ...o });
// 2026-10-26 02:00Z 킥오프 = KST 11:00
const g = (o = {}) => ({ gameId: 'X', date: '2026-10-26', time: '11:00', league: 'EPL', home: '가', away: '나', status: 'completed', homeScore: 2, awayScore: 1, ...o });

test('정상 일치면 불일치 없음', () => assert.deepEqual(compareGame(g(), ev(), NOW), []));
test('ESPN 종료인데 우리는 진행중/예정(3.5시간 지남) → 결과 미반영', () => {
  assert.equal(compareGame(g({ status: 'live', homeScore: 1, awayScore: 1 }), ev(), NOW)[0].kind, '결과 미반영');
});
test('스코어 불일치 / 홈원정 뒤집힘은 일치로 본다', () => {
  assert.equal(compareGame(g({ homeScore: 3 }), ev(), NOW)[0].kind, '스코어 불일치');
  assert.deepEqual(compareGame(g({ homeScore: 1, awayScore: 2 }), ev(), NOW), []);
});
test('킥오프 시각이 25분 넘게 다르면(48시간 이내 예정) 알린다', () => {
  const future = ev({ completed: false, state: 'pre', status: 'STATUS_SCHEDULED', startMs: NOW + 5 * 3600e3 });
  const ours = g({ status: 'scheduled', homeScore: undefined, awayScore: undefined, date: '2026-10-26', time: '22:00' }); // KST 22:00 = 13:00Z, ESPN 17:00Z
  assert.equal(compareGame(ours, future, NOW)[0].kind, '킥오프 시각 불일치');
  assert.deepEqual(compareGame({ ...ours, date: '2026-10-27', time: '02:00' }, ev({ completed: false, state: 'pre', status: 'STATUS_SCHEDULED', startMs: Date.parse('2026-10-26T17:00:00Z') }), NOW), []);
});
test('ESPN 연기·취소인데 우리가 모르면 알린다', () => {
  const e = ev({ completed: false, state: 'pre', status: 'STATUS_POSTPONED' });
  assert.equal(compareGame(g({ status: 'scheduled', homeScore: undefined, awayScore: undefined, time: '20:00' }), e, Date.parse('2026-10-26T11:30:00Z'))[0].kind, '연기·취소 미반영');
});
test('연속 2회 + 24시간 중복 억제', () => {
  const found = { k1: { key: 'k1', kind: 'x', text: 't' } };
  const r1 = decideAlerts(found, { pending: {}, alerted: {} }, NOW);
  assert.equal(r1.toSend.length, 0); // 첫 발견은 보류
  const r2 = decideAlerts(found, { pending: r1.pending, alerted: r1.alerted }, NOW + 3600e3);
  assert.equal(r2.toSend.length, 1); // 두 번째 → 알림
  const r3 = decideAlerts(found, { pending: r2.pending, alerted: r2.alerted }, NOW + 2 * 3600e3);
  assert.equal(r3.toSend.length, 0); // 24시간 안에는 다시 안 보냄
  const r4 = decideAlerts(found, { pending: r3.pending, alerted: r3.alerted }, NOW + 26 * 3600e3);
  assert.equal(r4.toSend.length, 1); // 해결 안 되면 하루 뒤 재알림
  assert.equal(decideAlerts({}, { pending: r4.pending, alerted: r4.alerted }, NOW + 27 * 3600e3).pending.k1, undefined); // 해소되면 보류 목록에서 사라짐
});

test('시각 미정(timeTbd) 경기는 킥오프 시각 불일치로 보지 않는다', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const ours = { date: '2026-10-27', time: '18:33', league: 'LMP', home: 'A', away: 'B', status: 'scheduled', timeTbd: true };
  const ev = { completed: false, state: 'pre', status: 'Scheduled', startMs: Date.parse('2026-10-28T01:30:00Z'), home: {}, away: {} };
  assert.deepEqual(compareGame(ours, ev, now), []);
  assert.equal(compareGame({ ...ours, timeTbd: false }, ev, now).length, 1);
});

test('알림은 2회 + 최소 지속 시간(기본 45분, 농구 박스 2시간)이 지나야 나간다 — 실행이 몇 분 간격으로 겹쳐도 오알림 방지', async () => {
  const { decideAlerts: da } = await import('../verify-against-source.mjs');
  const T0 = Date.parse('2026-10-26T04:00:00Z');
  const found = { a: { key: 'a', kind: '스코어 불일치', text: 'x' }, b: { key: 'b', kind: '농구 선수 기록 불일치', text: 'y' } };
  const r1 = da(found, { pending: {}, alerted: {} }, T0);
  assert.equal(r1.toSend.length, 0);
  const r2 = da(found, { pending: r1.pending, alerted: r1.alerted }, T0 + 5 * 60e3); // 5분 뒤 2회째 — 아직 이르다
  assert.equal(r2.toSend.length, 0);
  const r3 = da(found, { pending: r2.pending, alerted: r2.alerted }, T0 + 50 * 60e3); // 50분: 일반 불일치만
  assert.deepEqual(r3.toSend.map((x) => x.key), ['a']);
  const r4 = da(found, { pending: r3.pending, alerted: r3.alerted }, T0 + 125 * 60e3); // 2시간+: 농구 박스도
  assert.deepEqual(r4.toSend.map((x) => x.key), ['b']);
});

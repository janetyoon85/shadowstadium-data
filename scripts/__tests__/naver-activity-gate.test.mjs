import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../naver-activity-gate.mjs';

const now = Date.parse('2026-10-27T09:00:00Z'); // 18:00 KST
const g = (time, o = {}) => ({ date: '2026-10-27', time, status: 'scheduled', ...o });

test('진행·임박 경기가 있으면 실행', () => {
  assert.equal(decide({ games: [g('18:30')], nowMs: now, minute: 7 }).skip, false); // 30분 뒤 시작
  assert.equal(decide({ games: [g('15:00', { status: 'live' })], nowMs: now, minute: 7 }).skip, false); // 3시간 전 시작, 진행 중
});
test('활동 없으면 30분 주기만 실행', () => {
  const idle = [g('10:00', { status: 'completed' }), g('23:30')]; // 종료 경기 + 5.5시간 뒤 시작
  assert.equal(decide({ games: idle, nowMs: now, minute: 5 }).skip, true);
  assert.equal(decide({ games: idle, nowMs: now, minute: 30 }).skip, false);
  assert.equal(decide({ games: idle, nowMs: now, minute: 0 }).skip, false);
});
test('취소·연기·종료는 활동으로 세지 않고, 강제·빈 목록·읽기 실패 성격은 안전 쪽', () => {
  assert.equal(decide({ games: [g('18:30', { status: 'cancelled' }), g('18:30', { status: 'postponed' })], nowMs: now, minute: 5 }).skip, true);
  assert.equal(decide({ games: [], nowMs: now, minute: 5, force: true }).skip, false);
  assert.equal(decide({ games: [g('08:00')], nowMs: now, minute: 5 }).skip, true); // 10시간 전 시작(5시간 초과) 'scheduled' 로 남은 오래된 경기
});
test('idleEveryMin=1 이면 항상 실행(예전 동작)', () => {
  assert.equal(decide({ games: [], nowMs: now, minute: 5, idleEveryMin: 1 }).skip, false);
});

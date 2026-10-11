import test from 'node:test';
import assert from 'node:assert/strict';
import { staleSuspendedStatus } from '../live-staleness.mjs';

const H = 3600e3;
test('지연 문구인 채 킥오프 6시간 넘으면 postponed', () => {
  assert.equal(staleSuspendedStatus('live', '경기지연', 0, 19 * H), 'postponed');
});
test('킥오프 6시간 이내 지연은 live 유지', () => {
  assert.equal(staleSuspendedStatus('live', '경기지연', 0, 3 * H), 'live');
});
test('정상 진행 문구(후반 등)는 오래돼도 건드리지 않음', () => {
  assert.equal(staleSuspendedStatus('live', '후반', 0, 19 * H), 'live');
});
test('live 가 아니면 그대로', () => {
  assert.equal(staleSuspendedStatus('completed', '경기지연', 0, 19 * H), 'completed');
  assert.equal(staleSuspendedStatus('scheduled', '', NaN, 0), 'scheduled');
});

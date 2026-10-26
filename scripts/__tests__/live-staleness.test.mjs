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

test('applyLive: 취소로 바뀌면 진행 중이던 때 남은 점수·이닝을 지운다(우천 취소 AAA 경기가 0-1·2회말로 남던 문제)', async () => {
  const { applyLive } = await import('../statsapi-live.mjs');
  const prev = { gameId: 'X', status: 'live', homeScore: 0, awayScore: 1, inningInfo: '2회말', liveState: { o: 1 } };
  const m = applyLive(prev, { gameId: 'X', status: 'cancelled' });
  assert.equal(m.status, 'cancelled');
  assert.equal(m.homeScore, undefined);
  assert.equal(m.awayScore, undefined);
  assert.equal(m.inningInfo, undefined);
  assert.equal(m.liveState, undefined);
  // 종료는 점수 유지
  const done = applyLive(prev, { gameId: 'X', status: 'completed', homeScore: 3, awayScore: 5 });
  assert.equal(done.homeScore, 3);
  assert.equal(done.inningInfo, undefined);
});

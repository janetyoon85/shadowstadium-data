import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEvents, parseInning, parseQuarter, isBaseball } from '../notify-team-live.mjs';

const fb = (home, away, live = true) => ({ sport: 'football', live, goals: { home, away } });

test('축구 - 처음 보는 경기는 알리지 않는다(prev 없음)', () => {
  assert.deepEqual(detectEvents(undefined, fb([{ n: 'a', m: 3 }], [])), []);
});
test('축구 - 골이 늘어난 만큼만 알린다(순서대로)', () => {
  const prev = { goals: { home: 1, away: 0 } };
  const ev = detectEvents(prev, fb([{ n: 'a', m: 3 }, { n: 'b', m: 40 }], [{ n: 'c', m: 41 }]));
  assert.deepEqual(ev.map((e) => `${e.side}:${e.scorer.n}`), ['home:b', 'away:c']);
});
test('축구 - 득점자 정정(수 그대로)은 알리지 않는다 / 경기 중이 아니면 알리지 않는다', () => {
  assert.deepEqual(detectEvents({ goals: { home: 1, away: 0 } }, fb([{ n: 'x', m: 3 }], [])), []);
  assert.deepEqual(detectEvents({ goals: { home: 0, away: 0 } }, fb([{ n: 'a', m: 3 }], [], false)), []);
});
test('야구 - 이닝 번호가 커지면 직전 이닝 종료', () => {
  const cur = (inn) => ({ sport: 'baseball', live: true, inn });
  assert.deepEqual(detectEvents({ inn: 3 }, cur(3)), []);
  assert.deepEqual(detectEvents({ inn: 3 }, cur(4)), [{ type: 'inning', n: 3 }]);
  assert.deepEqual(detectEvents({}, cur(4)), []);
});
test('농구 - 1~3쿼터 종료만(하프타임=2쿼터 종료, 4쿼터는 종료 알림 몫)', () => {
  const cur = (q) => ({ sport: 'basketball', live: true, q });
  assert.deepEqual(detectEvents({ q: 1 }, cur(2)), [{ type: 'quarter', n: 1 }]);
  assert.deepEqual(detectEvents({ q: 2 }, cur(2.5)), [{ type: 'quarter', n: 2 }]);
  assert.deepEqual(detectEvents({ q: 2.5 }, cur(3)), []);
  assert.deepEqual(detectEvents({ q: 3 }, cur(4)), [{ type: 'quarter', n: 3 }]);
  assert.deepEqual(detectEvents({ q: 4 }, cur(5)), []);
});
test('파서 - 이닝/쿼터/종목', () => {
  assert.equal(parseInning('7회말'), 7);
  assert.equal(parseInning('경기전'), null);
  assert.equal(parseQuarter('2쿼터'), 2);
  assert.equal(parseQuarter('5:23 - 3rd'), 3);
  assert.equal(parseQuarter('Halftime'), 2.5);
  assert.equal(parseQuarter('End of 1st'), 1);
  assert.equal(parseQuarter('OT'), 5);
  assert.equal(parseQuarter(''), null);
  assert.equal(isBaseball('KBO'), true);
  assert.equal(isBaseball('EPL'), false);
});

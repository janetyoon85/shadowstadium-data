import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeState } from '../merge-sent-state.mjs';
test('키 합집합·늦은 시각·배열 합집합', () => {
  const theirs = { a: '2026-10-26T01:00:00Z', b: { sent: ['inn:1'], seen: '2026-10-26T01:00:00Z' } };
  const mine = { a: '2026-10-26T00:00:00Z', c: 'x', b: { sent: ['inn:2'], seen: '2026-10-26T02:00:00Z' } };
  assert.deepEqual(mergeState(theirs, mine), { a: '2026-10-26T01:00:00Z', c: 'x', b: { sent: ['inn:1', 'inn:2'], seen: '2026-10-26T02:00:00Z' } });
});
test('한쪽이 없으면 다른 쪽', () => { assert.deepEqual(mergeState(undefined, { a: 1 }), { a: 1 }); assert.deepEqual(mergeState({ a: 1 }, undefined), { a: 1 }); });

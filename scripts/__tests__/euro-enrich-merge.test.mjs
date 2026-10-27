import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euroEnrichPatch, mergeEuroEnrichment } from '../lib/euro-enrich-merge.mjs';

const card = (n, m, extra = {}) => ({ n, type: 'Y', m, ...extra });
test('카드 — 원래 없으면 채택', () => {
  const p = euroEnrichPatch({ gameId: 'a' }, { cards: { home: [card('A', 10)], away: [] } });
  assert.deepEqual(p.cards.home, [card('A', 10)]);
});
test('카드 — 개수가 늘었을 때만 채택하고 기존 항목의 pid·nat 보존', () => {
  const orig = { cards: { home: [card('A', 10, { pid: 'naver:1', nat: 'Korea' })], away: [] } };
  const enr = { cards: { home: [card('A', 10, { pid: 'espn:9' }), card('B', 40, { pid: 'espn:7' })], away: [] } };
  const p = euroEnrichPatch(orig, enr);
  assert.deepEqual(p.cards.home[0], card('A', 10, { pid: 'naver:1', nat: 'Korea' })); // 기존 pid 유지
  assert.deepEqual(p.cards.home[1], card('B', 40, { pid: 'espn:7' }));
  // 같은 개수면 아무것도 안 바꿈(pid 변형 방지)
  assert.deepEqual(euroEnrichPatch(orig, { cards: { home: [card('A', 10, { pid: 'espn:9' })], away: [] } }), {});
});
test('승부차기 — 원래 없을 때만, 다른 필드는 건드리지 않음', () => {
  assert.deepEqual(euroEnrichPatch({ shootout: { home: [1] } }, { shootout: { home: [2] }, scorers: [1] }), {});
  assert.deepEqual(euroEnrichPatch({}, { shootout: { home: [2] }, scorers: [1], pid: 'x' }), { shootout: { home: [2] } });
});
test('병합 — 변경 없는 경기는 같은 객체, 변경 수 집계, gameId 없는 경기 무시', () => {
  const orig = [{ gameId: 'a' }, { gameId: 'b', cards: { home: [card('Z', 5)], away: [] } }, { name: 'x' }];
  const enr = [{ gameId: 'a', cards: { home: [card('A', 1)], away: [] } }, { gameId: 'b', cards: { home: [card('Z', 5)], away: [] } }];
  const r = mergeEuroEnrichment(orig, enr);
  assert.equal(r.changed, 1); assert.equal(r.games[1], orig[1]); assert.equal(r.games[2], orig[2]);
  assert.equal(r.games[0].cards.home[0].n, 'A');
});

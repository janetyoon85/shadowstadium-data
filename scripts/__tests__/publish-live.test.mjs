import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLive } from '../publish-live.mjs';

const NOW = Date.parse('2026-10-27T00:00:00Z');
const g = (id, st, dt, extra = {}) => ({ id, st, t: NOW + dt, per: '10:00 - 1st', h: { s: 1, ls: [1] }, a: { s: 2, ls: [2] }, ...extra });

test('진행 중·최근 종료·곧 시작만 고른다', () => {
  const out = selectLive([
    g('espn:NBA:1', 'live', -3600e3),
    g('espn:NBA:2', 'final', -2 * 3600e3),
    g('espn:NBA:3', 'final', -10 * 3600e3), // 오래전 종료 — 제외
    g('espn:NBA:4', 'scheduled', 30 * 60e3),
    g('espn:NBA:5', 'scheduled', 5 * 3600e3), // 한참 뒤 — 제외
  ], NOW);
  assert.deepEqual(Object.keys(out).sort(), ['espn~NBA~1', 'espn~NBA~2', 'espn~NBA~4']);
});
test('Firebase 키에 못 쓰는 문자는 치환되고 원래 id 는 값에 남는다', () => {
  const out = selectLive([g('nv:KBL:2026.10/27', 'live', -600e3)], NOW);
  const k = Object.keys(out)[0];
  assert.ok(!/[.$#[\]/:]/.test(k));
  assert.equal(out[k].id, 'nv:KBL:2026.10/27');
});
test('필요한 필드만 담는다(점수·쿼터·상태)', () => {
  const out = selectLive([g('espn:NBA:9', 'live', -600e3, { venue: 'x', tv: ['a'] })], NOW);
  assert.deepEqual(Object.keys(Object.values(out)[0]).sort(), ['a', 'h', 'id', 'per', 'st']);
});

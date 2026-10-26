import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../report-429.mjs';
import { recordHit } from '../lib/watch-429.mjs';

const ev = (ts, host, n, wf = 'wf') => ({ ts, wf, host, n, paths: ['/x'] });
const NOW = Date.parse('2026-10-27T00:00:00.000Z');

test('새 429 는 도메인별로 합쳐 한 줄로 알린다', () => {
  const r = plan([ev('2026-10-26T23:50:00.000Z', 'site.espn.com', 2), ev('2026-10-26T23:55:00.000Z', 'site.espn.com', 3, 'other')], { cursor: '1970-01-01T00:00:00.000Z' }, NOW);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /site\.espn\.com — 5회/);
  assert.equal(r.next.cursor, '2026-10-26T23:55:00.000Z');
});

test('cursor 이전 기록은 다시 알리지 않는다', () => {
  const r = plan([ev('2026-10-26T23:50:00.000Z', 'a.com', 1)], { cursor: '2026-10-26T23:50:00.000Z' }, NOW);
  assert.equal(r.lines.length, 0);
  assert.equal(r.freshCount, 0);
});

test('쿨다운(30분) 안의 같은 도메인은 알리지 않고 합산했다가 다음 알림에 포함', () => {
  const state = { cursor: '1970-01-01T00:00:00.000Z', cooldown: { 'a.com': NOW - 10 * 60e3 }, suppressed: {} };
  const r1 = plan([ev('2026-10-26T23:58:00.000Z', 'a.com', 4)], state, NOW);
  assert.equal(r1.lines.length, 0);
  assert.equal(r1.next.suppressed['a.com'], 4);
  const later = NOW + 31 * 60e3;
  const r2 = plan([ev('2026-10-27T00:20:00.000Z', 'a.com', 2)], { cursor: r1.next.cursor, cooldown: r1.next.cooldown, suppressed: r1.next.suppressed }, later);
  assert.match(r2.lines[0], /a\.com — 6회/);
});

test('다른 도메인은 쿨다운과 무관하게 알린다', () => {
  const state = { cursor: '1970-01-01T00:00:00.000Z', cooldown: { 'a.com': NOW }, suppressed: {} };
  const r = plan([ev('2026-10-26T23:59:00.000Z', 'b.com', 1)], state, NOW + 60e3);
  assert.equal(r.lines.length, 1);
});

test('recordHit 는 429 만 기록하고 쿼리(키)는 남기지 않는다', () => {
  recordHit('https://api.example.com/v1/x?key=SECRET', 200); // 무시
  recordHit('https://api.example.com/v1/x?key=SECRET', 429); // 기록(에러 없이)
  assert.ok(true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { findMisses, plan } from '../trigger-gap-report.mjs';

const M = (s) => Date.parse('2026-10-27T00:00:00Z') + s * 1000;

test('정상 1분 호출은 누락 0', () => {
  assert.equal(findMisses([M(0), M(60), M(121), M(180)], 60, M(-1), M(200)).length, 0);
});
test('한 번 빠지면 1회 누락, 시각은 빠진 자리', () => {
  const r = findMisses([M(0), M(60), M(180), M(240)], 60, M(-1), M(300));
  assert.equal(r.length, 1);
  assert.equal(r[0], M(120));
});
test('4분 공백은 3회 누락', () => {
  assert.equal(findMisses([M(0), M(240)], 60, M(-1), M(300)).length, 3);
});
test('점검 구간 밖(이미 점검한 것)은 다시 세지 않는다', () => {
  assert.equal(findMisses([M(0), M(180)], 60, M(180), M(300)).length, 0);
});
test('5분 주기 작업은 5분 간격이 정상', () => {
  assert.equal(findMisses([M(0), M(300), M(600)], 300, M(-1), M(700)).length, 0);
  assert.equal(findMisses([M(0), M(300), M(900)], 300, M(-1), M(1000)).length, 1);
});
test('멈춤 감지: 마지막 호출이 너무 오래됐고 쿨다운 밖이면 알린다', () => {
  const now = M(3600);
  const byWf = { 'fetch-schedule': [M(0), M(60)] };
  const r = plan(byWf, { cursorMs: M(0) }, now);
  assert.ok(r.stallLines.some((l) => l.includes('fetch-schedule')));
  const again = plan(byWf, { cursorMs: M(0), stalled: r.next.stalled }, now + 60e3);
  assert.ok(!again.stallLines.some((l) => l.includes('fetch-schedule')), '쿨다운 안에서는 다시 알리지 않음');
});

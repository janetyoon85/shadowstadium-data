import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../venue-geo-stats-report.mjs';

const d = (o) => ({ n: 20, ok: 20, mismatch: 0, err: 0, msSum: 4000, msMax: 600, ...o });
test('측정 합산 — 통과', () => {
  const s = summarize([d({ ver: '1.0.0', os: 'android' }), d({ os: 'ios' }), d({ os: 'ios' })]);
  assert.equal(s.n, 60); assert.equal(s.devices, 3); assert.equal(s.avgMs, 200); assert.equal(s.pass, true);
});
test('측정 합산 — 불일치·오류율·표본 부족은 미충족', () => {
  assert.equal(summarize([d({ mismatch: 1 }), d(), d()]).pass, false);
  assert.equal(summarize([d({ err: 5, ok: 15 }), d(), d()]).pass, false); // 5/60 = 8%
  assert.equal(summarize([d(), d()]).pass, false); // 기기 2대
  assert.equal(summarize([]).n, 0);
});

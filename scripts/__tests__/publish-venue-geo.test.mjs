import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGeo } from '../publish-venue-geo.mjs';

const mk = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`v${i}`, { lat: 37.5, lon: 127 }]));
test('venue-geo 검증 — 정상', () => assert.equal(validateGeo(mk(150)), 150));
test('venue-geo 검증 — 너무 적으면 거부(덮어쓰기 사고 방지)', () => assert.throws(() => validateGeo(mk(5)), /너무 적음/));
test('venue-geo 검증 — 잘못된 좌표·키 거부', () => {
  const g = mk(150); g.v1 = { lat: 999, lon: 0 };
  assert.throws(() => validateGeo(g), /좌표 오류/);
  const h = mk(150); h['a.b'] = { lat: 1, lon: 1 };
  assert.throws(() => validateGeo(h), /키로 쓸 수 없는/);
});

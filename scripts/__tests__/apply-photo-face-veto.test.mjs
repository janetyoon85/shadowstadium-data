import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVetoed, vetoed } from '../apply-photo-face-veto.mjs';

test('부적합(0)으로 판정된 사진만 제거 — 적합(1)·미판정은 유지', () => {
  const faces = { 'u1': 0, 'u2': 1 };
  const list = [{ n: 'a', ph: 'u1' }, { n: 'b', ph: 'u2' }, { n: 'c', ph: 'u3' }, { n: 'd' }];
  assert.equal(stripVetoed(list, faces), 1);
  assert.deepEqual(list.map((p) => p.ph), [undefined, 'u2', 'u3', undefined]);
  assert.equal(vetoed(faces, undefined), false);
});

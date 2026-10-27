import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetCycleKey } from '../fetch-wbsc-baseball.mjs';

test('ScraperAPI 예산 주기 키 — 매월 19일에 바뀐다(달력월 아님)', () => {
  const k = (s) => budgetCycleKey(new Date(s));
  assert.equal(k('2026-10-18T23:59:59Z'), '2026-09-19');
  assert.equal(k('2026-10-19T00:00:00Z'), '2026-10-19');
  assert.equal(k('2026-10-31T12:00:00Z'), '2026-10-19');
  assert.equal(k('2026-11-01T00:00:00Z'), '2026-10-19'); // 달력월이 바뀌어도 같은 주기
  assert.equal(k('2026-11-19T00:00:00Z'), '2026-11-19');
  assert.equal(k('2027-01-05T00:00:00Z'), '2026-12-19'); // 연도 경계
});

import { shouldFailover } from '../fetch-wbsc-baseball.mjs';
test('ScraperAPI 페일오버 판단 — 키·예산·차단성 오류일 때만', () => {
  const b = { hasKey: true, used: 0, budget: 900 };
  assert.equal(shouldFailover({ ...b, status: 403 }), true);
  assert.equal(shouldFailover({ ...b, status: 429 }), true);
  assert.equal(shouldFailover({ ...b, status: undefined }), true); // 타임아웃·네트워크
  assert.equal(shouldFailover({ ...b, status: 503 }), true);
  assert.equal(shouldFailover({ ...b, status: 404 }), false); // 없는 페이지는 프록시로도 같음
  assert.equal(shouldFailover({ ...b, hasKey: false, status: 403 }), false);
  assert.equal(shouldFailover({ ...b, used: 900, status: 403 }), false);
});

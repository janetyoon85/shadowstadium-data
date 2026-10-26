import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTeam } from '../push-i18n.mjs';

test('한국어 알림: 갤럭시는 LA 갤럭시로 표시(삼성 갤럭시와 구분), 다른 팀은 그대로', () => {
  assert.equal(localTeam('ko', '갤럭시'), 'LA 갤럭시');
  assert.equal(localTeam('ko', 'LAFC'), 'LAFC');
  assert.equal(localTeam('ko', 'TS 갤럭시 FC'), 'TS 갤럭시 FC');
  assert.equal(localTeam('ko', undefined), undefined);
});
test('다른 언어는 영문 사전을 쓴다(갤럭시 → LA Galaxy)', () => {
  assert.equal(localTeam('en', '갤럭시'), 'LA Galaxy');
});

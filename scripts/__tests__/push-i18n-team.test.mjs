import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTeam } from '../push-i18n.mjs';

test('한국어 알림: MLS 팀은 풀네임으로(갤럭시 → LA 갤럭시, 삼성 갤럭시와 구분)', () => {
  assert.equal(localTeam('ko', '갤럭시'), 'LA 갤럭시');
  assert.equal(localTeam('ko', '갤럭시', 'MLS'), 'LA 갤럭시');
  assert.equal(localTeam('ko', '화이트캡스', 'MLS'), '밴쿠버 화이트캡스');
  assert.equal(localTeam('ko', 'LAFC'), 'LAFC');
  assert.equal(localTeam('ko', 'TS 갤럭시 FC'), 'TS 갤럭시 FC');
  assert.equal(localTeam('ko', undefined), undefined);
});

test('MLB 와 이름이 같은 팀(시애틀·휴스턴 등)은 리그가 MLS 일 때만 바꾸고 MLB 는 그대로', () => {
  assert.equal(localTeam('ko', '시애틀', 'MLS'), '시애틀 사운더스');
  assert.equal(localTeam('ko', '시애틀', 'MLB'), '시애틀');
  assert.equal(localTeam('ko', '휴스턴'), '휴스턴');
  assert.equal(localTeam('ko', '뉴욕', 'MLS'), '뉴욕 레드불스');
  assert.equal(localTeam('ko', '뉴욕양키스', 'MLB'), '뉴욕양키스');
  assert.equal(localTeam('ko', '시카고', 'MLB'), '시카고');
});

test('다른 언어는 영문 사전(갤럭시 → LA Galaxy)', () => {
  assert.equal(localTeam('en', '갤럭시'), 'LA Galaxy');
});

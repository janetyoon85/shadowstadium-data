import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playableIn, langsToSend, LANG_REGION } from '../notify-team-highlights.mjs';

const avail = {
  blockedKR: { b: ['KR'], t: 1 },
  openAll: { t: 1 },
  gone: { g: 1, t: 1 },
};
test('확인 기록이 없으면 아직 보내지 않는다(false)', () => { assert.equal(playableIn(avail, 'unknown', 'KR'), false); });
test('한국에서 막힌 영상은 한국어 알림 대상이 아니다', () => {
  assert.equal(playableIn(avail, 'blockedKR', 'KR'), false);
  assert.equal(playableIn(avail, 'blockedKR', 'US'), true);
});
test('삭제·비공개 영상은 어디서도 안 보낸다', () => { assert.equal(playableIn(avail, 'gone', 'US'), false); });
test('한국에서 막힌 대표 영상 + 열리는 대체 후보 → 한국어도 보낸다', () => {
  const langs = langsToSend({ v: 'blockedKR', alts: [{ v: 'openAll' }] }, avail, () => false);
  assert.ok(langs.includes('ko'));
});
test('한국에서 막힌 영상뿐이면 한국어는 제외, 다른 언어는 보낸다', () => {
  const langs = langsToSend({ v: 'blockedKR' }, avail, () => false);
  assert.ok(!langs.includes('ko'));
  assert.ok(langs.includes('en'));
});
test('이미 보낸 언어는 제외한다', () => {
  const langs = langsToSend({ v: 'openAll' }, avail, (l) => l === 'ko');
  assert.ok(!langs.includes('ko'));
});
test('모든 언어에 대표 지역이 있다', () => { for (const l of Object.keys(LANG_REGION)) assert.ok(LANG_REGION[l]); });

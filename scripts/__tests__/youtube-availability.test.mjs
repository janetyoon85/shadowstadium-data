import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedRegions, entryFromItem, REGIONS, REGIONS_VER } from '../youtube-availability.mjs';

test('allowed 목록에 없는 지원 지역이 차단으로 계산된다(NBC 리버풀-맨시티: 미국 등만 허용)', () => {
  const b = blockedRegions({ allowed: ['US', 'CA'] });
  assert.ok(b.includes('KR'));
  assert.ok(!b.includes('US'));
  assert.ok(!b.includes('CA'));
});
test('blocked 목록에 있는 지원 지역만 차단', () => {
  assert.deepEqual(blockedRegions({ blocked: ['KR', 'ZZ'] }), ['KR']);
});
test('제한 없으면 빈 배열', () => {
  assert.deepEqual(blockedRegions(undefined), []);
  assert.deepEqual(blockedRegions({}), []);
});
test('entryFromItem — 지역 제한/비공개/없음', () => {
  assert.deepEqual(entryFromItem({ id: 'a', contentDetails: { regionRestriction: { blocked: ['KR'] } }, status: { privacyStatus: 'public' } }, 5), { b: ['KR'], t: 5, v: REGIONS_VER });
  assert.deepEqual(entryFromItem({ id: 'a', status: { privacyStatus: 'private' } }, 5), { g: 1, t: 5, v: REGIONS_VER });
  assert.deepEqual(entryFromItem(undefined, 5), { g: 1, t: 5, v: REGIONS_VER });
  assert.deepEqual(entryFromItem({ id: 'a', status: { privacyStatus: 'public' } }, 5), { t: 5, v: REGIONS_VER });
});
test('REGIONS 에 한국이 있다', () => { assert.ok(REGIONS.includes('KR')); });

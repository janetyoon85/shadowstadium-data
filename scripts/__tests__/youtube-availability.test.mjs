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

import { applyRefresh } from '../youtube-availability.mjs';

test('applyRefresh - 제목 갱신, 삭제된 대표 영상은 다음 후보로 교체, 후보가 없으면 항목 삭제, 응원가는 null', () => {
  const hl = {
    g1: { v: 'A', t: '옛 제목', alts: [{ v: 'B', t: 'b' }] },
    g2: { v: 'C', t: 'c' },
    g3: { v: 'D', t: 'd', alts: [{ v: 'E', t: 'e' }] },
    g4: { v: 'F', t: 'f' },
  };
  const cs = { p1: { v: 'G', t: 'g' }, p2: { v: 'H', t: 'h' }, p3: null };
  const checks = new Map([
    ['A', { gone: true }], ['B', { title: '새 b', gone: false }],
    ['C', { gone: true }],
    ['D', { title: '새 d', gone: false }],
    ['G', { gone: true }], ['H', { title: '새 h', gone: false }],
  ]);
  const r = applyRefresh(hl, cs, checks);
  assert.deepEqual(hl.g1, { v: 'B', t: '새 b' }); // 대표 A 삭제 → 후보 B 승격(제목도 갱신), alts 비움
  assert.equal('g2' in hl, false);                 // 후보 없는 삭제 → 항목 제거
  assert.equal(hl.g3.t, '새 d');                   // 제목만 갱신, 후보 E 는 확인 안 한 채 유지
  assert.deepEqual(hl.g3.alts, [{ v: 'E', t: 'e' }]);
  assert.equal(hl.g4.t, 'f');                      // 이번에 확인 안 한 항목은 그대로
  assert.equal(cs.p1, null);
  assert.equal(cs.p2.t, '새 h');
  assert.equal(cs.p3, null);
  assert.equal(r.removed, 3);
});

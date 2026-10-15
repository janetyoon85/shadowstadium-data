import test from 'node:test';
import assert from 'node:assert/strict';
import { findNewVenues, isBaseballLeague } from '../sync-venue-meta.mjs';

test('목록에 없는 구장만 추가 — 팀은 가장 많은 홈팀, 종목은 리그로 판정', () => {
  const games = [
    { venueId: 'new_park', stadium: 'New Park', home: '팀A', league: 'LVBP' },
    { venueId: 'new_park', stadium: 'New Park', home: '팀A', league: 'LVBP' },
    { venueId: 'new_park', stadium: 'New Park', home: '팀B', league: 'LVBP' },
    { venueId: 'old_park', stadium: 'Old', home: '팀C', league: 'KBO' },
    { venueId: 'kr_stadium', stadium: '새 경기장', home: '팀D', league: 'K리그1' },
  ];
  const { addMeta, addEn } = findNewVenues(games, new Set(['old_park']), {});
  assert.deepEqual(addMeta.map((m) => m.id).sort(), ['kr_stadium', 'new_park']);
  assert.equal(addMeta.find((m) => m.id === 'new_park').teams, '팀A');
  assert.equal(addMeta.find((m) => m.id === 'new_park').sport, 'baseball');
  assert.equal(addMeta.find((m) => m.id === 'kr_stadium').sport, 'football');
  assert.deepEqual(addEn, { new_park: { name: 'New Park' }, old_park: { name: 'Old' } }); // 한글뿐인 구장은 영문명 생략
});

test('이미 meta·영문명이 있으면 아무것도 추가하지 않는다', () => {
  const games = [{ venueId: 'a', stadium: 'A', home: 'x', league: 'EPL' }];
  const r = findNewVenues(games, new Set(['a']), { a: { name: 'A' } });
  assert.equal(r.addMeta.length, 0);
  assert.deepEqual(r.addEn, {});
  assert.equal(isBaseballLeague('LVBP'), true);
  assert.equal(isBaseballLeague('EPL'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackVenue, makeAutofixCtx, uniqueAuto, isTbcVenue } from '../stadium-autofix.mjs';

const prev = [{ gameId: 'G1', venueId: 'kigali_pele_stadium' }, { gameId: 'G2', venueId: 'venue_tbc' }, { gameId: 'G3', venueId: 'argentina_venue_tbc' }];

test('이전 경기가 같은 gameId 로 구장을 알면 그 구장을 쓰고, 그 이름을 배운다', () => {
  const ctx = makeAutofixCtx(prev);
  assert.equal(fallbackVenue({ gameId: 'G1', categoryId: 'amatchfriendly', stadium: 'Kigali Pelé Stadium' }, ctx), 'kigali_pele_stadium');
  assert.equal(ctx.learned['amatchfriendly::Kigali Pelé Stadium'], 'kigali_pele_stadium');
  assert.equal(ctx.dirty, true);
  assert.equal(ctx.auto.length, 1);
});

test('이전 기록이 없는 새 경기도 같은 카테고리·같은 이름을 이미 배웠으면 그 구장을 쓴다', () => {
  const ctx = makeAutofixCtx(prev, { 'amatchfriendly::Kigali Pelé Stadium': 'kigali_pele_stadium' });
  assert.equal(fallbackVenue({ gameId: 'NEW', categoryId: 'amatchfriendly', stadium: 'Kigali Pelé Stadium' }, ctx), 'kigali_pele_stadium');
  assert.equal(ctx.dirty, false); // 새로 배운 게 아니라 파일 갱신 불필요
  assert.equal(fallbackVenue({ gameId: 'NEW', categoryId: 'unl', stadium: 'Kigali Pelé Stadium' }, ctx), null); // 카테고리가 다르면 쓰지 않는다
});

test('완전히 새 구장(이전 기록·배운 표 모두 없음)이나 빈 이름은 보정하지 않는다 — 기존 미매핑 알림 경로', () => {
  const ctx = makeAutofixCtx(prev);
  assert.equal(fallbackVenue({ gameId: 'NEW', categoryId: 'mls', stadium: '처음 보는 구장' }, ctx), null);
  assert.equal(fallbackVenue({ gameId: 'G1', categoryId: 'mls', stadium: '' }, ctx), null);
  assert.equal(fallbackVenue({ gameId: 'G1', categoryId: 'mls', stadium: 'x' }, undefined), null);
});

test('경기장 미정(TBC) 자리표시는 보정 근거로 쓰지 않는다', () => {
  const ctx = makeAutofixCtx(prev);
  assert.equal(fallbackVenue({ gameId: 'G2', categoryId: 'amatch', stadium: '새 이름' }, ctx), null);
  assert.equal(fallbackVenue({ gameId: 'G3', categoryId: 'amatch', stadium: '새 이름' }, ctx), null);
  assert.ok(isTbcVenue('venue_tbc') && isTbcVenue('china_venue_tbc') && isTbcVenue(undefined) && !isTbcVenue('kigali_pele_stadium'));
});

test('같은 (카테고리, 이름)은 알림에서 한 번만', () => {
  const a = [{ categoryId: 'c', stadium: 's', venueId: 'v', via: 'prev-game' }, { categoryId: 'c', stadium: 's', venueId: 'v', via: 'learned' }, { categoryId: 'c', stadium: 't', venueId: 'w', via: 'prev-game' }];
  assert.equal(uniqueAuto(a).length, 2);
});

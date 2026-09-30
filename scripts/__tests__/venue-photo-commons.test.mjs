import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlausibleCommonsFile, fetchVenuePhotoFromCommons } from '../venue-photo-commons.mjs';

test('고유 단어가 전부 파일명에 있어야 채택', () => {
  assert.ok(isPlausibleCommonsFile('File:Icheon Bears Park main gate.jpg', 'Icheon Bears Park'));
  assert.equal(isPlausibleCommonsFile('File:Okuhida Bear Park 20210502.jpg', 'Icheon Bears Park'), false);
  assert.equal(isPlausibleCommonsFile('File:Stade Rennais Avranches.jpg', 'Stade Rene Fenouillere'), false);
});
test('악센트 무시, 경기/지도/PDF 파일 제외', () => {
  assert.ok(isPlausibleCommonsFile('File:Vöhlinstadion.jpg', 'Vohlinstadion'));
  assert.equal(isPlausibleCommonsFile('File:US Avranches vs Stade rennais Avranches.jpg', 'Avranches Arena'), false);
  assert.equal(isPlausibleCommonsFile('File:Hawthorns map.jpg', 'The Hawthorns'), false);
});
test('fetchVenuePhotoFromCommons - 첫 유효 후보의 썸네일, 없으면 null, 오류는 undefined', async () => {
  const mk = (pages) => async () => ({ ok: true, json: async () => ({ query: { pages } }) });
  const pages = {
    1: { index: 1, title: 'File:Other.pdf', imageinfo: [{ mime: 'application/pdf', url: 'x' }] },
    2: { index: 2, title: 'File:Paju Stadium.jpg', imageinfo: [{ mime: 'image/jpeg', url: 'full', thumburl: 'thumb' }] },
  };
  assert.equal(await fetchVenuePhotoFromCommons('Paju Stadium', 'Paju', mk(pages)), 'thumb');
  assert.equal(await fetchVenuePhotoFromCommons('Zzz Stadium', 'Q', mk(pages)), null);
  assert.equal(await fetchVenuePhotoFromCommons('Paju Stadium', 'Paju', async () => ({ ok: false })), undefined);
  assert.equal(await fetchVenuePhotoFromCommons('Paju Stadium', 'Paju', async () => { throw new Error('x'); }), undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeVenuePhoto, commonsFileTitle } from '../audit-venue-photos.mjs';

test('judge - SAGA Arena photo whose only related strings are the outdoor SAGA Stadium is wrong', () => {
  const r = judgeVenuePhoto({ name: 'SAGA Arena', city: 'Saga', file: 'SAGA Stadium 2023-08 02.jpg', cats: ['Category:SAGA Stadium'], usage: ['SAGA Stadium'] });
  assert.equal(r.verdict, 'wrong');
});
test('judge - same-kind related string makes it ok (renamed venue still ok)', () => {
  const r = judgeVenuePhoto({ name: 'Rocket Arena', city: 'Cleveland', file: 'Rocket Mortgage FieldHouse 2022.png', cats: ['Category:Rocket Mortgage FieldHouse'], usage: ['Rocket Mortgage FieldHouse'] });
  assert.equal(r.verdict, 'ok');
});
test('judge - no name overlap at all is suspect (not auto-removed)', () => {
  const r = judgeVenuePhoto({ name: 'Optus Stadium', city: 'Perth', file: 'WBBL 07 Final (01).jpg', cats: ['Category:Cricket'], usage: ['WBBL'] });
  assert.equal(r.verdict, 'suspect');
});
test('judge - description with the venue name rescues an unrelated filename', () => {
  const r = judgeVenuePhoto({ name: 'Optus Stadium', city: 'Perth', file: 'WBBL 07 Final (01).jpg', cats: [], desc: 'WBBL final at Optus Stadium', usage: [] });
  assert.equal(r.verdict, 'ok');
});
test('judge - svg maps and logos are not photos', () => {
  assert.equal(judgeVenuePhoto({ name: 'Rio Parapiti', file: 'Paraguay adm location map.svg' }).verdict, 'wrong');
});
test('commonsFileTitle - parses thumb, original and FilePath urls', () => {
  assert.equal(commonsFileTitle('https://thumb.wikimedia.org/wikipedia/commons/thumb/5/55/SAGA_Stadium_2023-08_02.jpg/960px-SAGA_Stadium_2023-08_02.jpg?x=1'), 'SAGA Stadium 2023-08 02.jpg');
  assert.equal(commonsFileTitle('https://commons.wikimedia.org/wiki/Special:FilePath/SAGA_Arena_2023-08_02.jpg?width=960'), 'SAGA Arena 2023-08 02.jpg');
  assert.equal(commonsFileTitle('https://upload.wikimedia.org/wikipedia/commons/5/55/A_b.jpg'), 'A b.jpg');
});

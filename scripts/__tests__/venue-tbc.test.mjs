import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTbcStadium, GENERIC_TBC_VENUE_ID } from '../venue-tbc.mjs';

test('TBC 로 시작하는 경기장 라벨만 자리표시로 본다', () => {
  for (const s of ['TBC 아르헨티나', 'TBC (Ecuador)', 'TBC 페루', 'TBC 중국 PR)', ' tbc 일본', 'TBC']) assert.equal(isTbcStadium(s), true, s);
  for (const s of ['', undefined, '알TBC 스타디움', '티안허 스타디움', 'Estadio TBC']) assert.equal(isTbcStadium(s), false, String(s));
  assert.equal(GENERIC_TBC_VENUE_ID, 'venue_tbc');
});

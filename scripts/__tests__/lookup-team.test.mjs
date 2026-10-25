import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupTeam } from '../espn-soccer-teams.mjs';

const MAP = { shanghaiport: { ko: '상하이 하이강' }, sydneyfc: { ko: '시드니 FC' }, westernsydneywanderers: { ko: '웨스턴시드니' }, aucklandfc: { ko: '오클랜드 FC' } };
test('정확히 일치하는 키가 우선', () => assert.equal(lookupTeam(MAP, 'Sydney FC').ko, '시드니 FC'));
test('ESPN 이 FC 를 붙여 내려줘도 찾는다', () => {
  assert.equal(lookupTeam(MAP, 'Shanghai Port FC').ko, '상하이 하이강');
  assert.equal(lookupTeam(MAP, 'Western Sydney Wanderers FC').ko, '웨스턴시드니');
});
test('FC 가 빠져 내려와도 키에 FC 가 있으면 찾는다', () => assert.equal(lookupTeam(MAP, 'Auckland').ko, '오클랜드 FC'));
test('없는 팀은 undefined', () => assert.equal(lookupTeam(MAP, 'Nowhere United'), undefined));

test("접미사 FC 앞 글자가 a 로 끝나는 팀(Shenhua)도 정확히 찾는다 — 'afc' 한 번에 떼면 a 가 같이 지워지던 버그", () => {
  const m = { shanghaishenhua: { ko: '상하이 선화' }, bournemouth: { ko: '본머스' } };
  assert.equal(lookupTeam(m, 'SHANGHAI SHENHUA FC').ko, '상하이 선화');
  assert.equal(lookupTeam(m, 'AFC Bournemouth').ko, '본머스');
});

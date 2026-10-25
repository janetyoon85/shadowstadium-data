import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDuplicateNaverNba } from '../nba-dedupe.mjs';

const teams = {
  'espn:NBA:26': { abbr: 'UTAH' }, 'espn:NBA:13': { abbr: 'LAL' }, 'espn:NBA:20': { abbr: 'PHX' }, 'espn:NBA:8': { abbr: 'DET' },
  'naver:NBA:UTA': { abbr: 'UTA' }, 'naver:NBA:LAL': { abbr: 'LAL' }, 'naver:NBA:PHO': { abbr: 'PHO' }, 'naver:NBA:DET': { abbr: 'DET' },
};
const G = (id, src, h, a, date = '2026-10-26', lg = 'NBA') => [id, { id, src, lg, date, h: { k: h }, a: { k: a } }];

test('같은 날 같은 두 팀의 네이버 NBA 경기는 ESPN 이 있으면 지운다(약어 UTAH/UTA, PHX/PHO 정규화)', () => {
  const m = new Map([G('e1', 'espn', 'espn:NBA:26', 'espn:NBA:13'), G('n1', 'naver', 'naver:NBA:UTA', 'naver:NBA:LAL'), G('e2', 'espn', 'espn:NBA:20', 'espn:NBA:8'), G('n2', 'naver', 'naver:NBA:DET', 'naver:NBA:PHO')]);
  assert.equal(dropDuplicateNaverNba(m, teams), 2);
  assert.deepEqual([...m.keys()].sort(), ['e1', 'e2']);
});
test('ESPN 에 없는 네이버 경기·다른 날짜·다른 리그는 남긴다', () => {
  const m = new Map([G('e1', 'espn', 'espn:NBA:26', 'espn:NBA:13'), G('n1', 'naver', 'naver:NBA:UTA', 'naver:NBA:LAL', '2026-10-27'), G('k1', 'naver', 'naver:NBA:DET', 'naver:NBA:PHO'), G('w1', 'naver', 'naver:NBA:UTA', 'naver:NBA:LAL', '2026-10-26', 'WKBL')]);
  assert.equal(dropDuplicateNaverNba(m, teams), 0);
  assert.equal(m.size, 4);
});

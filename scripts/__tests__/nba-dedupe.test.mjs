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

import { crossCheckNaverVsEspnNba } from '../nba-dedupe.mjs';
test('네이버·ESPN 이 같은 NBA 경기를 다른 스코어로 주면 불일치로 돌려준다', () => {
  const T = { 'espn:NBA:26': { abbr: 'UTAH' }, 'espn:NBA:13': { abbr: 'LAL' }, 'naver:NBA:UTA': { abbr: 'UTA' }, 'naver:NBA:LAL': { abbr: 'LAL' } };
  const mk = (id, src, h, a, hs, as, st = 'final') => [id, { id, src, lg: 'NBA', date: '2026-10-26', t: 1000, st, h: { k: h, s: hs }, a: { k: a, s: as } }];
  const same = new Map([mk('e', 'espn', 'espn:NBA:26', 'espn:NBA:13', 100, 90), mk('n', 'naver', 'naver:NBA:UTA', 'naver:NBA:LAL', 100, 90)]);
  assert.deepEqual(crossCheckNaverVsEspnNba(same, T), []);
  const diff = new Map([mk('e', 'espn', 'espn:NBA:26', 'espn:NBA:13', 100, 90), mk('n', 'naver', 'naver:NBA:UTA', 'naver:NBA:LAL', 100, 92)]);
  const r = crossCheckNaverVsEspnNba(diff, T);
  assert.equal(r.length, 1);
  assert.match(r[0].kind, /스코어 불일치/);
});

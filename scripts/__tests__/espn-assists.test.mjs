import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssistFromText, sameScorers, carryAssists } from '../espn-assists.mjs';

test('Assisted by 문구에서 이름만 뽑는다(.Goal 같은 꼬리·부가 설명 제거)', () => {
  assert.equal(parseAssistFromText('Goal! A 1, B 0. Miguel Baeza (A) left footed shot. Assisted by Song Min-Kyu.Goal'), 'Song Min-Kyu');
  assert.equal(parseAssistFromText('... Assisted by William Osula with a through ball following a fast break.'), 'William Osula');
  assert.equal(parseAssistFromText('Goal! unassisted.'), null);
});
test('sameScorers 는 어시스트 필드를 무시한다', () => {
  const a = { home: [{ n: 'X', m: 19, pid: 'espn:1', a: 'Y', apid: 'espn:2', aNat: 'Korea' }], away: [] };
  const b = { home: [{ n: 'X', m: 19, pid: 'espn:1' }], away: [] };
  assert.equal(sameScorers(a, b), true);
  assert.equal(sameScorers(a, { home: [{ n: 'X', m: 20, pid: 'espn:1' }], away: [] }), false);
});
test('carryAssists 는 같은 골에 이전 어시스트를 이어 붙이고, 골이 늘면 재조회 표시를 푼다', () => {
  const prev = { assistsChecked: true, scorers: { home: [{ n: 'X', m: 19, pid: 'espn:1', a: 'Y' }], away: [] } };
  const same = carryAssists(prev, { scorers: { home: [{ n: 'X', m: 19, pid: 'espn:1' }], away: [] } });
  assert.equal(same.scorers.home[0].a, 'Y');
  assert.equal(same.assistsChecked, true);
  const more = carryAssists(prev, { scorers: { home: [{ n: 'X', m: 19, pid: 'espn:1' }, { n: 'Z', m: 80, pid: 'espn:3' }], away: [] } });
  assert.equal(more.scorers.home[0].a, 'Y');
  assert.equal(more.assistsChecked, undefined);
});

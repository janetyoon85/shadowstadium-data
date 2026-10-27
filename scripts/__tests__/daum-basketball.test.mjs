import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromDaumBasketball, periodLabel, buildBasketballPatch, applyDaumBasketball } from '../lib/daum-basketball.mjs';

const dg = (o = {}) => ({
  gameId: 1, startDate: '20261027', startTime: '1900', gameStatus: 'END', periodType: 'END',
  home: { team: { nameKo: '서울 SK 나이츠', shortNameKo: '서울 SK' } }, away: { team: { nameKo: '부산 KCC 이지스', shortNameKo: '부산 KCC' } },
  homeScore: { quarter1: 26, quarter2: 22, quarter3: 27, quarter4: 21, extra: null, total: 96 },
  awayScore: { quarter1: 28, quarter2: 22, quarter3: 11, quarter4: 26, extra: null, total: 87 }, ...o,
});
const TEAMS = { 'naver:KBL:1': { ko: '서울 SK' }, 'naver:KBL:2': { ko: '부산 KCC' }, 'naver:KBL:3': { ko: '원주 DB' } };
const game = (o = {}) => ({ id: 'nv:X', lg: 'KBL', t: Date.parse('2026-10-27T19:00:00+09:00'), st: 'scheduled', per: '경기전', h: { k: 'naver:KBL:1', s: 0 }, a: { k: 'naver:KBL:2', s: 0 }, ...o });
const NOW = Date.parse('2026-10-27T22:00:00+09:00');

test('변환 — 총점(total)·쿼터 점수·상태(종료→final)', () => {
  const m = fromDaumBasketball(dg());
  assert.deepEqual([m.st, m.homeScore, m.awayScore, m.homeQ, m.awayQ], ['final', 96, 87, [26, 22, 27, 21], [28, 22, 11, 26]]);
});
test('단계 문구 — 종료는 4쿼터(연장 있으면 연장), 진행 중은 채워진 쿼터 수', () => {
  assert.equal(periodLabel(fromDaumBasketball(dg())), '4쿼터');
  assert.equal(periodLabel(fromDaumBasketball(dg({ homeScore: { quarter1: 20, quarter2: 18, quarter3: null, quarter4: null, extra: null, total: 38 }, awayScore: { quarter1: 15, quarter2: 21, extra: null, total: 36 }, gameStatus: 'PLAY', periodType: 'Q2' }))), '2쿼터');
  assert.equal(periodLabel(fromDaumBasketball(dg({ homeScore: { quarter1: 1, quarter2: 1, quarter3: 1, quarter4: 1, extra: 5, total: 9 } }))), '연장');
});
test('패치 — 예정→종료 승격(상태·점수·단계), 멱등, 퇴행·점수 감소 금지', () => {
  const m = fromDaumBasketball(dg());
  const p = buildBasketballPatch(game(), m);
  assert.deepEqual([p.st, p.h.s, p.a.s, p.per], ['final', 96, 87, '4쿼터']);
  const done = { ...game(), ...p };
  assert.deepEqual(buildBasketballPatch(done, m), {});
  const stale = fromDaumBasketball(dg({ gameStatus: 'BEFORE', periodType: 'BEFORE', homeScore: null, awayScore: null }));
  assert.deepEqual(buildBasketballPatch(done, stale), {});
  const live = fromDaumBasketball(dg({ gameStatus: 'PLAY', periodType: 'Q3', homeScore: { quarter1: 5, total: 5 }, awayScore: { quarter1: 3, total: 3 } }));
  assert.deepEqual(buildBasketballPatch({ ...game(), st: 'live', h: { k: 'naver:KBL:1', s: 50 }, a: { k: 'naver:KBL:2', s: 40 }, per: '2쿼터' }, live), {}); // 보조가 뒤처짐
});
test('적용 — 한글 팀명 정확히 1개 매칭, 다른 리그·종료·창 밖은 무시', () => {
  const c = fromDaumBasketball(dg());
  const { games, changes } = applyDaumBasketball([game(), game({ id: 'a', lg: 'WKBL' }), game({ id: 'b', st: 'final' }), game({ id: 'c', t: Date.parse('2026-09-01T19:00:00+09:00') }), game({ id: 'd', h: { k: 'naver:KBL:3', s: 0 } })], { KBL: [c] }, TEAMS, NOW);
  assert.equal(changes.length, 1); assert.equal(changes[0].id, 'nv:X');
  assert.equal(games[0].st, 'final'); assert.equal(games[1].st, 'scheduled'); assert.equal(games[4].st, 'scheduled');
  assert.equal(applyDaumBasketball(games, { KBL: [c] }, TEAMS, NOW).changes.length, 0); // 멱등
  assert.equal(applyDaumBasketball([game()], { KBL: [c, { ...c, id: '2' }] }, TEAMS, NOW).changes.length, 0); // 모호
});

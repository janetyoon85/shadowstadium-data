import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromDaumGame } from '../lib/daum-fallback.mjs';
import { learnVenues, newGameId, planNewGames } from '../lib/daum-newgames.mjs';

const dg = (o = {}) => ({
  gameId: 90000001, cpGameId: '20261101HTSS02026', startDate: '20261101', startTime: '1830', gameStatus: 'BEFORE', periodType: 'BEFORE',
  field: { nameKo: '대구 삼성 라이온즈 파크' },
  home: { team: { nameKo: '삼성 라이온즈', shortNameKo: '삼성' } }, away: { team: { nameKo: 'KIA 타이거즈', shortNameKo: 'KIA' } }, homeScore: null, awayScore: null, ...o,
});
const game = (o = {}) => ({ date: '2026-11-01', time: '18:30', league: 'KBO', venueId: 'daegu', home: '삼성', away: 'KIA', stadium: '대구', timeTbd: false, gameId: 'G1', status: 'scheduled', ...o });
const NOW = Date.parse('2026-10-28T00:00:00+09:00');
const VM = { KBO: { '대구 삼성 라이온즈 파크': { venueId: 'daegu', stadium: '대구' } } };

test('gameId — KBO 는 cpGameId 에서 | 제거, 그 외는 daum:ID', () => {
  assert.equal(newGameId('KBO', { cpGameId: '55551027HTSS0|2026', id: '1' }), '55551027HTSS02026');
  assert.equal(newGameId('K리그1', { cpGameId: '20261181', id: '777' }), 'daum:777');
});
test('구장 학습 — 매칭된 경기에서 다음 구장명→venueId', () => {
  const c = fromDaumGame(dg());
  assert.deepEqual(learnVenues([game()], { KBO: [c] }).KBO['대구 삼성 라이온즈 파크'], { venueId: 'daegu', stadium: '대구' });
});
test('새 경기 추가 — 이미 있는 경기는 추가 안 함, 없는 경기는 네이버 호환 ID 로 추가', () => {
  const existing = fromDaumGame(dg());
  const fresh = fromDaumGame(dg({ gameId: 90000002, cpGameId: '20261102HTSS02026', startDate: '20261102', startTime: '1400' }));
  const r = planNewGames([game()], { KBO: [existing, fresh] }, VM, NOW);
  assert.equal(r.added.length, 1);
  assert.deepEqual([r.added[0].gameId, r.added[0].date, r.added[0].time, r.added[0].venueId], ['20261102HTSS02026', '2026-11-02', '14:00', 'daegu']);
  assert.equal(r.games.length, 2);
  assert.equal(planNewGames(r.games, { KBO: [existing, fresh] }, VM, NOW).added.length, 0); // 멱등
});
test('시간 변경 — 같은 팀·48시간 내 예정 경기 1개면 date/time 만 고침, 더블헤더·모호는 건드리지 않음', () => {
  const moved = fromDaumGame(dg({ startDate: '20261102', startTime: '1700' }));
  const r = planNewGames([game()], { KBO: [moved] }, VM, NOW);
  assert.equal(r.added.length, 0); assert.equal(r.retimed.length, 1);
  assert.deepEqual([r.games[0].date, r.games[0].time, r.games[0].gameId], ['2026-11-02', '17:00', 'G1']);
  // 같은 팀 예정 경기가 둘이면 모호 → 변경도 추가도 안 함
  const r2 = planNewGames([game(), game({ gameId: 'G2', time: '21:00' })], { KBO: [moved] }, VM, NOW);
  assert.equal(r2.added.length + r2.retimed.length, 0);
});
test('모르는 구장은 추가하지 않고 unmapped 로 보고, 취소·대상 외 리그·먼 미래는 무시', () => {
  const unk = fromDaumGame(dg({ gameId: 3, cpGameId: '20261103X', startDate: '20261103', field: { nameKo: '새 구장' } }));
  const r = planNewGames([], { KBO: [unk] }, VM, NOW);
  assert.equal(r.added.length, 0); assert.deepEqual(r.unmapped, ['KBO:새 구장']);
  const canc = fromDaumGame(dg({ gameId: 4, cpGameId: '20261104Y', startDate: '20261104', gameStatus: 'CANCEL', periodType: 'CANCEL' }));
  assert.equal(planNewGames([], { KBO: [canc] }, VM, NOW).added.length, 0);
  assert.equal(planNewGames([], { NPB: [fromDaumGame(dg({ gameId: 5 }))] }, VM, NOW).added.length, 0);
  assert.equal(planNewGames([], { KBO: [fromDaumGame(dg({ gameId: 6, cpGameId: '20271201Z', startDate: '20271201' }))] }, VM, NOW).added.length, 0);
});

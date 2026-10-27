import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normKo, sameTeamKo, daumStatus, fromDaumGame, findMatchKo, applyDaum, DAUM_LEAGUE } from '../lib/daum-fallback.mjs';

const dg = (o = {}) => ({
  gameId: 80111000, startDate: '20261027', startTime: '1830', gameStatus: 'BEFORE', periodType: 'BEFORE',
  home: { team: { nameKo: '삼성 라이온즈', shortNameKo: '삼성' } }, away: { team: { nameKo: 'KIA 타이거즈', shortNameKo: 'KIA' } },
  homeScore: null, awayScore: null, ...o,
});
const game = (o = {}) => ({ date: '2026-10-27', time: '18:30', league: 'KBO', home: '삼성', away: 'KIA', gameId: 'KBO1', status: 'scheduled', ...o });

test('팀명 정규화·부분 일치(짧은 이름 보호)', () => {
  assert.equal(normKo('FC 서울'), 'fc서울');
  assert.equal(sameTeamKo('울산', '울산 HD'), true);
  assert.equal(sameTeamKo('서울', 'FC서울'), true);
  assert.equal(sameTeamKo('삼성', 'KIA'), false);
  assert.equal(sameTeamKo('A', 'AB'), false); // 1글자는 정확 일치만
});
test('상태 매핑 — END/BEFORE/CANCEL 확인값, 미확인 진행 표기는 live', () => {
  assert.equal(daumStatus(dg({ gameStatus: 'END', periodType: 'END' })), 'completed');
  assert.equal(daumStatus(dg()), 'scheduled');
  assert.equal(daumStatus(dg({ gameStatus: 'CANCEL', periodType: 'CANCEL' })), 'cancelled');
  assert.equal(daumStatus(dg({ gameStatus: 'POSTPONE', periodType: 'POSTPONE' })), 'postponed');
  assert.equal(daumStatus(dg({ gameStatus: 'DELAY', periodType: 'T01' })), 'skip');
  assert.equal(daumStatus(dg({ gameStatus: 'ING', periodType: 'FIRST_HALF' })), 'live');
  assert.equal(daumStatus(dg({ gameStatus: '', periodType: '' })), null);
});
test('변환 — 야구 run·축구 goal 점수, 킥오프 KST', () => {
  const m = fromDaumGame(dg({ gameStatus: 'END', periodType: 'END', homeScore: { run: 1, hit: 8 }, awayScore: { run: 13 } }));
  assert.deepEqual([m.status, m.homeScore, m.awayScore, m.kickoff], ['completed', 1, 13, Date.parse('2026-10-27T18:30:00+09:00')]);
  const s = fromDaumGame(dg({ gameStatus: 'END', periodType: 'END', homeScore: { goal: 2 }, awayScore: { goal: 1 } }));
  assert.deepEqual([s.homeScore, s.awayScore], [2, 1]);
  assert.equal(fromDaumGame({ gameId: 1 }), null);
});
test('매칭 — 정확히 1개일 때만, 시간·팀 불일치·모호함은 건너뜀', () => {
  const c = fromDaumGame(dg());
  assert.equal(findMatchKo(game(), [c]).id, '80111000');
  assert.equal(findMatchKo(game({ time: '19:30' }), [c]), null);
  assert.equal(findMatchKo(game({ away: 'LG' }), [c]), null);
  assert.equal(findMatchKo(game(), [c, { ...c, id: '2' }]), null);
});
test('적용 — 예정→종료 승격, 멱등, 퇴행·취소 보호, 다른 리그 무시', () => {
  const now = Date.parse('2026-10-27T13:00:00Z'); // 22:00 KST
  const done = fromDaumGame(dg({ gameStatus: 'END', periodType: 'END', homeScore: { run: 3 }, awayScore: { run: 5 } }));
  const { games: out, changes } = applyDaum([game(), game({ league: 'NPB', gameId: 'X' })], { KBO: [done] }, now);
  assert.deepEqual(changes[0].patch, { status: 'completed', homeScore: 3, awayScore: 5 });
  assert.equal(out[1].status, 'scheduled');
  assert.equal(applyDaum(out, { KBO: [done] }, now).changes.length, 0); // 같은 값 다시 적용 → 변화 없음
  const stale = fromDaumGame(dg()); // 다음이 아직 예정으로 두는 경우
  assert.equal(applyDaum(out, { KBO: [stale] }, now).changes.length, 0); // 상태 퇴행 금지
  assert.equal(applyDaum([game({ status: 'cancelled' })], { KBO: [done] }, now).changes.length, 0);
});
test('리그 사전 — 한국 핵심 리그 포함', () => {
  for (const l of ['KBO', 'K리그1', 'K리그2', 'NPB']) assert.ok(DAUM_LEAGUE[l]);
  assert.equal(DAUM_LEAGUE.SERIEA, 'seriea');
});

test('진행 중(PLAY) 야구 — periodType B05/T03 → 5회말/3회초, 점수 객체의 run, 패치에 반영', () => {
  const live = fromDaumGame(dg({ gameStatus: 'PLAY', periodType: 'B05', homeScore: { run: 4 }, awayScore: { run: 1 } }));
  assert.deepEqual([live.status, live.inningInfo, live.homeScore, live.awayScore], ['live', '5회말', 4, 1]);
  assert.equal(fromDaumGame(dg({ gameStatus: 'PLAY', periodType: 'T03' })).inningInfo, '3회초');
  const { changes } = applyDaum([game()], { KBO: [live] }, Date.parse('2026-10-27T10:30:00Z'));
  assert.deepEqual(changes[0].patch, { status: 'live', homeScore: 4, awayScore: 1, inningInfo: '5회말' });
  // 더 진행되면 이닝만 갱신, 점수는 큰 값 유지
  const g2 = { ...game(), status: 'live', homeScore: 4, awayScore: 1, inningInfo: '5회말' };
  const later = fromDaumGame(dg({ gameStatus: 'PLAY', periodType: 'T06', homeScore: { run: 4 }, awayScore: { run: 1 } }));
  assert.deepEqual(applyDaum([g2], { KBO: [later] }, Date.parse('2026-10-27T10:40:00Z')).changes[0].patch, { inningInfo: '6회초' });
});

test('취소·연기 반영 — 예정만 바꾸고, 진행·종료·이미 취소된 경기는 건드리지 않음, 멱등', () => {
  const now = Date.parse('2026-10-27T10:00:00Z');
  const cancel = fromDaumGame(dg({ gameStatus: 'CANCEL', periodType: 'CANCEL' }));
  const { games: out, changes } = applyDaum([game()], { KBO: [cancel] }, now);
  assert.deepEqual(changes[0].patch, { status: 'cancelled' });
  assert.equal(out[0].status, 'cancelled');
  assert.equal(applyDaum(out, { KBO: [cancel] }, now).changes.length, 0); // 멱등
  assert.equal(applyDaum([game({ status: 'live' })], { KBO: [cancel] }, now).changes.length, 0); // 진행 중은 무시
  assert.equal(applyDaum([game({ status: 'completed' })], { KBO: [cancel] }, now).changes.length, 0);
  const pp = fromDaumGame(dg({ gameStatus: 'POSTPONE', periodType: 'POSTPONE' }));
  assert.deepEqual(applyDaum([game()], { KBO: [pp] }, now).changes[0].patch, { status: 'postponed' });
});

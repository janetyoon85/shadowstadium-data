import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale, fromDaumRank, mergeStandings } from '../lib/standings-fallback.mjs';

const old = [
  { team: '서울', rank: 1, played: 33, win: 20, loss: 6, draw: 7, pts: 67, gd: 32, group: '파이널 그룹 A' },
  { team: '울산', rank: 2, played: 33, win: 15, loss: 12, draw: 6, pts: 51, gd: 5, group: '파이널 그룹 A' },
  { team: '제주', rank: 3, played: 33, win: 12, loss: 11, draw: 10, pts: 46, gd: 2, group: '파이널 그룹 B' },
  { team: '안양', rank: 4, played: 33, win: 10, loss: 10, draw: 13, pts: 43, gd: -8, group: '파이널 그룹 B' },
];
const dt = (name, rank, game, win, draw, loss, pts, gd) => ({ shortNameKo: name, nameKo: name + ' FC', rank: { rank, game, win, draw, loss, pts, gd } });

test('뒤처짐 판정 — 완료 경기 수 ×2 > 순위표 경기 수 합', () => {
  assert.equal(isStale(old, 66), false); // 33*4/2 = 66
  assert.equal(isStale(old, 67), true);
  assert.equal(isStale([], 0), false);
});
test('다음 순위 변환', () => {
  const rows = fromDaumRank([dt('서울', 1, 34, 21, 7, 6, 70, 34)]);
  assert.deepEqual(rows[0], { team: '서울', teamFull: '서울 FC', rank: 1, played: 34, win: 21, draw: 7, loss: 6, pts: 70, gd: 34 });
});
test('병합 — 숫자 갱신, group 보존, 그룹 경계 안 순위', () => {
  const next = fromDaumRank([dt('서울', 1, 34, 21, 7, 6, 70, 34), dt('울산', 2, 34, 15, 6, 13, 51, 4), dt('제주', 3, 34, 13, 11, 10, 50, 4), dt('안양', 4, 34, 10, 13, 11, 43, -9)]);
  const m = mergeStandings(old, next);
  assert.equal(m.ok, true); assert.equal(m.changed, true);
  const seoul = m.rows.find((r) => r.team === '서울');
  assert.deepEqual([seoul.played, seoul.pts, seoul.gd, seoul.group, seoul.rank], [34, 70, 34, '파이널 그룹 A', 1]);
  // B 그룹 팀이 점수로 A 를 앞서도 그룹 경계는 유지(A 가 먼저)
  const next2 = fromDaumRank([dt('서울', 4, 34, 21, 7, 6, 70, 34), dt('울산', 3, 34, 15, 6, 13, 51, 4), dt('제주', 1, 34, 20, 11, 3, 90, 40), dt('안양', 2, 34, 18, 13, 3, 80, 30)]);
  const m2 = mergeStandings(old, next2);
  assert.deepEqual(m2.rows.map((r) => r.team), ['울산', '서울', '제주', '안양']); // A(울산3,서울4) → B(제주1,안양2)
  assert.deepEqual(m2.rows.map((r) => r.rank), [1, 2, 3, 4]);
});
test('병합 — 팀 수·이름 불일치·오래된 값은 적용 안 함, 같은 값은 변경 없음', () => {
  const same = fromDaumRank([dt('서울', 1, 33, 20, 7, 6, 67, 32), dt('울산', 2, 33, 15, 6, 12, 51, 5), dt('제주', 3, 33, 12, 10, 11, 46, 2), dt('안양', 4, 33, 10, 13, 10, 43, -8)]);
  const m = mergeStandings(old, same); assert.equal(m.ok, true); assert.equal(m.changed, false);
  assert.equal(mergeStandings(old, same.slice(0, 3)).ok, false);
  assert.equal(mergeStandings(old, [...same.slice(0, 3), { ...same[3], team: '모르는팀', teamFull: '모르는팀' }]).ok, false);
  const stale = fromDaumRank([dt('서울', 1, 32, 20, 6, 6, 66, 31), dt('울산', 2, 33, 15, 6, 12, 51, 5), dt('제주', 3, 33, 12, 10, 11, 46, 2), dt('안양', 4, 33, 10, 13, 10, 43, -8)]);
  assert.equal(mergeStandings(old, stale).ok, false);
});

test('정확 일치 우선 — 수원 / 수원FC 구분', () => {
  const o = [{ team: '수원', rank: 1, played: 28, win: 19, loss: 4, draw: 5, pts: 62, gd: 25 }, { team: '수원FC', rank: 2, played: 28, win: 15, loss: 4, draw: 9, pts: 54, gd: 22 }];
  const n = fromDaumRank([dt('수원', 1, 29, 20, 5, 4, 65, 26), dt('수원FC', 2, 29, 15, 10, 4, 55, 22)]);
  const m = mergeStandings(o, n);
  assert.equal(m.ok, true);
  assert.deepEqual(m.rows.map((r) => [r.team, r.pts]), [['수원', 65], ['수원FC', 55]]);
});

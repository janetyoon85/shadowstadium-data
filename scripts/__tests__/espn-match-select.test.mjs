import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectUniqueScoreMatch } from '../espn-match-select.mjs';

function makeEvent({ id, dateIso, homeScore, awayScore }) {
  return {
    id,
    date: dateIso,
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: String(homeScore) },
          { homeAway: 'away', score: String(awayScore) },
        ],
      },
    ],
  };
}

test('selectUniqueScoreMatch - 후보 하나면 스코어 상관없이 채택', () => {
  const events = [makeEvent({ id: 'A', dateIso: '2026-05-16T13:30:00Z', homeScore: 4, awayScore: 0 })];
  const kickoffMs = Date.parse('2026-05-16T13:30:00Z');
  const match = selectUniqueScoreMatch(events, kickoffMs, 4, 0);
  assert.equal(match.id, 'A');
});

test('selectUniqueScoreMatch - 동시킥오프인데 스코어가 유일하게 일치하면 그것만 채택', () => {
  const kickoffMs = Date.parse('2026-05-16T13:30:00Z');
  const events = [
    makeEvent({ id: 'A', dateIso: '2026-05-16T13:30:00Z', homeScore: 4, awayScore: 0 }),
    makeEvent({ id: 'B', dateIso: '2026-05-16T13:30:00Z', homeScore: 1, awayScore: 1 }),
  ];
  const match = selectUniqueScoreMatch(events, kickoffMs, 4, 0);
  assert.equal(match.id, 'A');
});

test('selectUniqueScoreMatch - 회귀 방지(2026-09-28): 동시킥오프+동일스코어 콜리전이면 미매칭(undefined)', () => {
  // 실제 사고 재현: 뮌헨글라드바흐 4-0 호펜하임 ↔ 동시각 우니온베를린도 4-0 아우크스부르크.
  const kickoffMs = Date.parse('2026-05-16T13:30:00Z');
  const events = [
    makeEvent({ id: 'gladbach', dateIso: '2026-05-16T13:30:00Z', homeScore: 4, awayScore: 0 }),
    makeEvent({ id: 'union-berlin', dateIso: '2026-05-16T13:30:00Z', homeScore: 4, awayScore: 0 }),
  ];
  const match = selectUniqueScoreMatch(events, kickoffMs, 4, 0);
  assert.equal(match, undefined);
});

test('selectUniqueScoreMatch - 시각이 ±5분 밖이면 후보에서 제외', () => {
  const kickoffMs = Date.parse('2026-05-16T13:30:00Z');
  const events = [makeEvent({ id: 'far', dateIso: '2026-05-16T15:00:00Z', homeScore: 4, awayScore: 0 })];
  const match = selectUniqueScoreMatch(events, kickoffMs, 4, 0);
  assert.equal(match, undefined);
});

test('selectUniqueScoreMatch - 시각후보가 하나뿐이면 스코어 불일치해도 그대로 채택(시각만으로 이미 유일)', () => {
  // 시각 후보가 1개일 땐 스코어 확인 없이 바로 채택 — 스코어 필터는 "동시킥오프로 후보가
  // 여러 개일 때"만 disambiguation 용도로 쓰임(원본 설계 그대로, 회귀 아님).
  const kickoffMs = Date.parse('2026-05-16T13:30:00Z');
  const events = [makeEvent({ id: 'A', dateIso: '2026-05-16T13:30:00Z', homeScore: 2, awayScore: 1 })];
  const match = selectUniqueScoreMatch(events, kickoffMs, 4, 0);
  assert.equal(match.id, 'A');
});

test('selectUniqueScoreMatch - 시각후보가 여럿인데 스코어가 아무 후보와도 안 맞으면 미매칭', () => {
  const kickoffMs = Date.parse('2026-05-16T13:30:00Z');
  const events = [
    makeEvent({ id: 'A', dateIso: '2026-05-16T13:30:00Z', homeScore: 2, awayScore: 1 }),
    makeEvent({ id: 'B', dateIso: '2026-05-16T13:30:00Z', homeScore: 1, awayScore: 1 }),
  ];
  const match = selectUniqueScoreMatch(events, kickoffMs, 4, 0);
  assert.equal(match, undefined);
});

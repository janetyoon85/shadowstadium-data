import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareStandings } from '../verify-standings.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const game = (date, home, hs, as, away, o = {}) => ({ league: 'KBO', status: 'completed', date, time: '18:30', home, away, homeScore: hs, awayScore: as, ...o });
const entry = (rows) => ({ updatedAt: '2026-10-26T01:00:00Z', rows });

test('순위표와 경기 결과가 맞으면 불일치 없음(무승부 포함)', () => {
  const games = [game('2026-10-01', 'A', 3, 1, 'B'), game('2026-10-02', 'B', 2, 2, 'A')];
  const rows = [{ team: 'A', played: 2, win: 1, draw: 1, loss: 0 }, { team: 'B', played: 2, win: 0, draw: 1, loss: 1 }];
  assert.deepEqual(compareStandings(games, 'KBO', entry(rows), { nowMs: NOW }), []);
});

test('경기 하나가 빠져 있으면 잡는다(예: K리그 개막전 누락)', () => {
  const games = [game('2026-10-01', 'A', 3, 1, 'B')];
  const rows = [{ team: 'A', played: 2, win: 2, draw: 0, loss: 0 }, { team: 'B', played: 2, win: 0, draw: 0, loss: 2 }];
  const r = compareStandings(games, 'KBO', entry(rows), { nowMs: NOW });
  assert.equal(r.length, 2);
  assert.ok(r[0].text.includes('순위표 2경기 2승 0무 0패') && r[0].text.includes('우리 경기 기록 1경기 1승'));
});

test('점수가 잘못 저장돼 승패가 뒤집힌 경우도 잡는다', () => {
  const games = [game('2026-10-01', 'A', 1, 3, 'B')];
  const rows = [{ team: 'A', played: 1, win: 1, draw: 0, loss: 0 }, { team: 'B', played: 1, win: 0, draw: 0, loss: 1 }];
  assert.equal(compareStandings(games, 'KBO', entry(rows), { nowMs: NOW }).length, 2);
});

test('포스트시즌(round 필드)과 시범경기(순위표 경기수 밖)는 세지 않는다', () => {
  const games = [game('2026-03-10', 'A', 0, 9, 'B'), game('2026-10-01', 'A', 3, 1, 'B'), game('2026-10-20', 'A', 0, 5, 'B', { round: 'ps_sp' })];
  const rows = [{ team: 'A', played: 1, win: 1, draw: 0, loss: 0 }, { team: 'B', played: 1, win: 0, draw: 0, loss: 1 }];
  assert.deepEqual(compareStandings(games, 'KBO', entry(rows), { nowMs: NOW }), []);
});

test('순위표가 마지막 경기 반영보다 오래됐으면(제공처 지연) 비교하지 않는다', () => {
  const games = [game('2026-10-26', 'A', 3, 1, 'B', { time: '10:00' })]; // KST 10:00 = 01:00Z
  const rows = [{ team: 'A', played: 0, win: 0, draw: 0, loss: 0 }, { team: 'B', played: 0, win: 0, draw: 0, loss: 0 }];
  const stale = { updatedAt: '2026-10-26T01:30:00Z', rows };
  assert.deepEqual(compareStandings(games, 'KBO', stale, { nowMs: Date.parse('2026-10-26T03:00:00Z') }), []);
});

test('순위표가 없거나 경기가 없으면 빈 결과', () => {
  assert.deepEqual(compareStandings([], 'KBO', entry([{ team: 'A', played: 1, win: 1, draw: 0, loss: 0 }]), { nowMs: NOW }), []);
  assert.deepEqual(compareStandings([game('2026-10-01', 'A', 1, 0, 'B')], 'KBO', undefined, { nowMs: NOW }), []);
});

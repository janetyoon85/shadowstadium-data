import test from 'node:test';
import assert from 'node:assert/strict';
import { boxInternalCheck, compareBoxFresh, parseEspnBox, parseNaverBox, compareNbaNaverVsOurs } from '../verify-basketball.mjs';
import { compareMlbBoxscore } from '../verify-events.mjs';

const pl = (n, pts, extra = {}) => ({ pid: 'espnbk:nba:' + n, n, pts, reb: 1, ast: 1, stl: 0, blk: 0, to: 0, pf: 0, fg: [Math.floor(pts / 2), 40], tp: [0, 0], ft: [pts % 2, pts % 2], ...extra });

test('내부 정합성: 선수 득점 합이 경기 점수와 다르면 알린다(부분 기록)', () => {
  const g = { id: 'espn:NBA:1', lg: 'NBA', src: 'espn', date: '2026-10-17', h: { s: 30 }, a: { s: 20 } };
  const box = { pl: { h: [pl('a', 10), pl('b', 10)], a: [pl('c', 20)] } };
  const r = boxInternalCheck(g, box, 'L');
  assert.equal(r.length, 1);
  assert.match(r[0].text, /홈 선수 득점 합 20 \/ 경기 점수 30/);
});
test('내부 정합성: 선수 득점이 필드골·3점·자유투 구성과 다르면 알린다(ESPN·네이버·B.LEAGUE 만)', () => {
  const g = { id: 'x', lg: 'KBL', src: 'naver', date: 'd', h: { s: 9 }, a: { s: 0 } };
  const bad = { pl: { h: [{ pid: 'p', n: 'N', pts: 9, fg: [3, 5], tp: [1, 2], ft: [1, 1] }], a: [] } }; // 2*3+1+1=8
  assert.equal(boxInternalCheck(g, bad).filter((m) => m.kind === '농구 선수 득점 구성 불일치').length, 1);
  assert.equal(boxInternalCheck({ ...g, src: 'ag' }, bad).filter((m) => m.kind === '농구 선수 득점 구성 불일치').length, 0);
});
test('내부 정합성: 연장 점수를 ls 에 안 담는 제공처(정규 4쿼터 동점)는 쿼터 합 비교를 건너뛴다', () => {
  const g = { id: 'x', lg: 'BLEAGUE1', src: 'bl', date: 'd', h: { s: 108 }, a: { s: 106 } };
  assert.equal(boxInternalCheck(g, { ls: { h: [20, 25, 25, 25], a: [25, 25, 20, 25] }, pl: { h: [], a: [] } }).length, 0);
  const g2 = { ...g, h: { s: 100 }, a: { s: 90 } };
  assert.equal(boxInternalCheck(g2, { ls: { h: [20, 25, 25, 25], a: [25, 25, 20, 20] }, pl: { h: [], a: [] } }).length, 1);
});
test('새 박스스코어와 비교: 선수별 스탯 변경·선수 수 차이를 잡는다(정정 반영)', () => {
  const g = { id: 'espn:NBA:1', lg: 'NBA', date: 'd' };
  const ours = { pl: { h: [pl('1', 10, { stl: 1 }), pl('2', 8)], a: [] } };
  const fresh = { pl: { h: [{ pid: 'espn:1', n: '1', pts: 10, reb: 1, ast: 1, stl: 0, blk: 0, to: 0, pf: 0 }], a: [] } };
  const r = compareBoxFresh(g, ours, fresh, 'L');
  assert.equal(r.length, 2);
  assert.ok(r.some((m) => /스틸 1→0/.test(m.text)));
  assert.ok(r.some((m) => /선수 수/.test(m.kind)));
});
test('parseEspnBox / parseNaverBox 정규화', () => {
  const sum = { boxscore: { players: [{ team: { id: '5' }, statistics: [{ keys: ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls'], athletes: [{ athlete: { id: '77', displayName: 'X' }, stats: ['30', '12', '4', '3', '1', '0', '2', '1'] }, { athlete: { id: '78' }, didNotPlay: true, stats: [] }] }] }] } };
  const b = parseEspnBox(sum, '5');
  assert.deepEqual(b.pl.h.map((p) => [p.pid, p.pts, p.reb]), [['espn:77', 12, 4]]);
  const n = parseNaverBox({ homePlayerStats: [{ playerId: 'A', playerName: 'a', playTimeSec: 0, scoreTot: 0 }, { playerId: 'B', playerName: 'b', playTimeSec: 60, scoreTot: 2, reboundTot: 1, as: 0, st: 0, bs: 0, to: 0, foulTot: 0 }], awayPlayerStats: [] });
  assert.equal(n.pl.h.length, 1);
});
test('NBA 네이버↔ESPN: 득점 분포가 다르면 알리고, 홈/원정이 뒤집힌 경우도 맞춘다', () => {
  const g = { id: 'e', lg: 'NBA', date: 'd' };
  const ours = { pl: { h: [{ pts: 20 }, { pts: 10 }, { pts: 0 }], a: [{ pts: 15 }] } };
  const naverOk = { pl: { h: [{ pts: 15 }], a: [{ pts: 10 }, { pts: 20 }] } };
  assert.equal(compareNbaNaverVsOurs(g, ours, naverOk, true).length, 0);
  assert.equal(compareNbaNaverVsOurs(g, ours, { pl: { h: [{ pts: 20 }, { pts: 11 }], a: [{ pts: 15 }] } }, false).length, 1);
});
test('MLB 공식 박스스코어: 홈런·도루 개수/누락을 선수 ID 로 비교', () => {
  const ours = { date: 'd', league: 'MLB', home: 'H', away: 'A', highlights: { home: [{ how: '홈런', player: '프렐릭', pid: 'mlb:1', text: '프렐릭' }, { how: '도루', player: '추리오', pid: 'mlb:2', text: '추리오 2개' }], away: [] } };
  const bp = (id, hr, sb) => ({ person: { id, fullName: 'P' + id }, stats: { batting: { homeRuns: hr, stolenBases: sb } } });
  const box = { teams: { home: { players: { ID1: bp(1, 1, 0), ID2: bp(2, 0, 2) } }, away: { players: { ID9: bp(9, 1, 0) } } } };
  assert.deepEqual(compareMlbBoxscore(ours, box).map((m) => m.key), ['away|홈런|mlb:9']); // 홈은 일치, 원정 9번의 홈런은 우리에 누락
  const box2 = { teams: { home: { players: { ID1: bp(1, 2, 0), ID2: bp(2, 0, 2) } }, away: { players: {} } } };
  assert.deepEqual(compareMlbBoxscore(ours, box2).map((m) => m.key), ['home|홈런|mlb:1']); // 개수 불일치
  assert.equal(compareMlbBoxscore(ours, { teams: { home: { players: { ID1: bp(1, 1, 0), ID2: bp(2, 0, 2) } }, away: { players: {} } } }).length, 0);
});

test('슛 기록 모순: 필드골 시도가 성공보다 적거나 3점 시도가 필드골 시도보다 많으면 알린다', () => {
  const g = { id: 'x', lg: 'KBL', src: 'naver', date: 'd', h: { s: 25 }, a: { s: 0 } };
  const bad = { pl: { h: [{ pid: 'p', n: 'N', pts: 25, fg: [9, 9], tp: [2, 7], ft: [5, 6] }], a: [] } };
  assert.equal(boxInternalCheck(g, bad).filter((m) => m.kind === '농구 선수 슛 기록 모순').length, 1);
  const ok = { pl: { h: [{ pid: 'p', n: 'N', pts: 25, fg: [9, 14], tp: [2, 7], ft: [5, 6] }], a: [] } };
  assert.equal(boxInternalCheck(g, ok).length, 0);
});

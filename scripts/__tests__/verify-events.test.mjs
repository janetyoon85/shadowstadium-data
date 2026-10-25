import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEspnEvents, compareSoccerEvents, compareMlbDecisions, compareNaverTimeline } from '../verify-events.mjs';

const summary = (events, hs = 1, as = 0) => ({ header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '1' }, score: String(hs) }, { homeAway: 'away', team: { id: '2' }, score: String(as) }] }] }, keyEvents: events });
const goal = (m, scorer, assist, team = '1', type = 'Goal') => ({ scoringPlay: true, type: { text: type }, clock: { displayValue: `${m}'` }, team: { id: team }, participants: [{ athlete: { id: scorer } }, ...(assist ? [{ athlete: { id: assist } }] : [])], text: assist ? `Goal! A (X) shot. Assisted by Helper Name.` : 'Goal! A (X) shot.' });
const card = (m, p, text = 'Yellow Card', team = '1') => ({ type: { text }, clock: { displayValue: `${m}'` }, team: { id: team }, participants: [{ athlete: { id: p } }] });
const game = (o = {}) => ({ date: '2026-10-26', league: 'EPL', home: '가', away: '나', scorers: { home: [{ n: 'A', m: 19, pid: 'espn:10', a: 'Helper Name', apid: 'espn:20' }], away: [] }, cards: { home: [{ n: 'B', m: 33, type: 'Y', pid: 'espn:30' }], away: [] }, ...o });

test('득점·도움·카드가 모두 일치하면 불일치 없음', () => {
  const ev = parseEspnEvents(summary([goal(19, '10', '20'), card(33, '30')]));
  assert.deepEqual(compareSoccerEvents(game(), ev).items, []);
});
test('득점 누락 / 우리에게만 있는 득점', () => {
  const ev = parseEspnEvents(summary([goal(19, '10', '20'), goal(60, '11', '', '2')], 1, 1));
  assert.equal(compareSoccerEvents(game(), ev).items.find((i) => i.kind === '득점 누락').key, 'g|60|11');
  const ev2 = parseEspnEvents(summary([goal(19, '99', '20')]));
  const r = compareSoccerEvents(game(), ev2).items.map((i) => i.kind);
  assert.ok(r.includes('득점 누락') && r.includes('득점 불일치'));
});
test('도움 누락·불일치', () => {
  const noA = game({ scorers: { home: [{ n: 'A', m: 19, pid: 'espn:10' }], away: [] } });
  assert.equal(compareSoccerEvents(noA, parseEspnEvents(summary([goal(19, '10', '20'), card(33, '30')]))).items[0].kind, '도움 누락');
  const wrongA = game({ scorers: { home: [{ n: 'A', m: 19, pid: 'espn:10', a: 'Other', apid: 'espn:99' }], away: [] } });
  assert.equal(compareSoccerEvents(wrongA, parseEspnEvents(summary([goal(19, '10', '20'), card(33, '30')]))).items[0].kind, '도움 불일치');
});
test('카드 누락·종류 불일치', () => {
  const ev = parseEspnEvents(summary([goal(19, '10', '20'), card(33, '30'), card(80, '31', 'Red Card')]));
  assert.equal(compareSoccerEvents(game(), ev).items.find((i) => i.kind === '카드 누락').key, 'c|R|80|31');
});
test('ESPN 이벤트 수가 스코어와 안 맞으면(원본 중복 기록) 건너뛴다', () => {
  const ev = parseEspnEvents(summary([goal(19, '10', '20'), goal(24, '10', '20')], 1, 0));
  assert.equal(compareSoccerEvents(game(), ev).skipped, 'espn-unreliable');
});
test('MLB 승·패 투수 불일치/누락', () => {
  const g = { date: '2026-10-25', home: '가', away: '나', winPitcherPid: 'mlb:1', losePitcherPid: 'mlb:3' };
  assert.deepEqual(compareMlbDecisions(g, { winner: { id: 1, fullName: 'W' }, loser: { id: 3, fullName: 'L' } }), []);
  assert.equal(compareMlbDecisions(g, { winner: { id: 2, fullName: 'W2' }, loser: { id: 3, fullName: 'L' } })[0].kind, '승리 투수 불일치');
  assert.equal(compareMlbDecisions({ ...g, losePitcherPid: undefined }, { winner: { id: 1 }, loser: { id: 3, fullName: 'L' } })[0].kind, '패전 투수 누락');
});
test('네이버 타임라인: 개수·선수 불일치, 자책골 side 는 수혜팀(우리 데이터와 같은 관례), 추가시간(+N)은 분 무시', () => {
  const ours = { date: 'd', league: 'K리그1', home: '가', away: '나', scorers: { home: [{ n: '김영권', m: 60 }], away: [{ n: '완델손', m: 1 }] }, cards: { home: [{ n: '김범수', m: 71, type: 'Y' }], away: [] } };
  const tl = [{ side: 'home', eventType: 'goal', time: "60'", text: '김영권 골' }, { side: 'away', eventType: 'goal', time: "1'", text: '완델손 골' }, { side: 'home', eventType: 'yellow', time: '+6', text: '김범수 경고' }];
  assert.deepEqual(compareNaverTimeline(ours, tl), []);
  const og = [{ side: 'home', eventType: 'ownGoal', time: "25'", text: '델란 자책골' }]; // 수혜팀=홈
  const ours2 = { ...ours, scorers: { home: [{ n: '델란', m: 25, og: true }], away: [] }, cards: undefined };
  assert.deepEqual(compareNaverTimeline(ours2, og), []);
  assert.equal(compareNaverTimeline(ours, [...tl, { side: 'home', eventType: 'goal', time: "88'", text: '박진 골' }]).find((i) => i.kind.startsWith('득점')).kind, '득점 개수 불일치(네이버)');
  assert.equal(compareNaverTimeline(ours, [{ side: 'home', eventType: 'goal', time: "60'", text: '다른선수 골' }, tl[1], tl[2]])[0].kind, '득점 선수·분 불일치(네이버)');
});

test('네이버 퇴장(dismissal)도 카드로 센다', () => {
  const ours = { date: 'd', league: 'K리그1', home: '가', away: '나', cards: { home: [], away: [{ n: '유인수', m: 64, type: 'R' }] } };
  assert.deepEqual(compareNaverTimeline(ours, [{ side: 'away', eventType: 'dismissal', time: "64'", text: '유인수 퇴장' }]), []);
  assert.equal(compareNaverTimeline({ ...ours, cards: { home: [], away: [] } }, [{ side: 'away', eventType: 'dismissal', time: "64'", text: '유인수 퇴장' }])[0].kind, '카드 누락(네이버)');
});

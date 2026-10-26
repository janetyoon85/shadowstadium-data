import test from 'node:test';
import assert from 'node:assert/strict';
import { elName, elTeamKey, elLastPlayedRound, parseElGame, elStandingsRows, elBoxFromStats, titleCase } from '../euroleague-common.mjs';

const club = (code) => ({ code, name: code + ' name', images: { crest: `https://x/${code}.png` } });
const game = (over = {}) => ({
  identifier: 'E2026_69', round: 7, played: true, utcDate: '2026-10-23T18:45:00Z',
  local: { club: club('PRS'), score: 93, partials: { partials1: 26, partials2: 28, partials3: 16, partials4: 23, extraPeriods: {} } },
  road: { club: club('PAM'), score: 104, partials: { partials1: 32, partials2: 25, partials3: 26, partials4: 21, extraPeriods: {} } },
  venue: { code: 'AVB11', name: 'ADIDAS ARENA', address: '56 Boulevard Ney, 75018 Paris, France' },
  audience: 8042, audienceConfirmed: true, isNeutralVenue: false, ...over,
});
const T = Date.parse('2026-10-23T18:45:00Z');

test('선수 이름: "SURNAME, GIVEN" → "Given Surname", Mc·로마숫자·아포스트로피·점·하이픈', () => {
  assert.equal(elName('AYAYI, JOEL'), 'Joel Ayayi');
  assert.equal(elName('WRIGHT IV, MCKINLEY'), 'Mckinley Wright IV'.replace('Mckinley', 'McKinley'));
  assert.equal(elName("BRISSETT, O'SHAE J"), "O'Shae J Brissett");
  assert.equal(elName('LAWSON, A.J.'), 'A.J. Lawson');
  assert.equal(elName('WILLIAMS-GOSS, NIGEL'), 'Nigel Williams-Goss');
  assert.equal(elName('SINGLE'), 'Single');
});

test('공식 클럽 코드 → 기존 ESPN 팀 키, 모르는 코드는 null', () => {
  assert.equal(elTeamKey('BAR'), 'espn:EUROLEAGUE:125618');
  assert.equal(elTeamKey('ZZZ'), null);
});

test('종료 경기: 점수·쿼터·연장 여부·구장·도시(국가 꼬리 제거)·관중', () => {
  const g = parseElGame(game(), T + 3 * 3600e3);
  assert.equal(g.st, 'final');
  assert.equal(g.per, 'Final');
  assert.deepEqual([g.h.s, g.a.s], [93, 104]);
  assert.deepEqual(g.h.ls, [26, 28, 16, 23]);
  assert.equal(g.venueName, 'Adidas Arena');
  assert.equal(g.city, 'Paris'); // "Paris 75018, France" → rawCity "France"가 아니라 우편번호 뒤 문자열이므로 아래 별도 케이스에서 확인
  assert.equal(g.att, 8042);
});

test('연장 종료 경기는 Final/OT, 연장 점수가 쿼터 배열 뒤에 붙는다', () => {
  const x = game({ local: { club: club('PRS'), score: 100, partials: { partials1: 20, partials2: 20, partials3: 20, partials4: 30, extraPeriods: { 1: 10 } } } });
  const g = parseElGame(x, T + 4 * 3600e3);
  assert.equal(g.per, 'Final/OT');
  assert.deepEqual(g.h.ls, [20, 20, 20, 30, 10]);
});

test('진행 중 판정: 킥오프 후 3.5시간 안 + 득점 있음 → live, 쿼터는 득점이 잡힌 쿼터 수', () => {
  const x = game({ played: false, local: { club: club('PRS'), score: 30, partials: { partials1: 15, partials2: 15 } }, road: { club: club('PAM'), score: 28, partials: { partials1: 14, partials2: 14 } } });
  const live = parseElGame(x, T + 40 * 60e3);
  assert.equal(live.st, 'live');
  assert.equal(live.per, 'Q2');
  assert.deepEqual([live.h.s, live.a.s], [30, 28]);
  // 3.5시간이 지났는데 종료 처리가 안 됐으면 live 로 두지 않는다
  assert.equal(parseElGame(x, T + 4 * 3600e3).st, 'scheduled');
  // 킥오프 전·득점 0 이면 예정, 점수는 비운다
  const pre = parseElGame(game({ played: false, local: { club: club('PRS'), score: 0, partials: {} }, road: { club: club('PAM'), score: 0, partials: {} } }), T - 3600e3);
  assert.equal(pre.st, 'scheduled');
  assert.equal(pre.h.s, undefined);
  assert.equal(pre.per, undefined);
});

test('날짜가 깨진 경기는 건너뛴다(null)', () => {
  assert.equal(parseElGame(game({ utcDate: 'nope' }), T), null);
});

test('도시: 주소 도시 → 임시 홈구장 코드 지정 → 홈 클럽 연고지, 중립경기는 비움', () => {
  assert.equal(parseElGame(game({ venue: { code: 'X', name: 'A', address: 'Karyatidon 16, Kifissia 14564, Athens, Greece' } }), T).city, 'Athens');
  assert.equal(parseElGame(game({ venue: { code: 'AUF4', name: 'ALEKSANDAR NIKOLIC HALL', address: 'Caplina 39, Belgrade 11000, Serbia' } }), T).city, 'Belgrade');
  assert.equal(parseElGame(game({ venue: { code: 'AVK1', name: 'ARENA 8888 SOFIA', address: '' }, local: { club: club('HTA'), score: 1, partials: {} } }), T).city, 'Sofia');
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'NO ADDR', address: '' } }), T).city, 'Paris'); // 홈 클럽(PRS) 연고지
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'NO ADDR', address: '' }, isNeutralVenue: true }), T).city, undefined);
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'X', address: 'Bulevar Arsenija Carnojevica 58, 11070 Belgrade - Serbia' } }), T).city, 'Belgrade');
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'X', address: 'Avenida de Felipe II 1, 28009, Madrid' } }), T).city, 'Madrid');
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'X', address: 'Via Nannetti 1, 40122 Bologna - Italy' } }), T).city, 'Bologna');
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'X', address: 'Avenue Simone Veil 5, 69150 Décines-Charpieu - France' } }), T).city, 'Décines-Charpieu');
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'X', address: 'Ethnarchou Makariou Av., Piraeus' } }), T).city, 'Paris');
  assert.equal(parseElGame(game({ venue: { code: 'Q', name: 'X', address: 'Kazliçesme Mah. 10. Yil Caddesi No: 2/1 Zeytinburnu / Turkiye' } }), T).city, 'Paris');
});

test('titleCase: 구장 이름 단어 첫 글자만 대문자', () => {
  assert.equal(titleCase('PALAU BLAUGRANA'), 'Palau Blaugrana');
  assert.equal(titleCase('COCA-COLA ARENA'), 'Coca-Cola Arena');
});

test('마지막으로 경기가 끝난 라운드', () => {
  assert.equal(elLastPlayedRound([{ played: true, round: 6 }, { played: true, round: 7 }, { played: false, round: 8 }]), 7);
  assert.equal(elLastPlayedRound([{ played: false, round: 1 }]), 0);
  assert.equal(elLastPlayedRound(undefined), 0);
});

test('순위표: 순위순 정렬·승률·승차·득실, 매핑 없는 클럽은 제외', () => {
  const row = (code, position, won, lost, pf, pa) => ({ club: { code }, data: { position, gamesWon: won, gamesLost: lost, pointsFavour: pf, pointsAgainst: pa, qualified: false } });
  const rows = elStandingsRows([{ standings: [row('MAD', 2, 5, 2, 600, 560), row('PAN', 1, 6, 1, 613, 517), row('ZZZ', 3, 4, 3, 500, 500)] }]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2]);
  assert.equal(rows[0].k, 'espn:EUROLEAGUE:125632');
  assert.equal(rows[0].gb, '-');
  assert.equal(rows[1].gb, '1'); // ((6-5)+(2-1))/2
  assert.equal(rows[1].pct, 0.714);
  assert.equal(rows[0].pf, '613');
  assert.equal(elStandingsRows([]), null);
  assert.equal(elStandingsRows(undefined), null);
});

test('박스스코어: 출전 선수만, 시간 mm:ss, ±부호, 팀 합계, 선수 콜백', () => {
  const st = (o) => ({ timePlayed: 1190, points: 6, fieldGoalsMadeTotal: 3, fieldGoalsAttemptedTotal: 7, fieldGoalsMade3: 0, fieldGoalsAttempted3: 2, freeThrowsMade: 0, freeThrowsAttempted: 0, totalRebounds: 2, assistances: 5, steals: 1, turnovers: 1, blocksFavour: 0, foulsCommited: 2, plusMinus: -12, dorsal: 11, startFive: true, ...o });
  const p = (code, name, stats) => ({ player: { person: { code, name }, positionName: 'Guard', images: { headshot: 'https://img/' + code } }, stats });
  const side = (players) => ({ players, total: { points: 93, totalRebounds: 33, assistances: 21, steals: 8, blocksFavour: 2, turnovers: 10, foulsCommited: 25, fieldGoalsMadeTotal: 38, fieldGoalsAttemptedTotal: 72, fieldGoalsMade3: 10, fieldGoalsAttempted3: 30, freeThrowsMade: 7, freeThrowsAttempted: 13 } });
  const j = { local: side([p('006904', 'AYAYI, JOEL', st({})), p('000001', 'BENCH, DNP', st({ timePlayed: 0, points: 0 })), p('000002', 'PLUS, GUY', st({ plusMinus: 5, startFive: false }))]), road: side([p('000003', 'ROAD, MAN', st({ points: 20 }))]) };
  const seen = [];
  const box = elBoxFromStats(j, (s, pid, n) => seen.push([s, pid, n]));
  assert.equal(box.pl.h.length, 2); // 0분·0점 선수는 제외
  assert.deepEqual(box.pl.h[0], { pid: 'elbk:006904', n: 'Joel Ayayi', no: '11', pos: 'Guard', img: 'https://img/006904', min: '19:50', pts: 6, reb: 2, ast: 5, stl: 1, blk: 0, to: 1, pf: 2, fg: [3, 7], tp: [0, 2], ft: [0, 0], pm: '-12', gs: 1 });
  assert.equal(box.pl.h[1].pm, '+5');
  assert.equal(box.pl.h[1].gs, 0);
  assert.equal(box.tm.h.pts, 93);
  assert.deepEqual(box.tm.h.fg, [38, 72]);
  assert.deepEqual(seen.map((x) => x[0]), ['h', 'h', 'a']);
  assert.equal(elBoxFromStats({ local: { players: [] } }), null); // 아직 기록 없음(경기 전)
  assert.equal(elBoxFromStats(undefined), null);
});

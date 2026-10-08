import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignSeriesRecord, assignLegOneResult } from '../series-record.mjs';
import { espnStage } from '../espn-stage.mjs';

// 한국시리즈 형태: LG-한화, 홈/원정이 경기마다 바뀐다.
function ks(over = []) {
  const base = [
    { date: '2025-10-26', time: '18:30', home: 'LG', away: '한화', homeScore: 8, awayScore: 2 },
    { date: '2025-10-27', time: '18:30', home: 'LG', away: '한화', homeScore: 13, awayScore: 5 },
    { date: '2025-10-29', time: '18:30', home: '한화', away: 'LG', homeScore: 7, awayScore: 3 },
    { date: '2025-10-30', time: '18:30', home: '한화', away: 'LG', homeScore: 4, awayScore: 7 },
  ];
  return base.map((g, i) => ({
    league: 'KBO', round: 'ps_ks', rn: i + 1, status: 'completed', ...g, ...(over[i] || {}),
  }));
}

test('3차전은 2차전까지의 승수를 홈/원정 팀 기준으로 단다', () => {
  const g = assignSeriesRecord(ks());
  assert.equal(g[0].serH, undefined); // 1차전은 0-0이라 생략
  assert.deepEqual([g[1].serH, g[1].serA], [1, 0]); // LG 1승
  assert.deepEqual([g[2].serH, g[2].serA], [0, 2]); // 홈=한화 0승, 원정=LG 2승
  assert.deepEqual([g[3].serH, g[3].serA], [1, 2]); // 홈=한화 1승, 원정=LG 2승
});

test('무승부는 어느 팀 승수에도 넣지 않는다', () => {
  const g = assignSeriesRecord(ks([{ homeScore: 3, awayScore: 3 }]));
  assert.deepEqual([g[1].serH, g[1].serA], [0, 0]);
});

test('앞 경기가 끝나지 않았으면 그 뒤 경기는 전적을 생략한다 (틀린 전적보다 공란)', () => {
  const g = assignSeriesRecord(ks([{}, { status: 'scheduled', homeScore: undefined, awayScore: undefined }]));
  assert.deepEqual([g[1].serH, g[1].serA], [1, 0]); // 2차전 자체는 1차전 결과로 표시 가능
  assert.equal(g[2].serH, undefined); // 3차전은 2차전 결과를 모름
  assert.equal(g[3].serH, undefined);
});

test('rn이 순번과 어긋나면(앞 경기가 수집 범위 밖) 생략한다', () => {
  const g = ks().slice(2); // 3,4차전만 있음 (rn=3,4 인데 그룹 순번은 1,2)
  assignSeriesRecord(g);
  assert.equal(g[0].serH, undefined);
  assert.equal(g[1].serH, undefined);
});

test('취소 경기는 번호/전적 계산에서 빠진다', () => {
  const g = ks();
  g.splice(1, 0, { league: 'KBO', round: 'ps_ks', rn: 0, status: 'cancelled', date: '2025-10-26', time: '19:00', home: 'LG', away: '한화' });
  assignSeriesRecord(g);
  assert.equal(g[1].serH, undefined);
  assert.deepEqual([g[2].serH, g[2].serA], [1, 0]);
});

test('14일 넘게 떨어진 같은 대진은 별개 시리즈이고 재호출은 멱등이다', () => {
  const a = ks();
  const b = ks().map((x) => ({ ...x, date: x.date.replace('2025-10', '2025-12') }));
  const all = [...a, ...b];
  assignSeriesRecord(all);
  const once = JSON.stringify(all);
  assignSeriesRecord(all);
  assert.equal(JSON.stringify(all), once);
  assert.deepEqual([all[5].serH, all[5].serA], [1, 0]); // 두 번째 시리즈 2차전도 1-0 (누적 안 됨)
});

test('스테일 값은 계산 불가가 되면 지워진다', () => {
  const g = ks([{}, { serH: 9, serA: 9 }]);
  g[0].status = 'scheduled';
  assignSeriesRecord(g);
  assert.equal(g[1].serH, undefined);
});

// ---- ESPN 합계 스코어 (espn-stage) ----
function espnEvent(slug, leg, comps) {
  return [
    { season: { slug } },
    { notes: [{ headline: `${leg === 1 ? '1st' : '2nd'} Leg` }], competitors: comps },
  ];
}

test('ESPN 2차전: competitors.aggregateScore 를 홈/원정 합계로 변환', () => {
  const [e, c] = espnEvent('clausura---semifinals', 2, [
    { homeAway: 'home', aggregateScore: 1.0 },
    { homeAway: 'away', aggregateScore: 1.0 },
  ]);
  const out = espnStage(e, c);
  assert.equal(out.phaseCode, 'T4');
  assert.equal(out.leg, 2);
  assert.equal(out.homeAggregateScore, 1);
  assert.equal(out.awayAggregateScore, 1);
});

test('ESPN 1차전은 합계를 넣지 않고, 한쪽만 있으면 둘 다 버린다', () => {
  const [e1, c1] = espnEvent('quarterfinals', 1, [{ homeAway: 'home', aggregateScore: 2 }, { homeAway: 'away', aggregateScore: 0 }]);
  const o1 = espnStage(e1, c1);
  assert.equal(o1.leg, 1);
  assert.equal(o1.homeAggregateScore, undefined);
  const [e2, c2] = espnEvent('quarterfinals', 2, [{ homeAway: 'home', aggregateScore: 2 }, { homeAway: 'away' }]);
  const o2 = espnStage(e2, c2);
  assert.equal(o2.homeAggregateScore, undefined);
  assert.equal(o2.awayAggregateScore, undefined);
});

// ---- 2차전 카드용 1차전 결과 ----
function legGames() {
  return [
    { league: 'UCL', phaseCode: 'T8', leg: 1, status: 'completed', date: '2026-04-08', time: '04:00', home: '스포르팅', away: '아스널', homeScore: 0, awayScore: 1 },
    { league: 'UCL', phaseCode: 'T8', leg: 2, status: 'scheduled', date: '2026-04-15', time: '04:00', home: '아스널', away: '스포르팅' },
  ];
}

test('2차전 경기 전: 1차전 득점을 이 경기 홈/원정 팀 기준으로 단다 (홈/원정이 뒤바뀜)', () => {
  const g = assignLegOneResult(legGames());
  assert.equal(g[0].l1H, undefined); // 1차전 자신에겐 안 붙음
  assert.deepEqual([g[1].l1H, g[1].l1A], [1, 0]); // 홈=아스널(1차전 1골), 원정=스포르팅(0골)
});

test('1차전이 끝나지 않았거나 없거나 너무 멀면 생략하고, 재호출은 멱등', () => {
  const a = legGames(); a[0].status = 'scheduled';
  assignLegOneResult(a);
  assert.equal(a[1].l1H, undefined);
  const b = legGames().slice(1);
  b[0].l1H = 5; b[0].l1A = 5;
  assignLegOneResult(b);
  assert.equal(b[0].l1H, undefined); // 스테일 제거
  const c = legGames(); c[1].date = '2026-09-15';
  assignLegOneResult(c);
  assert.equal(c[1].l1H, undefined);
  const d = legGames();
  assignLegOneResult(d);
  const once = JSON.stringify(d);
  assignLegOneResult(d);
  assert.equal(JSON.stringify(d), once);
});

test('다른 단계/다른 대회의 같은 팀 경기는 섞이지 않는다', () => {
  const g = legGames();
  g[0].phaseCode = 'T16';
  assignLegOneResult(g);
  assert.equal(g[1].l1H, undefined);
});

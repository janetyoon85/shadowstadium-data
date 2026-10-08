import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  smoothedRate,
  isLowYield,
  allowSearch,
  seedStats,
  allocateBySource,
  EXPLORE_SLOTS,
  LOW_YIELD_SLOTS,
} from '../search-yield.mjs';

test('성공률 보정: 표본이 적으면 사전확률 쪽으로, 많으면 실측 쪽으로', () => {
  assert.equal(smoothedRate({ n: 0, h: 0 }), 0.25);
  assert.ok(smoothedRate({ n: 1, h: 0 }) > 0.15); // 1번 실패로 바로 0%로 보지 않음
  assert.ok(Math.abs(smoothedRate({ n: 411, h: 269 }) - 0.65) < 0.02); // kbo 실측
  assert.ok(Math.abs(smoothedRate({ n: 442, h: 43 }) - 0.097) < 0.01); // naver 실측
});

test('저성공 판정: 표본 8회 이상 + 보정 성공률 12% 미만', () => {
  assert.equal(isLowYield({ n: 5, h: 0 }), false); // 표본 부족
  assert.equal(isLowYield({ n: 12, h: 0 }), true); // AFL 실측(0/12)
  assert.equal(isLowYield({ n: 6, h: 2 }), false);
  assert.equal(isLowYield({ n: 442, h: 43 }), true); // naver
  assert.equal(isLowYield({ n: 34, h: 34 }), false); // UNL
});

test('하이라이트 게이팅: 저성공 리그는 7일에 1번만 허용(프로브)', () => {
  const day = 86400e3;
  const ok = { n: 20, h: 15 };
  assert.equal(allowSearch(ok, 1000), true);
  const low = { n: 12, h: 0 };
  assert.equal(allowSearch(low, 10 * day), true); // 첫 프로브
  assert.equal(low.probeT, 10 * day);
  assert.equal(allowSearch(low, 11 * day), false); // 6일 이내 차단
  assert.equal(allowSearch(low, 16 * day), false);
  assert.equal(allowSearch(low, 17 * day), true); // 7일 경과
});

test('시드: 최근 시도 기록과 결과로 리그별 통계를 만든다', () => {
  const tried = { g1: {}, g2: {}, g3: {}, g4: {} };
  const lg = { g1: 'AFL', g2: 'AFL', g3: 'UNL', g4: 'UNL', g5: 'X' };
  const stats = seedStats(tried, (id) => id === 'g3' || id === 'g4', (id) => lg[id]);
  assert.deepEqual(stats, { AFL: { n: 2, h: 0 }, UNL: { n: 2, h: 2 } });
  assert.deepEqual(seedStats({ gz: {} }, () => true, () => undefined), {}); // 리그 모르는 id 는 제외
});

const mk = (src, n) => Array.from({ length: n }, (_, i) => `${src}${i}`);

test('응원가 배분: 성공률 높은 소스 우선, 저성공(naver)은 실행당 소량만', () => {
  const stats = { kbo: { n: 411, h: 269 }, naver: { n: 442, h: 43 }, 'nbk:kbl': { n: 131, h: 49 }, mlb: { n: 40, h: 12 } };
  const queues = { kbo: mk('kbo', 65), naver: mk('naver', 488), 'nbk:kbl': mk('kbl', 20), mlb: mk('mlb', 1234) };
  const out = allocateBySource(stats, queues, 30);
  assert.equal(out.length, 30);
  assert.equal(out.filter((x) => x.startsWith('kbo')).length, 30 - out.filter((x) => !x.startsWith('kbo')).length);
  assert.ok(out.filter((x) => x.startsWith('naver')).length <= LOW_YIELD_SLOTS);
  assert.ok(out.filter((x) => x.startsWith('kbo')).length >= 15); // 65% 소스가 대부분 차지
});

test('응원가 배분: 처음 보는 소스(espn)는 실행당 EXPLORE_SLOTS 건 탐색', () => {
  const stats = { kbo: { n: 411, h: 269 } };
  const queues = { kbo: mk('kbo', 65), espn: mk('espn', 9846), mlb: mk('mlb', 1234) };
  const out = allocateBySource(stats, queues, 30);
  assert.equal(out.filter((x) => x.startsWith('espn')).length >= EXPLORE_SLOTS, true);
  assert.equal(out.filter((x) => x.startsWith('mlb')).length >= EXPLORE_SLOTS, true);
  assert.equal(out.length, 30);
});

test('응원가 배분: 예산 초과 없음, 큐가 비면 있는 만큼만, 중복 없음', () => {
  const queues = { kbo: mk('kbo', 3), naver: mk('naver', 2) };
  const out = allocateBySource({ kbo: { n: 100, h: 60 }, naver: { n: 100, h: 5 } }, queues, 30);
  assert.deepEqual([...out].sort(), ['kbo0', 'kbo1', 'kbo2', 'naver0', 'naver1']);
  assert.equal(new Set(out).size, out.length);
  assert.deepEqual(allocateBySource({}, {}, 30), []);
  assert.equal(allocateBySource({}, { espn: mk('e', 50) }, 3).length, 3);
});

test('응원가 배분: 저성공 소스만 남아도 실행당 상한(LOW_YIELD_SLOTS)까지만', () => {
  const out = allocateBySource({ naver: { n: 442, h: 43 } }, { naver: mk('naver', 488) }, 30);
  assert.equal(out.length, LOW_YIELD_SLOTS);
});

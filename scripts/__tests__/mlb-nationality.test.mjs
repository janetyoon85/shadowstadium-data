import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDaysYmd, getMlbPitcherDecisionNats, getMlbHoldNats } from '../mlb-nationality.mjs';

// mlb-nationality.mjs는 캐시를 모듈 스코프 Map에 담아 재사용하는데(loadScheduleForDate 등),
// 이게 테스트 간에 새지 않게 매 테스트 실행마다 최소한 서로 다른 날짜/gamePk 조합을 써서
// 캐시 충돌을 피함(테스트 격리를 위해 dateYmd/gamePk를 케이스별로 유니크하게 둠).

function mockFetch(routes) {
  return async (url) => {
    for (const [pattern, body] of routes) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
        return { ok: true, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('addDaysYmd - 기본 하루 이동 + 월/년 경계', () => {
  assert.equal(addDaysYmd('2026-09-28', -1), '2026-09-27');
  assert.equal(addDaysYmd('2026-10-01', -1), '2026-09-30');
  assert.equal(addDaysYmd('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysYmd('2026-09-27', 1), '2026-09-28');
});

// 2026-09-29 실사고 재현: games.json의 date(KST)를 그대로 MLB 스케줄 API에 넘기면 저녁 경기
// 대부분이 미국 동부시각(ET) 기준으로 하루 전이라 매칭 실패하던 버그. 그 날짜(dateYmd) 자체론
// 스케줄에 없고 하루 전(dateYmd-1)에만 그 매치업이 있는 상황을 재현해서, findGamePk가 실제로
// date-1을 먼저 시도해 찾아내는지 검증.
test('getMlbPitcherDecisionNats - KST 날짜엔 없고 ET(하루 전) 날짜에만 있는 경기도 찾아냄', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/schedule\?sportId=1&date=2026-06-27/, { dates: [{ games: [{ gamePk: 999001, teams: { home: { team: { id: 120 } }, away: { team: { id: 121 } } } }] }] }],
    [/schedule\?sportId=1&date=2026-06-28/, { dates: [] }], // 당일(KST) 날짜엔 없음 — 실제 사고와 동일 조건.
    [/game\/999001\/feed\/live/, { liveData: { linescore: { teams: { home: { runs: 6 }, away: { runs: 4 } } }, decisions: { winner: { id: 1 }, loser: { id: 2 }, save: { id: 3 } } } }],
    [/people\?personIds=1,2,3/, { people: [{ id: 1, birthCountry: 'USA' }, { id: 2, birthCountry: 'Venezuela' }, { id: 3, birthCountry: 'Curacao' }] }],
  ]);
  const result = await getMlbPitcherDecisionNats('워싱턴', '뉴욕메츠', '2026-06-28', 6, 4);
  assert.equal(result.found, true);
  assert.equal(result.winNat, 'USA');
  assert.equal(result.loseNat, 'Venezuela');
  assert.equal(result.saveNat, 'Curacao');
});

// 실사고 재현(2026-09-29, "오타니는국적조회되는데... 야마모토국적 미국아니고일본인데?"): 같은
// 두 팀이 연속 시리즈를 치르면 findGamePk가 날짜 하루 오차 안에서도 "그럴듯한 다른 진짜 경기"를
// 찾아버릴 수 있어, 찾은 게임의 최종 스코어가 우리가 이미 아는 스코어와 다르면 완전히 다른 경기로
// 간주해 거부해야 함 — 그래야 전혀 무관한 다른 선수의 국적이 조용히 잘못 붙는 사고를 막음.
test('getMlbPitcherDecisionNats - 찾은 경기의 스코어가 안 맞으면 다른 경기로 간주해 found:false', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/schedule\?sportId=1&date=2026-08-09/, { dates: [{ games: [{ gamePk: 999003, teams: { home: { team: { id: 119 } }, away: { team: { id: 114 } } } }] }] }],
    [/schedule\?sportId=1&date=2026-08-10/, { dates: [] }],
    // 이 gamePk는 실제로는 다른 날의 다른 경기(스코어 7:2) — 우리가 아는 스코어(3:1)와 다름.
    [/game\/999003\/feed\/live/, { liveData: { linescore: { teams: { home: { runs: 7 }, away: { runs: 2 } } }, decisions: { winner: { id: 9 }, loser: { id: 8 } } } }],
    [/people\?personIds=/, { people: [{ id: 9, birthCountry: 'Japan' }, { id: 8, birthCountry: 'USA' }] }],
  ]);
  const result = await getMlbPitcherDecisionNats('LA다저스', '클리블랜드', '2026-08-10', 3, 1);
  assert.deepEqual(result, { found: false });
});

test('getMlbPitcherDecisionNats - 어느 날짜에도 매치업이 없으면 found:false (재시도 가능해야 함)', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/schedule\?sportId=1/, { dates: [] }],
  ]);
  const result = await getMlbPitcherDecisionNats('워싱턴', '뉴욕메츠', '2026-01-15');
  assert.deepEqual(result, { found: false });
});

test('getMlbPitcherDecisionNats - 팀명이 MLB_TEAM_ID에 없으면 found:false', async () => {
  const result = await getMlbPitcherDecisionNats('없는팀', '뉴욕메츠', '2026-06-01');
  assert.deepEqual(result, { found: false });
});

// 홀드는 개별 투수 국적 조회가 하나만 실패해도(예: people API가 그 ID만 빠뜨림) 배열에서 빼면
// 이후 인덱스가 밀려 호출부(zip)가 엉뚱한 투수와 매칭되므로, undefined를 그 자리에 남겨야 함.
test('getMlbHoldNats - 국적 조회 실패한 투수는 undefined로 자리만 유지(배열에서 제거하지 않음)', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/schedule\?sportId=1&date=2026-07-09/, { dates: [{ games: [{ gamePk: 999002, teams: { home: { team: { id: 108 } }, away: { team: { id: 147 } } } }] }] }],
    [/schedule\?sportId=1&date=2026-07-10/, { dates: [] }],
    [/game\/999002\/feed\/live/, {
      liveData: {
        linescore: { teams: { home: { runs: 5 }, away: { runs: 3 } } },
        boxscore: {
          teams: {
            home: {
              pitchers: [10, 11],
              players: {
                ID10: { stats: { pitching: { holds: 1 } } },
                ID11: { stats: { pitching: { holds: 1 } } },
              },
            },
            away: { pitchers: [], players: {} },
          },
        },
      },
    }],
    // people 응답에 ID11에 대한 국적이 아예 없음(누락 시뮬레이션) — ID10만 응답에 있음.
    [/people\?personIds=10,11/, { people: [{ id: 10, birthCountry: 'Japan' }] }],
  ]);
  const result = await getMlbHoldNats('LA에인절스', '뉴욕양키스', '2026-07-10', 5, 3);
  assert.equal(result.found, true);
  assert.deepEqual(result.home, ['Japan', undefined]);
});

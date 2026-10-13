import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachPlayerPids } from '../attach-player-pids.mjs';

test('리그와 pid 접두어가 안 맞는 기존 값은 제거된다(MLB 경기의 npb: 야마모토)', () => {
  const g = [{ league: 'MLB', home: 'LA다저스', away: '밀워키', gameId: 'g1', status: 'live', liveState: { pitcher: '야마모토', pitcherPid: 'npb:1700066' }, winPitcher: '야마모토', winPitcherPid: 'npb:1700066' }];
  attachPlayerPids(g);
  assert.equal(g[0].liveState.pitcherPid, undefined);
  assert.equal(g[0].winPitcherPid, undefined);
});

test('접두어가 맞는 값은 유지된다', () => {
  const g = [{ league: 'KBO', home: 'LG', away: 'KIA', gameId: 'g2', homePitcher: '임찬규', homePitcherPid: 'kbo:p:61101' }];
  attachPlayerPids(g);
  assert.equal(g[0].homePitcherPid, 'kbo:p:61101');
});

test('KBO·NPB 경기 안의 mlb: 선발 pid 도 제거된다', () => {
  const g = [{ league: 'NPB', home: '세이부', away: '닛폰햄', gameId: 'g3', homePitcher: '무라카미', homePitcherPid: 'mlb:808959' }];
  attachPlayerPids(g);
  assert.equal(g[0].homePitcherPid, undefined);
});

test('경기 단위 표(게임ID+이름)로 pid 를 붙인다', () => {
  const g = [{ league: 'KBO', home: 'LG', away: 'KIA', gameId: 'g4', highlights: { home: [{ player: '문성주', how: '2루타' }], away: [] } }];
  attachPlayerPids(g, { g4: { 문성주: { b: 'kbo:b:68119' } } });
  assert.equal(g[0].highlights.home[0].pid, 'kbo:b:68119');
});

test('홀드 투수도 같은 팀·이름으로 다른 경기의 pid 를 이어받는다(유리베)', () => {
  const g = [
    { league: 'MLB', home: '밀워키', away: 'LA다저스', gameId: 'a', holds: { home: [{ n: '유리베', pid: 'mlb:682842' }], away: [] } },
    { league: 'MLB', home: '밀워키', away: 'LA다저스', gameId: 'b', holds: { home: [{ n: '유리베' }], away: [] } },
  ];
  attachPlayerPids(g);
  assert.equal(g[1].holds.home[0].pid, 'mlb:682842');
});

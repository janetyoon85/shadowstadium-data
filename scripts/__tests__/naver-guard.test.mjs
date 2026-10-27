import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGuard, isNaverUrl, isBlockSignal, NaverCooldownError } from '../lib/naver-guard.mjs';

const NAVER = 'https://api-gw.sports.naver.com/schedule/games?x=1';
const mk = (fetchImpl, o = {}) => {
  const clock = { t: 1_000_000 };
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ng-')), 's.json');
  const g = createGuard({ realFetch: fetchImpl, now: () => clock.t, stateFile, sleep: async () => {}, log: () => {}, minGapMs: 0, jitterMs: 0, ...o });
  return { g, clock, stateFile };
};
const ok = async () => ({ status: 200 });
const reset = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNRESET' }; throw e; };

test('URL 판별 — 네이버 스포츠만 보호 대상', () => {
  assert.equal(isNaverUrl(NAVER), true);
  assert.equal(isNaverUrl('https://sports.naver.com/'), true);
  assert.equal(isNaverUrl('https://site.api.espn.com/x'), false);
  assert.equal(isNaverUrl('not a url'), false);
});
test('차단 신호 판별 — 연결 실패·타임아웃·429/403/503 만(404 는 아님)', () => {
  assert.equal(isBlockSignal(null, 429), true); assert.equal(isBlockSignal(null, 403), true); assert.equal(isBlockSignal(null, 503), true);
  assert.equal(isBlockSignal(null, 404), false); assert.equal(isBlockSignal(null, 200), false);
  const to = new Error('x'); to.name = 'TimeoutError'; assert.equal(isBlockSignal(to), true);
  assert.equal(isBlockSignal(new Error('boom')), false);
});
test('네이버 외 호스트는 그대로 통과(실패해도 카운트 안 함)', async () => {
  const { g } = mk(reset);
  for (let i = 0; i < 5; i++) await assert.rejects(g.guardedFetch('https://site.api.espn.com/x'));
  assert.equal(g.read().failures, 0);
});
test('연속 3회 실패 → 쿨다운 열림, 이후 요청은 네트워크 없이 즉시 NaverCooldownError', async () => {
  let calls = 0;
  const { g, clock } = mk(async () => { calls++; return reset(); });
  for (let i = 0; i < 3; i++) await assert.rejects(g.guardedFetch(NAVER));
  assert.equal(calls, 3);
  await assert.rejects(g.guardedFetch(NAVER), NaverCooldownError);
  assert.equal(calls, 3, '쿨다운 중에는 실제 요청을 보내지 않는다');
  clock.t += 10 * 60e3 + 1; // 10분 뒤 재시도 허용
  await assert.rejects(g.guardedFetch(NAVER), (e) => !(e instanceof NaverCooldownError));
  assert.equal(calls, 4);
});
test('성공하면 실패 카운트가 초기화되고, 429 도 실패로 센다', async () => {
  let mode = 'fail';
  const { g } = mk(async () => (mode === 'fail' ? { status: 429 } : { status: 200 }));
  await g.guardedFetch(NAVER); await g.guardedFetch(NAVER);
  assert.equal(g.read().failures, 2);
  mode = 'ok'; await g.guardedFetch(NAVER);
  assert.equal(g.read().failures, 0);
});
test('재차단 시 쿨다운 2배(10→20분), 상한 60분', async () => {
  const { g, clock } = mk(reset);
  const trip = async () => { for (let i = 0; i < 3; i++) await assert.rejects(g.guardedFetch(NAVER)); };
  await trip(); assert.equal(g.read().openUntil - clock.t, 10 * 60e3);
  clock.t += 10 * 60e3 + 1; await trip(); assert.equal(g.read().openUntil - clock.t, 20 * 60e3);
  for (let i = 0; i < 6; i++) { clock.t += 61 * 60e3; await trip(); }
  assert.equal(g.read().openUntil - clock.t, 60 * 60e3);
});
test('동시성 제한 — 동시에 2건까지만 실행', async () => {
  let running = 0, maxRunning = 0;
  const slow = async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 15)); running--; return { status: 200 }; };
  const { g } = mk(slow, { concurrency: 2 });
  await Promise.all(Array.from({ length: 8 }, () => g.guardedFetch(NAVER)));
  assert.equal(maxRunning, 2);
});
test('상태 파일 공유 — 다른 인스턴스(다른 프로세스 흉내)도 쿨다운을 본다', async () => {
  const a = mk(reset);
  for (let i = 0; i < 3; i++) await assert.rejects(a.g.guardedFetch(NAVER));
  const clock = a.clock;
  const b = createGuard({ realFetch: ok, now: () => clock.t, stateFile: a.stateFile, sleep: async () => {}, log: () => {}, minGapMs: 0, jitterMs: 0 });
  await assert.rejects(b.guardedFetch(NAVER), NaverCooldownError);
});

test('요청 계측 — 요청·실패·쿨다운 생략 건수를 센다', async () => {
  const { g } = mk(reset);
  for (let i = 0; i < 3; i++) await assert.rejects(g.guardedFetch(NAVER));
  await assert.rejects(g.guardedFetch(NAVER), NaverCooldownError);
  assert.deepEqual(g.stats, { n: 3, fail: 3, cooldownSkipped: 1 });
});

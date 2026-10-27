// 네이버 스포츠 API(api-gw.sports.naver.com 등) 요청 보호막(2026-10-27) — 네이버 의존도 절감 설계 P1.
// 2026-10-27 13:06 집 회선(NAS·PC)이 네이버에 연결 차단(ECONNRESET/시간 초과)된 사건의 재발 방지:
//  1) 요청 간격·동시성 제한 — 한 프로세스가 네이버를 한꺼번에 두드리지 않게 한다(기본 동시 2건, 요청 사이 0.4~0.7초).
//  2) 서킷 브레이커 — 연속 3번 "연결 단계" 실패(ECONNRESET·타임아웃·429·403·503)하면 이 컴퓨터에서 10분 동안 네이버 요청을 보내지 않는다
//     (재시도할 때마다 2배: 10→20→40→60분 상한). 성공하면 단계가 내려간다. 차단 중에 "두드려 보기"를 하지 않는 것이 핵심.
//  3) 상태는 임시 폴더 파일(`shadeside-naver-guard.json`)로 같은 컴퓨터의 여러 프로세스(러너·폴러 자식)가 공유한다 — 차단은 IP(=컴퓨터) 단위라 컴퓨터별 상태가 맞다.
// 사용: 네이버를 부르는 크롤러 스크립트 맨 위에 `import './lib/naver-guard.mjs';` (watch-429 와 같은 방식, 전역 fetch 를 감싼다).
// 쿨다운 중 동작: 기본은 `NaverCooldownError` 를 던진다. 네이버만 쓰는 스크립트(EXIT_ON_OPEN 목록)는 실패 처리(워크플로우 빨간불·알림 폭주) 대신
// "쿨다운 중 — 요청 생략" 로그를 남기고 정상 종료(0)한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class NaverCooldownError extends Error {
  constructor(until) {
    super(`NAVER_COOLDOWN until ${new Date(until).toISOString()}`);
    this.name = 'NaverCooldownError';
    this.until = until;
  }
}

const NAVER_HOST = /(^|\.)sports\.naver\.com$/i;
export const isNaverUrl = (input) => {
  try {
    return NAVER_HOST.test(new URL(typeof input === 'string' ? input : input?.url || String(input)).hostname);
  } catch {
    return false;
  }
};

// 연결 단계 실패인가(= 차단·과부하 신호). 4xx 중 404/400 같은 "없는 데이터"는 아니다.
export const isBlockSignal = (err, status) => {
  if (status === 429 || status === 403 || status === 503) return true;
  if (!err) return false;
  const code = err.cause?.code || err.code;
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'EAI_AGAIN'].includes(code)) return true;
  return err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed/i.test(String(err.message));
};

export function createGuard({
  realFetch,
  now = () => Date.now(),
  stateFile = process.env.NAVER_GUARD_STATE || path.join(os.tmpdir(), 'shadeside-naver-guard.json'),
  threshold = Number(process.env.NAVER_GUARD_THRESHOLD) || 3,
  baseCooldownMs = (Number(process.env.NAVER_GUARD_COOLDOWN_MIN) || 10) * 60e3,
  maxCooldownMs = 60 * 60e3,
  concurrency = Number(process.env.NAVER_CONCURRENCY) || 1,
  minGapMs = Number(process.env.NAVER_MIN_GAP_MS) || 1000,
  jitterMs = 500,
  // 요청 예산(하드 상한, 컴퓨터 단위로 공유) — 2026-10-27 차단 재발 방지. 넘으면 실패가 아니라 "예산 초과"로 요청을 보내지 않는다.
  limitPerMin = Number(process.env.NAVER_LIMIT_PER_MIN) || 25,
  limitPer10Min = Number(process.env.NAVER_LIMIT_PER_10MIN) || 140,
  limitPerHour = Number(process.env.NAVER_LIMIT_PER_HOUR) || 450,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = (m) => console.log(m),
} = {}) {
  let state = { failures: 0, level: 0, openUntil: 0, reqs: [] };
  const read = () => {
    try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch { /* 파일 없음 */ }
    return state;
  };
  const write = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* 쓰기 실패는 무시 */ } };

  const stats = { n: 0, fail: 0, cooldownSkipped: 0, budgetSkipped: 0 }; // 요청 계측(프로세스별) — 종료 시 로그 한 줄
  let active = 0;
  let lastStart = 0;
  const waiters = [];
  const acquire = async () => {
    while (active >= concurrency) await new Promise((r) => waiters.push(r));
    active++;
    const gap = lastStart + minGapMs + Math.random() * jitterMs - now();
    lastStart = Math.max(now(), lastStart + minGapMs);
    if (gap > 0) await sleep(gap);
  };
  const release = () => { active--; const w = waiters.shift(); if (w) w(); };

  const onFailure = () => {
    read();
    state.failures++;
    if (state.failures >= threshold) {
      state.level = Math.min(state.level + 1, 6);
      const ms = Math.min(baseCooldownMs * 2 ** (state.level - 1), maxCooldownMs);
      state.openUntil = now() + ms;
      state.failures = 0;
      log(`::warning title=네이버 쿨다운::연속 ${threshold}회 접속 실패 — ${Math.round(ms / 60e3)}분간 네이버 요청을 보내지 않습니다`);
    }
    write();
  };
  const onSuccess = () => {
    read();
    if (state.failures || state.level) {
      state.failures = 0;
      state.level = Math.max(0, state.level - 1);
      write();
    }
  };

  // 최근 요청 기록(ms) — 1시간 창. 파일에 남겨 같은 컴퓨터의 여러 프로세스(러너·폴러)가 같은 예산을 쓴다.
  const countSince = (ms) => { const t = now() - ms; return (state.reqs || []).filter((x) => x > t).length; };
  const overBudget = () => {
    read();
    const m = countSince(60e3), t10 = countSince(600e3), h = countSince(3600e3);
    if (m >= limitPerMin) return { until: now() + 30e3, why: `분당 ${m}/${limitPerMin}` };
    if (t10 >= limitPer10Min) return { until: now() + 120e3, why: `10분 ${t10}/${limitPer10Min}` };
    if (h >= limitPerHour) return { until: now() + 300e3, why: `시간당 ${h}/${limitPerHour}` };
    return null;
  };
  const recordRequest = () => {
    read();
    const t = now();
    state.reqs = [...(state.reqs || []).filter((x) => x > t - 3600e3), t].slice(-1500);
    write();
  };
  // 브라우저처럼 보이는 헤더(헤더 없는 요청은 네이버가 응답하지 않는 것으로 확인 — 2026-10-27: 기본 curl/Node 요청은 무응답, 브라우저 UA·Referer 를 붙이면 즉시 200).
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const withBrowserHeaders = (init) => {
    try {
      const h = new Headers(init?.headers || {});
      const ua = h.get('user-agent');
      if (!ua || !/mozilla/i.test(ua)) h.set('user-agent', BROWSER_UA);
      if (!h.get('referer')) h.set('referer', 'https://sports.naver.com/');
      if (!h.get('origin')) h.set('origin', 'https://sports.naver.com');
      if (!h.get('accept-language')) h.set('accept-language', 'ko-KR,ko;q=0.9');
      return { ...(init || {}), headers: h };
    } catch { return init; }
  };

  const guardedFetch = async (input, init) => {
    if (!isNaverUrl(input)) return realFetch(input, init);
    // 네이버 전면 정지 모드(NAVER_DISABLED=1, 2026-10-27): 네트워크 없이 즉시 쿨다운 오류 — ESPN 등 다른 원본만으로 도는 작업이 타임아웃을 기다리지 않게 한다.
    if (process.env.NAVER_DISABLED === '1') { stats.cooldownSkipped++; throw new NaverCooldownError(now() + 3600e3); }
    read();
    if (state.openUntil > now()) { stats.cooldownSkipped++; throw new NaverCooldownError(state.openUntil); }
    const ob = overBudget();
    if (ob) { stats.budgetSkipped = (stats.budgetSkipped || 0) + 1; log(`::warning title=네이버 요청 예산::${ob.why} — 요청 생략`); throw new NaverCooldownError(ob.until); }
    await acquire();
    const ob2 = overBudget(); // 대기 중 다른 프로세스가 예산을 썼을 수 있음
    if (ob2) { release(); stats.budgetSkipped = (stats.budgetSkipped || 0) + 1; throw new NaverCooldownError(ob2.until); }
    recordRequest();
    stats.n++;
    try {
      const res = await realFetch(input, withBrowserHeaders(init));
      if (isBlockSignal(null, res.status)) { stats.fail++; onFailure(); }
      else onSuccess();
      return res;
    } catch (e) {
      if (isBlockSignal(e)) { stats.fail++; onFailure(); }
      throw e;
    } finally {
      release();
    }
  };
  const remaining = () => { read(); return { perMin: limitPerMin - countSince(60e3), per10Min: limitPer10Min - countSince(600e3), perHour: limitPerHour - countSince(3600e3) }; };
  return { guardedFetch, read, getState: () => ({ ...state }), stats, remaining };
}

// 네이버만 쓰는 스크립트: 쿨다운 중이면 실패가 아니라 정상 종료한다(워크플로우 빨간불·실패 알림 방지).
const EXIT_ON_OPEN = new Set(['fetch-schedule.mjs', 'fetch-standings.mjs', 'fetch-basketball-stats.mjs', 'backfill-baseball-pids.mjs', 'backfill-naver-box-fg.mjs']);

if (!globalThis.__naverGuard) {
  globalThis.__naverGuard = true;
  const guard = createGuard({ realFetch: globalThis.fetch });
  const exitOnOpen = EXIT_ON_OPEN.has(path.basename(process.argv[1] || ''));
  process.on('exit', () => {
    const { n, fail, cooldownSkipped, budgetSkipped } = guard.stats;
    if (n || cooldownSkipped || budgetSkipped) console.log(`[naver-guard] 네이버 요청 ${n}건(접속 실패 ${fail}건, 쿨다운 생략 ${cooldownSkipped}건, 예산 초과 생략 ${budgetSkipped || 0}건) — ${path.basename(process.argv[1] || '')}`);
  });
  globalThis.fetch = async (input, init) => {
    try {
      return await guard.guardedFetch(input, init);
    } catch (e) {
      if (e instanceof NaverCooldownError && exitOnOpen) {
        console.log(`[naver-guard] 네이버 쿨다운 중(${new Date(e.until).toISOString()}까지) — 요청 생략, 정상 종료`);
        process.exit(0);
      }
      throw e;
    }
  };
}

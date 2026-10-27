// 알림 감시 루프(2026-10-27) — fcm-player-alerts 워크플로우가 분당 한 번 시작해 약 55초 동안 10초마다 알림 5종을 반복 확인한다.
// 이전: 크롤러 커밋 → (cron 대기 평균 30초) → 알림 작업이 커밋된 games.json 을 읽음 → 이벤트 후 평균 약 2분.
// 지금: 매 반복마다 NAS 폴러가 올린 신선한 이벤트(비공개 events/games)와 농구 라이브 노드를 받아 `.live-overlay.json` 으로 내려 두고,
//       알림 스크립트들이 커밋된 데이터 위에 덮어써서 감지한다(lib/live-overlay.mjs — 퇴행 없는 덮어쓰기). 목표: 이벤트 후 약 20~40초.
// 안전: 오버레이를 못 받으면(NAS 정지·네트워크 오류) 알림 스크립트가 예전처럼 커밋된 파일만 쓴다. 중복 방지(sent-*.json 키)는 스크립트들이 그대로 담당한다.
// 환경변수: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL, [ALERT_LOOP_SECONDS=55], [ALERT_LOOP_INTERVAL=10], [DRY_RUN]
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from './firebase-admin-compat.mjs';
import { OVERLAY_FILE } from './lib/live-overlay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/+$/, '');
const TOTAL_MS = (Number(process.env.ALERT_LOOP_SECONDS) || 55) * 1000;
const EVERY_MS = (Number(process.env.ALERT_LOOP_INTERVAL) || 10) * 1000;
const SCRIPTS = ['notify-player-events', 'notify-basketball-final', 'notify-team-final', 'notify-team-highlights', 'notify-team-live'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let app = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT && DB) app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
} catch (e) {
  log('Firebase 초기화 실패(오버레이 없이 진행):', String(e.message).slice(0, 80));
}

// 농구 라이브 노드(느린 + 빠른 경로)를 앱과 같은 규칙으로 합친다: 빠른 노드가 90초 안이고 더 최신이면 그 값을 위에 덮어쓴다.
export function mergeBk(live, nowMs = Date.now()) {
  const toMap = (n) => { const m = {}; if (n && n.games && typeof n.games === 'object') for (const v of Object.values(n.games)) if (v && typeof v.id === 'string') m[v.id] = v; return m; };
  const slow = live && live.basketball, fast = live && live.basketball_fast;
  const slowOk = !!slow && typeof slow.ts === 'number';
  const fastFresh = !!fast && typeof fast.ts === 'number' && nowMs - fast.ts < 90e3;
  if (!slowOk && !fastFresh) return null;
  const bk = slowOk ? toMap(slow) : {};
  let ts = slowOk ? slow.ts : 0;
  if (fastFresh && (!slowOk || fast.ts > slow.ts - 30e3)) { Object.assign(bk, toMap(fast)); ts = Math.max(ts, fast.ts); }
  return { bk, bkTs: ts };
}

async function refreshOverlay() {
  if (!app || !DB) return false;
  try {
    const token = (await app.options.credential.getAccessToken()).access_token;
    const [evRes, liveRes] = await Promise.all([
      fetch(`${DB}/events/games.json`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }),
      fetch(`${DB}/live.json`, { signal: AbortSignal.timeout(6000) }),
    ]);
    const out = { ts: 0, games: {}, bk: {}, bkTs: 0 };
    if (evRes.ok) {
      const ev = await evRes.json();
      if (ev && typeof ev.ts === 'number' && ev.games && typeof ev.games === 'object') {
        out.ts = ev.ts;
        for (const v of Object.values(ev.games)) if (v && typeof v.gameId === 'string') out.games[v.gameId] = v;
      }
    }
    if (liveRes.ok) {
      const m = mergeBk(await liveRes.json());
      if (m) { out.bk = m.bk; out.bkTs = m.bkTs; }
    }
    await fs.writeFile(path.join(ROOT, OVERLAY_FILE), JSON.stringify(out));
    return true;
  } catch (e) {
    log('오버레이 갱신 실패(기존 방식으로 진행):', String(e.message).slice(0, 80));
    return false;
  }
}

function runScript(name) {
  return new Promise((resolve) => {
    const child = spawn('node', [`scripts/${name}.mjs`], { cwd: ROOT, env: process.env, stdio: 'inherit' });
    const timer = setTimeout(() => { log(`${name} 시간 초과 — 중단`); child.kill('SIGKILL'); }, 40000);
    child.on('close', (code) => { clearTimeout(timer); resolve(code); });
  });
}

async function main() {
  const end = Date.now() + TOTAL_MS;
  let i = 0;
  for (;;) {
    const t0 = Date.now();
    i++;
    const ok = await refreshOverlay();
    for (const name of SCRIPTS) {
      const code = await runScript(name);
      if (code !== 0) log(`${name} 종료 코드 ${code}`);
    }
    log(`반복 ${i} 완료 (${((Date.now() - t0) / 1000).toFixed(1)}s, 오버레이 ${ok ? '사용' : '없음'})`);
    if (Date.now() + EVERY_MS > end) break;
    await sleep(Math.max(1000, EVERY_MS - (Date.now() - t0)));
  }
  await fs.rm(path.join(ROOT, OVERLAY_FILE), { force: true }).catch(() => {});
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();

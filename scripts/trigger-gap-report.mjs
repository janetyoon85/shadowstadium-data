// cron-job.org 트리거 누락 감시 → Discord 운영 알림(2026-10-27). cron-job.org 가 메일로만 알리던 "Cronjob failed" 를 GitHub 쪽 실행 기록만으로 감지한다.
// 원리: cron-job.org 가 workflow_dispatch 로 부르는 워크플로우는 호출마다 실행 기록이 생긴다 → 정해진 주기보다 호출 간격이 크게 벌어지면 그 사이 호출이 실패(누락)한 것.
// rate-limit-alert 워크플로우(10분 주기)에서 같이 돈다. 상태(마지막 점검 시각, 멈춤 알림 쿨다운)는 ops-logs 브랜치의 ops-trigger-state.json.
// 실행: node scripts/trigger-gap-report.mjs [--dry]   (GITHUB_TOKEN, GITHUB_REPOSITORY, DISCORD_WEBHOOK_URL)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withOpsLogs } from './lib/ops-log.mjs';

// [워크플로우, cron-job.org 호출 주기(초)]
export const WATCHED = [
  ['fetch-schedule', 60], ['fetch-basketball', 60], ['fcm-player-alerts', 60], ['fcm-reminders', 60],
  ['fetch-espn-soccer-leagues', 60], ['fetch-espn-world-soccer-leagues', 60], ['fetch-espn-asia-soccer-leagues', 60],
  ['fetch-asiangames-baseball', 60], ['fetch-asiangames-football', 60],
  ['fetch-espn-olympic-football', 300], ['fetch-mlb-aaa-baseball', 300], ['fetch-mlb-winter-baseball', 300],
];
const STALL_COOLDOWN_MS = 30 * 60e3;
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);

// 호출 시각(ms, 오름차순)에서 (fromMs, toMs] 안에 끝나는 간격 중 주기의 1.6배를 넘는 것을 "누락"으로 센다. 누락 시각(추정)을 돌려준다.
export function findMisses(times, intervalS, fromMs, toMs) {
  const I = intervalS * 1000;
  const misses = [];
  for (let i = 1; i < times.length; i++) {
    const end = times[i];
    if (end <= fromMs || end > toMs) continue;
    const gap = end - times[i - 1];
    if (gap > I * 1.6) {
      const n = Math.max(1, Math.round(gap / I) - 1);
      for (let k = 1; k <= n; k++) misses.push(times[i - 1] + k * I);
    }
  }
  return misses;
}

export function plan(byWf, state, nowMs) {
  const toMs = nowMs - 90e3; // 막 들어온 호출이 아직 기록되지 않았을 수 있어 여유를 둔다
  const fromMs = state.cursorMs || nowMs - 30 * 60e3;
  const stalled = { ...(state.stalled || {}) };
  const lines = [];
  const stallLines = [];
  for (const [wf, intervalS] of WATCHED) {
    const times = (byWf[wf] || []).slice().sort((a, b) => a - b);
    const m = findMisses(times, intervalS, fromMs, toMs);
    if (m.length) lines.push(`• ${wf} — ${m.length}회 누락 (${m.slice(0, 4).map(kst).join(', ')}${m.length > 4 ? ' …' : ''} KST)`);
    const last = times.length ? times[times.length - 1] : 0;
    const stallAfter = Math.max(5 * 60e3, intervalS * 1000 * 4);
    if (nowMs - last > stallAfter && nowMs - (stalled[wf] || 0) > STALL_COOLDOWN_MS) {
      stalled[wf] = nowMs;
      stallLines.push(`• ${wf} — 마지막 호출이 ${Math.round((nowMs - last) / 60e3)}분 전 (주기 ${intervalS}초) ⛔ 트리거가 멈춘 것 같아요`);
    }
  }
  return { lines, stallLines, next: { cursorMs: toMs, stalled } };
}

async function listDispatchTimes(repo, token, wf, sinceMs) {
  const since = new Date(sinceMs).toISOString().slice(0, 19) + 'Z';
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}.yml/runs?per_page=100&page=${page}&created=>=${since}&event=workflow_dispatch`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`${wf} HTTP ${r.status}`);
    const j = await r.json();
    out.push(...j.workflow_runs.map((x) => new Date(x.created_at).getTime()));
    if (j.workflow_runs.length < 100) break;
  }
  return out;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || 'janetyoon85/shadowstadium-data';
  const hook = process.env.DISCORD_WEBHOOK_URL;
  const nowMs = Date.now();
  let state = {};
  withOpsLogs((dir) => {
    const fp = path.join(dir, 'ops-trigger-state.json');
    if (fs.existsSync(fp)) state = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return false;
  }, 'noop');
  const fromMs = state.cursorMs || nowMs - 30 * 60e3;
  const byWf = {};
  for (const [wf] of WATCHED) byWf[wf] = await listDispatchTimes(repo, token, wf, fromMs - 10 * 60e3);
  const { lines, stallLines, next } = plan(byWf, state, nowMs);
  const parts = [];
  if (stallLines.length) parts.push(stallLines.join('\n'));
  if (lines.length) parts.push(lines.join('\n'));
  const message = parts.length ? `🟠 ShadeSide — cron-job.org 트리거 누락 감지\n${parts.join('\n')}\n(호출이 빠진 만큼 그 순간의 갱신이 늦어졌을 수 있어요. 간헐적 1~2회는 GitHub API 일시 오류일 때가 많아요)` : '';
  if (dry) {
    console.log(message || '(누락 없음)');
    return;
  }
  if (message && hook) {
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, content: message }) });
    console.log('Discord', r.status);
    if (!r.ok) {
      process.exitCode = 1; // 상태를 갱신하지 않아 다음 실행이 재시도
      return;
    }
  } else if (message) console.log(message);
  const saved = withOpsLogs((dir) => {
    fs.writeFileSync(path.join(dir, 'ops-trigger-state.json'), JSON.stringify(next, null, 2) + '\n');
    return true;
  }, 'trigger-gap: 상태 갱신');
  if (!saved) {
    console.log('::warning::상태 저장 실패');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();

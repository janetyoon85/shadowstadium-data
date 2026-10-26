// ops-logs 의 429 기록을 읽어 Discord 운영 알림으로 보낸다(cron-job.org 가 10분마다 rate-limit-alert 워크플로우를 호출).
// 같은 도메인은 COOLDOWN 동안 한 번만 알리고, 그 사이 쌓인 건수는 다음 알림에 합산한다. 기록은 7일 지나면 정리.
// 실행: node scripts/report-429.mjs [--dry]   (DISCORD_WEBHOOK_URL)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withOpsLogs } from './lib/ops-log.mjs';

const COOLDOWN_MS = 30 * 60e3;
const KEEP_MS = 7 * 86400e3;
const kst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

export function plan(events, state, nowMs) {
  const cursor = state.cursor || '1970-01-01T00:00:00.000Z';
  const fresh = events.filter((e) => e.ts > cursor);
  const byHost = new Map();
  for (const e of fresh) {
    const h = byHost.get(e.host) || { n: 0, wfs: new Set(), last: e.ts };
    h.n += e.n;
    h.wfs.add(e.wf);
    if (e.ts > h.last) h.last = e.ts;
    byHost.set(e.host, h);
  }
  const cooldown = { ...(state.cooldown || {}) };
  const suppressed = { ...(state.suppressed || {}) };
  const lines = [];
  for (const [host, h] of byHost) {
    const total = h.n + (suppressed[host] || 0);
    if (nowMs - (cooldown[host] || 0) < COOLDOWN_MS) {
      suppressed[host] = total; // 쿨다운 중 — 합산만 해 두었다가 다음 알림에 포함
      continue;
    }
    cooldown[host] = nowMs;
    delete suppressed[host];
    lines.push(`• ${host} — ${total}회 · ${[...h.wfs].slice(0, 3).join(', ')} · 최근 ${kst(h.last)} KST`);
  }
  const newest = fresh.reduce((m, e) => (e.ts > m ? e.ts : m), cursor);
  return { lines, next: { cursor: newest, cooldown, suppressed }, freshCount: fresh.length };
}

const parseEvents = (raw) => raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const read = (dir) => {
  const fp = path.join(dir, 'ops-429.jsonl');
  return { events: parseEvents(fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : ''), state: JSON.parse(fs.readFileSync(path.join(dir, 'ops-429-state.json'), 'utf8')) };
};

async function main() {
  const dry = process.argv.includes('--dry');
  const hook = process.env.DISCORD_WEBHOOK_URL;
  // 1단계: 읽기만 하고 알릴 내용을 계산 → 2단계: Discord 전송 → 3단계: 전송이 성공했을 때만 상태(cursor/쿨다운)와 기록 정리를 반영.
  // 전송이 실패하면 상태가 그대로라 다음 실행(10분 뒤)이 같은 알림을 다시 시도한다.
  let computed = null;
  withOpsLogs((dir) => {
    const { events, state } = read(dir);
    computed = { ...plan(events, state, Date.now()), old: events.filter((e) => Date.now() - new Date(e.ts).getTime() >= KEEP_MS).length };
    return false;
  }, 'noop');
  if (!computed) {
    console.log('::warning::ops-logs 읽기 실패 — 다음 실행에서 다시 시도');
    return;
  }
  const { lines, next, freshCount, old } = computed;
  const message = lines.length ? `🟡 ShadeSide — 요청 제한(HTTP 429) 감지\n${lines.join('\n')}\n(30분 안의 같은 도메인은 합산해 다음 알림에 포함)` : '';
  if (dry) {
    console.log(message || '(알릴 것 없음)', '| 신규', freshCount, '정리대상', old);
    return;
  }
  if (!freshCount && !old) return;
  if (message) {
    if (!hook) {
      console.log(message);
      return;
    }
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, content: message }) });
    console.log('Discord', r.status);
    if (!r.ok) {
      process.exitCode = 1; // 상태를 갱신하지 않아 다음 실행이 같은 알림을 재시도
      return;
    }
  }
  const saved = withOpsLogs((dir) => {
    const { events, state } = read(dir);
    // 계산 이후 새로 쌓인 기록은 cursor 이후라 그대로 남는다. 7일 지난 기록 정리 + 상태 반영.
    const keep = events.filter((e) => Date.now() - new Date(e.ts).getTime() < KEEP_MS);
    fs.writeFileSync(path.join(dir, 'ops-429.jsonl'), keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''));
    const cursor = next.cursor > (state.cursor || '') ? next.cursor : state.cursor;
    fs.writeFileSync(path.join(dir, 'ops-429-state.json'), JSON.stringify({ ...state, ...next, cursor }, null, 2) + '\n');
    return true;
  }, 'report-429: 상태 갱신');
  if (!saved) {
    console.log('::warning::상태 저장 실패 — 같은 알림이 한 번 더 갈 수 있음');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();

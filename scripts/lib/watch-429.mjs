// 크롤러가 HTTP 429(요청 제한)를 받으면 기록해 두었다가 종료할 때 ops-logs 브랜치에 남긴다(2026-10-27).
// scripts/report-429.mjs 가 이 기록을 Discord 운영 알림으로 보낸다. 사용: 크롤러 스크립트 맨 위에 `import './lib/watch-429.mjs';` 한 줄.
// 원칙: 크롤러 동작을 절대 바꾸거나 막지 않는다 — fetch 응답은 그대로 돌려주고, 기록 실패는 조용히 무시한다. 429 가 없으면 아무 일도 안 한다.
import path from 'node:path';
import { withOpsLogs } from './ops-log.mjs';
import fs from 'node:fs';

const hits = new Map(); // host → { n, paths: Set }

export function recordHit(url, status) {
  if (status !== 429) return;
  let host = 'unknown';
  let p = '';
  try {
    const u = new URL(typeof url === 'string' ? url : url?.url || String(url));
    host = u.hostname;
    p = u.pathname.slice(0, 60); // 쿼리(API 키가 들어갈 수 있음)는 기록하지 않는다
  } catch { /* ignore */ }
  const h = hits.get(host) || { n: 0, paths: new Set() };
  h.n++;
  if (h.paths.size < 3) h.paths.add(p);
  hits.set(host, h);
}

if (!globalThis.__watch429) {
  globalThis.__watch429 = true;
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await orig(input, init);
    try { recordHit(typeof input === 'string' ? input : input?.url, res.status); } catch { /* ignore */ }
    return res;
  };
  process.on('exit', () => {
    if (!hits.size) return;
    const wf = process.env.GITHUB_WORKFLOW || path.basename(process.argv[1] || 'script');
    const ts = new Date().toISOString();
    const lines = [...hits].map(([host, h]) => JSON.stringify({ ts, wf, run: process.env.GITHUB_RUN_ID || '', host, n: h.n, paths: [...h.paths] }));
    for (const [host, h] of hits) console.log(`::warning title=HTTP 429::${host} ${h.n}회 (${wf})`);
    if (!process.env.GITHUB_ACTIONS && process.env.OPS_LOG_FORCE !== '1') return; // 로컬 실행은 기록하지 않음
    try {
      withOpsLogs((dir) => {
        fs.appendFileSync(path.join(dir, 'ops-429.jsonl'), lines.join('\n') + '\n');
        return true;
      }, `429: ${wf}`);
    } catch (e) {
      console.log('::warning::watch-429 기록 실패(무시): ' + String(e.message).slice(0, 100));
    }
  });
}

// 1분 주기 크롤러의 최근 24시간 실행 시간 집계 → Discord 운영 알림(하루 1회). "1분을 자주 넘는 크롤러"를 찾아 분산 필요 여부를 판단하는 근거.
// 실행: node scripts/crawler-timing-report.mjs [--dry] [--hours=24]   (GITHUB_TOKEN, GITHUB_REPOSITORY, DISCORD_WEBHOOK_URL)
// 소요 시간 = 실행 시작(run_started_at)부터 종료(updated_at)까지 — 대기 시간은 제외, 성공한 실행만. 취소·실패는 건수로만 센다.
const WORKFLOWS = [
  ['fetch-schedule', 'KBO·K리그 일정'],
  ['fetch-basketball', '농구'],
  ['fcm-player-alerts', '선수·팀 알림'],
  ['fcm-reminders', '리마인더'],
  ['fetch-espn-soccer-leagues', 'ESPN 해외축구 15'],
  ['fetch-espn-world-soccer-leagues', 'ESPN 월드 21'],
  ['fetch-espn-asia-soccer-leagues', 'ESPN 아시아 3'],
  ['fetch-asiangames-baseball', '아시안게임 야구'],
  ['fetch-asiangames-football', '아시안게임 축구'],
];

export function summarize(runs) {
  const ok = runs.filter((r) => r.conclusion === 'success' && r.run_started_at).map((r) => (new Date(r.updated_at) - new Date(r.run_started_at)) / 1000).sort((a, b) => a - b);
  const q = (p) => (ok.length ? Math.round(ok[Math.min(ok.length - 1, Math.floor(ok.length * p))]) : null);
  const count = (c) => runs.filter((r) => r.conclusion === c).length;
  return {
    total: runs.length,
    success: ok.length,
    cancelled: count('cancelled'),
    failure: count('failure'),
    median: q(0.5),
    p90: q(0.9),
    max: ok.length ? Math.round(ok[ok.length - 1]) : null,
    over60: ok.length ? Math.round((ok.filter((s) => s > 60).length / ok.length) * 100) : null,
  };
}

async function listRuns(repo, token, wf, sinceIso) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}.yml/runs?per_page=100&page=${page}&created=>=${sinceIso}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`${wf} HTTP ${r.status}`);
    const j = await r.json();
    out.push(...j.workflow_runs.filter((x) => x.status === 'completed'));
    if (j.workflow_runs.length < 100) break;
  }
  return out;
}

export function format(rows, hours) {
  const lines = rows.map(({ label, s }) => {
    if (!s.total) return `• ${label} — 실행 없음`;
    const flag = s.over60 !== null && s.over60 >= 30 ? ' ⚠️' : '';
    return `• ${label} — 중앙값 ${s.median ?? '-'}초 · p90 ${s.p90 ?? '-'}초 · 최대 ${s.max ?? '-'}초 · 60초 초과 ${s.over60 ?? '-'}% · 성공 ${s.success}/취소 ${s.cancelled}/실패 ${s.failure}${flag}`;
  });
  return `📊 ShadeSide — 1분 주기 크롤러 소요 시간(최근 ${hours}시간)\n${lines.join('\n')}\n⚠️ = 60초 초과 비율 30% 이상(분산·최적화 검토 대상)`;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const hours = Number((process.argv.find((a) => a.startsWith('--hours=')) || '--hours=24').split('=')[1]);
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || 'janetyoon85/shadowstadium-data';
  const since = new Date(Date.now() - hours * 3600e3).toISOString().slice(0, 19) + 'Z';
  const rows = [];
  for (const [wf, label] of WORKFLOWS) rows.push({ label, s: summarize(await listRuns(repo, token, wf, since)) });
  const msg = format(rows, hours);
  console.log(msg);
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!dry && hook) {
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, content: msg }) });
    console.log('Discord', r.status);
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) await main();

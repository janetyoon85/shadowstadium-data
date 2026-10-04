// 운영 점검(2026-10-04) — 조용히 비는/멈추는 데이터를 찾아 Discord로 알림. 이상이 있을 때만 발송.
//  1 로고 오매칭 의심  3 로고 URL 깨짐  2 신규 팀/구장 로고·사진 누락  4 신규 팀/구장 영문명 누락
//  5 날짜 지난 예정/진행중 경기(정체)  6 리그 경기 수 급감  8 워크플로 연속실패/정체(푸시 포함)  9 ScraperAPI 예산
// 첫 실행은 현재 상태를 baseline으로 기록만 하고 알리지 않음 → 이후 "새로 생긴" 문제만 알림.
// 실행: node scripts/ops-health-check.mjs [--dry]   (DISCORD_WEBHOOK_URL, GITHUB_TOKEN, GITHUB_REPOSITORY 환경변수)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const STATE_FILE = 'ops-health-state.json';
const state = J(STATE_FILE, null);
const first = !state;
const st = state || { baseline: {}, alerted: {}, leagueCounts: {} };
const now = Date.now();
const kstToday = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

const gamesRaw = J('games.json', []);
const games = Array.isArray(gamesRaw) ? gamesRaw : gamesRaw.games || [];
const logos = J('team-logos.json', {});
const teamEn = J('team-name-en.json', {});
const venuePhotos = J('venue-photos.json', {});
const venueEn = J('venue-name-en.json', {});

// issues: key -> { group, text }. baselineGroups: 이 그룹은 첫 실행 baseline 대상(새로 생긴 것만 알림).
const issues = new Map();
const add = (group, key, text, useBaseline = false) => issues.set(`${group}:${key}`, { group, text, useBaseline });

// 1) 로고 오매칭 의심 — 같은 로고 URL이 영문명이 서로 다른 팀들에 쓰임(5곳 초과는 공용 플레이스홀더로 보고 제외)
{
  const by = {};
  for (const [k, u] of Object.entries(logos)) if (u) (by[u] ??= []).push(k);
  for (const [u, ks] of Object.entries(by)) {
    if (ks.length < 2 || ks.length > 5) continue;
    const es = new Set(ks.map((k) => (teamEn[k.split('|')[0]] || k).toLowerCase()));
    const nm = ks.map((k) => k.split('|')[0]);
    if (nm.some((a) => nm.some((b) => a !== b && (a.includes(b) || (a.split(' ')[0].length >= 3 && a.split(' ')[0] === b.split(' ')[0]))))) continue; // 별칭(스탕다르 리에주/스탕다르, 멜버른 FC/멜버른 빅토리)
    if (es.size > 1) add('로고 중복(오매칭 의심)', [...ks].sort().join('/'), ks.join(' = '), true);
  }
}

// 2·4) 최근/예정 경기(오늘 -7일 ~ +14일)의 팀·구장 누락
{
  const lo = addDays(kstToday, -7), hi = addDays(kstToday, 14);
  const teams = new Map(), venues = new Map();
  for (const g of games) {
    if (!g.date || g.date < lo || g.date > hi) continue;
    for (const n of [g.home, g.away]) if (n) teams.set(n, g.league);
    if (g.venueId) venues.set(g.venueId, g.stadium || g.venueId);
  }
  for (const [n, lg] of teams) {
    const base = n.replace(/\s*\((남자|여자)\)$/, '');
    if ([n, base, `${base}|Baseball`, `${base}|Soccer`].some((k) => k in logos && logos[k] === null)) continue; // 의도적 null(로고 없음 확인됨)
    const hasLogo = logos[n] || logos[base] || logos[`${base}|Baseball`] || logos[`${base}|Soccer`];
    if (!hasLogo) add('팀 로고 없음', n, `${n} (${lg})`, true);
    if (!teamEn[n] && !teamEn[base]) add('팀 영문명 없음', n, `${n} (${lg})`, true);
  }
  for (const [id, nm] of venues) {
    if (!venuePhotos[id]) add('구장 사진 없음', id, `${nm} [${id}]`, true);
    if (!venueEn[id]) add('구장 영문명 없음', id, `${nm} [${id}]`, true);
  }
}

// 3) 로고 URL 생존 — 외부 호스트(나무위키/위키미디어/raw)는 매번 전수, TheSportsDB는 실행마다 60개씩 순환 검사
{
  const urls = [...new Set(Object.values(logos).filter(Boolean))];
  const ext = urls.filter((u) => !u.includes('r2.thesportsdb.com'));
  const tsdb = urls.filter((u) => u.includes('r2.thesportsdb.com'));
  const slot = Math.floor(now / (6 * 3600e3)) % Math.max(1, Math.ceil(tsdb.length / 60));
  const targets = [...ext, ...tsdb.slice(slot * 60, slot * 60 + 60)];
  const nameOf = (u) => Object.entries(logos).filter(([, v]) => v === u).map(([k]) => k.split('|')[0]).join('/');
  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const u = targets[i++];
      try {
        const r = await fetch(u, { headers: { 'User-Agent': 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)', Referer: 'https://namu.wiki/', Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) });
        const ct = r.headers.get('content-type') || '';
        if ([403, 404, 410].includes(r.status) || (r.ok && !ct.startsWith('image/'))) add('로고 URL 깨짐', u, `${nameOf(u)} (${r.status} ${ct.split(';')[0]})`);
      } catch { /* 일시적 네트워크 오류는 무시 */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// 5) 정체 경기 — 어제 이전 날짜인데 예정/진행중
{
  const cut = addDays(kstToday, -1);
  for (const g of games) {
    if (g.date && g.date < cut && (g.status === 'scheduled' || g.status === 'live')) {
      add('정체 경기(날짜 지남)', g.gameId || `${g.date}${g.home}${g.away}`, `${g.date} ${g.league} ${g.home} vs ${g.away} (${g.status})`, true);
    }
  }
}

// 6) 리그별 경기 수 급감(직전 실행 대비 20%↓, 10건 이상 리그)
{
  const cnt = {};
  for (const g of games) cnt[g.league] = (cnt[g.league] || 0) + 1;
  for (const [lg, prev] of Object.entries(st.leagueCounts)) {
    const cur = cnt[lg] || 0;
    if (prev >= 10 && cur < prev * 0.8) add('리그 경기 수 급감', lg, `${lg}: ${prev} → ${cur}`);
  }
  st.leagueCounts = cnt;
}

// 8) 워크플로 점검 — 최근 3회 연속 실패 또는 성공 없이 정체(주기×배수 초과). 푸시 발송 워크플로 포함.
const WF = {
  'fetch-schedule': 30, 'fetch-espn-world-soccer-leagues': 45, 'fetch-espn-asia-soccer-leagues': 45,
  'fcm-player-alerts': 30, 'fcm-reminders': 30, 'fetch-basketball': 45,
  'backfill-player-photos': 180, 'backfill-player-ko-names': 120, 'backfill-cheer-songs': 720,
  'fetch-basketball-stats': 180, 'backfill-basketball-players': 180, 'backfill-basketball-wikidata': 180,
};
{
  const repo = process.env.GITHUB_REPOSITORY || 'janetyoon85/shadowstadium-data';
  const headers = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  for (const [wf, maxMin] of Object.entries(WF)) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}.yml/runs?per_page=10&status=completed`, { headers });
      if (!r.ok) { add('워크플로 조회 실패', wf, `${wf}: HTTP ${r.status}`); continue; }
      const runs = (await r.json()).workflow_runs.filter((x) => x.conclusion !== 'cancelled' && x.conclusion !== 'skipped');
      if (runs.length >= 3 && runs.slice(0, 3).every((x) => x.conclusion === 'failure')) add('워크플로 연속 실패', wf, `${wf}: 최근 3회 연속 실패`);
      const ok = runs.find((x) => x.conclusion === 'success');
      const age = ok ? (now - Date.parse(ok.updated_at)) / 60000 : Infinity;
      if (age > maxMin) add('워크플로 정체', wf, `${wf}: 마지막 성공 ${ok ? Math.round(age) + '분 전' : '없음'} (기준 ${maxMin}분)`);
    } catch (e) { add('워크플로 조회 실패', wf, `${wf}: ${e.message}`); }
  }
}

// 9) ScraperAPI 월 예산(900건 캡) 80% 이상
{
  const b = J('.wbsc-scraperapi-budget.json', null);
  if (b && b.requestsUsed >= 720) add('ScraperAPI 예산', b.month, `${b.month}: ${b.requestsUsed}/900건 사용`);
}

// ---- 판정 ----
const current = {};
for (const [k, v] of issues) (current[v.group] ??= []).push(k);
if (first) {
  for (const [k, v] of issues) if (v.useBaseline) st.baseline[k] = true;
}
const DAY = 24 * 3600e3;
const toSend = [];
for (const [k, v] of issues) {
  if (v.useBaseline && st.baseline[k]) continue;
  const at = st.alerted[k];
  if (at && now - at < DAY) continue;
  toSend.push([k, v]);
}
for (const k of Object.keys(st.alerted)) if (!issues.has(k)) delete st.alerted[k]; // 해소되면 재발 시 다시 알림
for (const k of Object.keys(st.baseline)) if (!issues.has(k)) delete st.baseline[k];

console.log(`[ops] issues=${issues.size} baselineSkipped=${[...issues].filter(([k, v]) => v.useBaseline && st.baseline[k]).length} toSend=${toSend.length}${first ? ' (첫 실행: baseline 기록)' : ''}`);
for (const [g, ks] of Object.entries(current)) console.log(`  ${g}: ${ks.length}`);

if (toSend.length && !first) {
  const byGroup = {};
  for (const [, v] of toSend) (byGroup[v.group] ??= []).push(v.text);
  let msg = `🟠 ShadeSide 운영 점검 — 이상 ${toSend.length}건\n`;
  for (const [g, ts] of Object.entries(byGroup)) msg += `\n**${g}** (${ts.length})\n` + ts.slice(0, 8).map((t) => `• ${t}`).join('\n') + (ts.length > 8 ? `\n… +${ts.length - 8}` : '');
  console.log(msg);
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!dry && hook) {
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: msg.slice(0, 1900) }) });
    if (!r.ok) console.error('discord 발송 실패', r.status);
    else for (const [k] of toSend) st.alerted[k] = now;
  }
}
if (!dry) fs.writeFileSync(path.join(ROOT, STATE_FILE), JSON.stringify(st, null, 1) + '\n');

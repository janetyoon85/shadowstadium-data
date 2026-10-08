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

// 중국 구장(측량법 리스크로 의도적 제거, 앱 checkVenueCoverage.mjs KNOWN_EXCLUDED_VENUES와 동일) — 누락 점검 제외
const CHINA_VENUES = new Set('beijing_guoan_workers phoenix_mountain_sports_park_chengdu chongqing_longxing_stadium dalian_suoyuwan_football_stadium hanghai_stadium_zhengzhou tiexi_stadium_shenyang qingdao_youth_football_stadium qingdao_westcoast_university_stadium jinan_olympic_sports_center shanghai_port_pudong shanghai_stadium shenzhen_stadium_xinpengcheng teda_football_stadium_tianjin wuhan_sports_center_stadium yuxi_plateau_sports_center huanglong_sports_center_hangzhou xiamen_egret_stadium tongliang_long_stadium shenzhen_universiade_sports_centre_stadium tianjin_olympic_center_stadium shenyang_olympic_sports_center_stadium hangzhou_olympic_sports_center_stadium bao_an_stadium shenzhen_youth_football_training_base_center_stadium longhua_cultural_and_sports_center_stadium shenzhen_youth_football_training_base_pitch_1 suzhou_taihu_football_center suzhou_sports_center_stadium'.split(' '));
// 표기만 다른 같은 팀(언어별 명칭 차이) — 로고 중복 검사에서 제외
const ALIAS_SETS = [['USVI','버진 제도'],['샤를루아','샬레로이'],['로센보르','로젠보리'],['안트베르펜','앤트워프'],['미엘뷔 AIF','미얄비'],['괴즈테페','괴체페'],['바이킹','비킹 FK'],['이스트 벵갈','SC 이스트벵골']];
// 1) 로고 오매칭 의심 — 같은 로고 URL이 영문명이 서로 다른 팀들에 쓰임(5곳 초과는 공용 플레이스홀더로 보고 제외)
{
  const by = {};
  for (const [k, u] of Object.entries(logos)) if (u) (by[u] ??= []).push(k);
  for (const [u, ks] of Object.entries(by)) {
    if (ks.length < 2 || ks.length > 5) continue;
    const es = new Set(ks.map((k) => (teamEn[k.split('|')[0]] || k).toLowerCase()));
    const nm = ks.map((k) => k.split('|')[0]);
    if (ALIAS_SETS.some((al) => nm.every((n) => al.includes(n)))) continue;
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
    if (g.venueId && !CHINA_VENUES.has(g.venueId)) venues.set(g.venueId, g.stadium || g.venueId);
  }
  // 올스타·선발 연합팀은 로고·영문명이 원래 없다(2026-10-09 분류) — 점검 제외. 국가대표 대회는 국기를 쓰므로 팀 로고만 제외.
  const ALLSTAR_TEAMS = new Set(['드림', '나눔', '퍼시픽리그', '센트럴리그', '아메리칸', '내셔널', 'K리그 XI']);
  // App.tsx NATIONAL_TEAM_LEAGUES 미러 — 새 국가대표 대회를 앱에 추가하면 여기도 같이 추가할 것.
  const NATIONAL_LEAGUES = new Set('WORLDCUP AFRICACUP U17WORLDCUP UNL WCQUEFA AMATCHFRIENDLY WCQAFC ASIANCUP U17ASIANCUP U20ASIANCUP U23ASIANCUP WOMENASIANCUP U20WOMENASIANCUP AFFCUP E1MEN E1WOMEN COPAAMERICA UEFAEURO U20WORLDCUP U20WOMENWORLDCUP U17WOMENASIANCUP ASIANGAMESFOOTBALL OLYMPICFOOTBALL WBC PREMIER12 OLYMPICBASEBALL U18BASEBALLWORLDCUP U15BASEBALLWORLDCUP U23BASEBALLWORLDCUP U18ASIANBASEBALL ASIANGAMESBASEBALL'.split(' '));
  for (const [n, lg] of teams) {
    if (ALLSTAR_TEAMS.has(n)) continue;
    const base = n.replace(/\s*\((남자|여자)\)$/, '');
    const hasLogo = logos[n] || logos[base] || logos[`${base}|Baseball`] || logos[`${base}|Soccer`];
    if (!hasLogo && !NATIONAL_LEAGUES.has(lg)) add('팀 로고 없음', n, `${n} (${lg})`, true);
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
        if (r.status === 403 && u.includes('i.namu.wiki')) continue; // 나무위키는 CI IP를 차단(403 챌린지)해 검증 불가 — 앱(사용자 기기)에선 정상 표시
        if ([403, 404, 410].includes(r.status) || (r.ok && !ct.startsWith('image/'))) add('로고 URL 깨짐', u, `${nameOf(u)} (${r.status} ${ct.split(';')[0]})`);
      } catch { /* 일시적 네트워크 오류는 무시 */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// 10) 경기 데이터 정합성(오늘 -7일 ~ +14일) — 종료인데 점수 없음/중복/시각 형식/구장ID 미등록/한 팀 다중 표기
{
  const lo = addDays(kstToday, -7), hi = addDays(kstToday, 14);
  const recent = games.filter((g) => g.date && g.date >= lo && g.date <= hi);
  const venueIds = new Set([...(J('venues-meta.json', [])).map((v) => v.id), ...Object.keys(venueEn)]);
  const venueInfo = J('venue-info.json', {});
  const seen = new Map();
  for (const g of recent) {
    const id = g.gameId || `${g.date}${g.home}${g.away}`;
    const label = `${g.date} ${g.league} ${g.home} vs ${g.away}`;
    if (g.status === 'completed' && (g.homeScore == null || g.awayScore == null)) add('종료 경기 점수 없음', id, label, true);
    if (!g.timeTbd && !/^\d\d:\d\d$/.test(g.time || '')) add('경기 시각 형식 이상', id, `${label} (${g.time ?? '없음'})`, true);
    if (g.venueId && !CHINA_VENUES.has(g.venueId) && !(g.venueId in venueInfo)) add('구장 상세정보(venue-info) 없음', g.venueId, `${g.venueId} (${g.league})`, true);
    if (g.venueId && !venueIds.has(g.venueId) && !CHINA_VENUES.has(g.venueId)) add('구장 ID 미등록', g.venueId, `${g.venueId} (${g.league})`, true);
    const dk = [g.date, g.time, g.league, g.home, g.away].join('|');
    if (seen.has(dk) && seen.get(dk) !== id) add('경기 중복(같은 일시·팀)', dk, label, true);
    seen.set(dk, id);
  }
  // 같은 리그에서 영문명이 같은 서로 다른 한글 표기가 둘 다 쓰이면 한 팀이 둘로 나뉜 것일 수 있음
  const byLeagueEn = {};
  for (const g of recent) for (const n of [g.home, g.away]) {
    const e = teamEn[n]; if (!e) continue;
    ((byLeagueEn[`${g.league}|${e.toLowerCase()}`] ??= new Set())).add(n);
  }
  for (const [k, set] of Object.entries(byLeagueEn)) if (set.size > 1) add('한 팀 다중 표기', k, `${k.split('|')[0]}: ${[...set].join(' / ')}`, true);
}

// 11) 18개 언어 리그명 키 누락(league-i18n)
{
  const li = J('league-i18n.json', {});
  const koKeys = Object.keys(li.ko || {});
  for (const [lang, o] of Object.entries(li)) {
    const miss = koKeys.filter((k) => !(k in o));
    if (miss.length) add('리그명 번역 누락', lang, `${lang}: ${miss.length}개 (${miss.slice(0, 4).join(', ')}${miss.length > 4 ? '…' : ''})`, true);
  }
}

// 12) 선수 데이터 — 한글명·사진 건수 급감, 사진 URL 순환 생존 검사(MLB 기본 이미지 제외)
{
  const cnt = { koNames: Object.keys(J('player-name-ko.json', {})).length, photos: Object.keys(J('player-photos.json', {})).length };
  for (const [k, cur] of Object.entries(cnt)) {
    const prev = (st.dataCounts ||= {})[k];
    if (prev && cur < prev * 0.98) add('선수 데이터 건수 급감', k, `${k}: ${prev} → ${cur}`);
    st.dataCounts[k] = cur;
  }
  const ph = Object.entries(J('player-photos.json', {})).filter(([, u]) => typeof u === 'string' && u.startsWith('http') && !u.includes('mlbstatic.com') && !u.includes('/headshots/soccer/')); // ESPN 축구는 "있으면 표시" 폴백(404 정상)이라 제외
  const slot = Math.floor(now / (6 * 3600e3)) % Math.max(1, Math.ceil(ph.length / 60));
  const part = ph.slice(slot * 60, slot * 60 + 60);
  let i = 0;
  const worker = async () => {
    while (i < part.length) {
      const [pid, u] = part[i++];
      try {
        const r = await fetch(u, { headers: { 'User-Agent': 'ShadeSideCrawler/1.0', Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) });
        if ([403, 404, 410].includes(r.status)) add('선수 사진 URL 깨짐', pid, `${pid} (${r.status})`, true);
      } catch { /* 일시 오류 무시 */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// 13) KBL 선수 프로필 — 선수 모달 "정보를 찾을 수 없어요" 방지(KBL 공식 API 백필 대상 전원 점검)
{
  const info = J('basketball/player-info.json', {});
  for (const p of J('basketball/players.json', [])) {
    if (!p.id?.startsWith('nbk:kbl:')) continue;
    const v = info[p.id];
    if (!v) add('KBL 선수 프로필 없음', p.id, `${p.name} (${p.id})`, true);
    else if (!v.nat) add('KBL 선수 국적 없음', p.id, `${p.name} (${p.id})`, true);
  }
}

// 5) 정체 경기 — 어제 이전 날짜인데 예정/진행중(7일 넘은 건 소스 미제공으로 보고 앱이 숨기므로 제외)
{
  const cut = addDays(kstToday, -1);
  for (const g of games) {
    if (g.date && g.date < cut && g.date >= addDays(kstToday, -7) && (g.status === 'scheduled' || g.status === 'live')) {
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
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}.yml/runs?per_page=50`, { headers });
      if (!r.ok) { add('워크플로 조회 실패', wf, `${wf}: HTTP ${r.status}`); continue; }
      const runs = (await r.json()).workflow_runs.filter((x) => x.status === 'completed' && x.conclusion !== 'cancelled' && x.conclusion !== 'skipped');
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

const sendDiscord = async (hook, text) => {
  let ok = true;
  let buf = '';
  const flush = async () => {
    if (!buf.trim()) return;
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: buf }) });
    if (!r.ok) { ok = false; console.error('discord 발송 실패', r.status); }
    buf = '';
    await new Promise((x) => setTimeout(x, 800));
  };
  for (const l of text.split('\n')) { if (buf.length + l.length + 1 > 1800) await flush(); buf += (buf ? '\n' : '') + l.slice(0, 1500); }
  await flush();
  return ok;
};
// 누적 미해결(baseline 포함) 요약 — 새 알림에 한 줄 덧붙이고, 하루 한 번(UTC 0시대 실행) 전체 목록을 발송
const backlog = {};
for (const [k, v] of issues) if (v.useBaseline && st.baseline[k]) (backlog[v.group] ??= []).push(v.text);
const digest = new Date().getUTCHours() === 0 && !first && !process.argv.includes('--no-digest');
if (digest && Object.keys(backlog).length) {
  let m = '📋 ShadeSide 미해결 누적 현황 (자동 수집 실패분)\n';
  for (const [g, ts] of Object.entries(backlog)) m += `\n**${g}** (${ts.length})\n` + ts.map((t) => `• ${t}`).join('\n');
  console.log(m);
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!dry && hook) await sendDiscord(hook, m);
}

if (toSend.length && !first) {
  const byGroup = {};
  for (const [, v] of toSend) (byGroup[v.group] ??= []).push(v.text);
  let msg = `🟠 ShadeSide 운영 점검 — 이상 ${toSend.length}건\n`;
  for (const [g, ts] of Object.entries(byGroup)) msg += `\n**${g}** (${ts.length})\n` + ts.map((t) => `• ${t}`).join('\n');
  msg += `

누적 미해결: ${Object.entries(backlog).map(([g, ts]) => `${g} ${ts.length}`).join(' · ') || '없음'}`;
  console.log(msg);
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!dry && hook) {
    if (await sendDiscord(hook, msg)) for (const [k, v] of toSend) { st.alerted[k] = now; if (v.useBaseline) st.baseline[k] = true; } // 누락류는 한 번 알린 뒤엔 일일 요약으로만
  }
}
if (!dry) fs.writeFileSync(path.join(ROOT, STATE_FILE), JSON.stringify(st, null, 1) + '\n');

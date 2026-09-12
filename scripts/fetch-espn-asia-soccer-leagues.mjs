// ESPN 공식 API(site.api.espn.com) 기반 아시아축구 3개리그(태국 리그1/인도네시아 리가1/인도 ISL)
// 자동 수집 — 네이버에 카테고리 자체가 없는 리그들. 나머지 요청국(베트남/UAE/카타르/우즈베키스탄/
// 이란)은 네이버·ESPN 둘 다 데이터 없어 제외.
//
// 주의: 2026-09 조사 시점 기준 ESPN이 이 3개 리그의 2026-27 시즌(9월~) 일정을 아직 안 올려놔서
// 최근~향후 윈도우는 0경기가 정상 — 시즌 시작 후 자동으로 채워짐(다른 "미래 대회" 카테고리와 동일).
//
// 원본 로직은 앱 저장소 scripts/fetchEspnAsiaSoccerLeagues.mjs 와 동일(저장소 분리라 부득이 복사
// 유지). 매일 1회 GitHub Actions 자동 실행(.github/workflows/fetch-espn-asia-soccer-leagues.yml).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASIA_TEAMS, normalizeTeamName } from './espn-asia-soccer-teams.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REQUEST_DELAY_MS = 900;

const LEAGUES = [
  { code: 'THAILAND', slug: 'tha.1' },
  { code: 'INDONESIA', slug: 'idn.1' },
  { code: 'INDIA', slug: 'ind.1' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toKstDateTime(utcIso) {
  const ms = Date.parse(utcIso) + 9 * 3600 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

// ESPN scoreboard 응답에 이미 comp.details(득점/카드 등 이벤트 배열)가 포함돼 있어서 별도 요청
// 불필요. scoringPlay:true 인 항목만 골(자책골 포함) — 카드/교체 등은 false.
function extractScorers(comp, homeTeamId, awayTeamId) {
  const home = [];
  const away = [];
  for (const d of comp.details || []) {
    if (!d.scoringPlay) continue;
    const scorer = d.athletesInvolved?.[0];
    if (!scorer?.displayName) continue;
    const entry = { n: scorer.displayName };
    const m = /^(\d+)/.exec(d.clock?.displayValue || '');
    if (m) entry.m = parseInt(m[1], 10);
    if (d.penaltyKick) entry.pk = true;
    if (d.ownGoal) entry.og = true;
    const teamId = String(d.team?.id ?? '');
    if (teamId === String(homeTeamId)) home.push(entry);
    else if (teamId === String(awayTeamId)) away.push(entry);
  }
  return home.length || away.length ? { home, away } : undefined;
}

function espnStatusToOurs(statusType) {
  const name = statusType?.name || '';
  if (/POSTPONED/i.test(name)) return 'postponed';
  if (/CANCELED|CANCELLED|ABANDONED/i.test(name)) return 'cancelled';
  if (statusType?.completed) return 'completed';
  if (statusType?.state === 'in') return 'live';
  return 'scheduled';
}

async function fetchEspnLeagueRange(code, slug, fromYmd, toYmd, unknownTeams, unknownVenues) {
  const teamMap = ASIA_TEAMS[code] || {};
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${fromYmd}-${toYmd}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${code}`);
  const j = await res.json();
  const games = [];
  for (const e of j.events || []) {
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    const homeEn = home?.team?.displayName;
    const awayEn = away?.team?.displayName;
    if (!homeEn || !awayEn) continue;
    const homeInfo = teamMap[normalizeTeamName(homeEn)];
    const awayInfo = teamMap[normalizeTeamName(awayEn)];
    if (!homeInfo) unknownTeams.add(`${code}:${homeEn}`);
    if (!awayInfo) unknownTeams.add(`${code}:${awayEn}`);
    if (!homeInfo || !awayInfo) continue;
    const venueName = comp.venue?.fullName;
    if (venueName && !homeInfo.venueId) unknownVenues.add(`${code}:${venueName}`);
    const { date, time } = toKstDateTime(e.date);
    const status = espnStatusToOurs(comp.status?.type);
    const out = {
      date, time, league: code, venueId: homeInfo.venueId,
      home: homeInfo.ko, away: awayInfo.ko,
      stadium: venueName || '', timeTbd: !comp.timeValid,
      gameId: `${code}_ESPN_${e.id}`,
      status,
    };
    if (status === 'completed' || status === 'live') {
      const hs = home.score != null ? parseInt(home.score, 10) : NaN;
      const as = away.score != null ? parseInt(away.score, 10) : NaN;
      if (!Number.isNaN(hs)) out.homeScore = hs;
      if (!Number.isNaN(as)) out.awayScore = as;
      const scorers = extractScorers(comp, home.team?.id, away.team?.id);
      if (scorers) out.scorers = scorers;
    }
    games.push(out);
  }
  return games;
}

async function fetchEspnLeague(code, slug, startDate, endDate, unknownTeams, unknownVenues) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const all = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 14)) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + 13 * 86400000, end.getTime()));
    const games = await fetchEspnLeagueRange(code, slug, fmtDate(cursor), fmtDate(chunkEnd), unknownTeams, unknownVenues);
    all.push(...games);
    await sleep(REQUEST_DELAY_MS);
  }
  return all;
}

async function notifyUnknowns(unknownTeams, unknownVenues) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || (unknownTeams.size === 0 && unknownVenues.size === 0)) return;
  const lines = [];
  if (unknownTeams.size) lines.push(`**미확인 팀명(espn-asia-soccer-teams.mjs에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(venueId 미매핑)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 그늘각 — 아시아축구 3개리그(ESPN) 미확인 항목\nscripts/espn-asia-soccer-teams.mjs 에서 매핑 추가해주세요.\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] espn-asia-soccer unknown notify failed:', e.message);
  }
}

async function main() {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 86400000);
  const end = new Date(now.getTime() + 30 * 86400000);
  const startDate = ymd(start);
  const endDate = ymd(end);

  const unknownTeams = new Set();
  const unknownVenues = new Set();
  const allNew = [];
  for (const { code, slug } of LEAGUES) {
    console.log(`Fetching ${code} (${slug}) ${startDate}~${endDate} ...`);
    let gs;
    try {
      gs = await fetchEspnLeague(code, slug, startDate, endDate, unknownTeams, unknownVenues);
    } catch (e) {
      console.warn(`  failed: ${e.message}`);
      continue;
    }
    console.log(`  -> ${gs.length} games`);
    allNew.push(...gs);
  }
  await notifyUnknowns(unknownTeams, unknownVenues);

  const gamesPath = path.join(REPO_ROOT, 'games_2026.json');
  const games = JSON.parse(await fs.readFile(gamesPath, 'utf-8'));
  const existingIds = new Set(games.map((g) => g.gameId || `${g.date}|${g.time}|${g.league}|${g.venueId}|${g.home}|${g.away}`));
  let added = 0;
  let updated = 0;
  for (const g of allNew) {
    const key = g.gameId;
    if (existingIds.has(key)) {
      const idx = games.findIndex((x) => x.gameId === key);
      if (idx >= 0) {
        const prev = games[idx];
        if (prev.status !== g.status || prev.homeScore !== g.homeScore || prev.awayScore !== g.awayScore || JSON.stringify(prev.scorers) !== JSON.stringify(g.scorers)) {
          games[idx] = { ...prev, ...g };
          updated++;
        }
      }
      continue;
    }
    games.push(g);
    existingIds.add(key);
    added++;
  }
  games.sort((a, b) => (a.date + a.time + a.league + a.venueId + a.home + a.away).localeCompare(b.date + b.time + b.league + b.venueId + b.home + b.away));
  await fs.writeFile(gamesPath, JSON.stringify(games, null, 2), 'utf-8');
  console.log(`[espn-asia-soccer] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[espn-asia-soccer] fatal:', e);
  process.exit(1);
});

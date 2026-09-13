// ESPN 공식 API(site.api.espn.com) 기반 전세계 21개리그 자동 수집 — 네이버에 카테고리가 없는
// 리그들을 ESPN 전세계 슬러그 브루트포스 스캔으로 발견(2026-09). 15개리그/아시아 3개리그에 이은
// 3번째 ESPN 배치.
//
// 남미: 베네수엘라/에콰도르/페루/볼리비아/파라과이/코스타리카/엘살바도르
// 유럽 소국: 웨일스/북아일랜드/키프로스/몰타/러시아
// 기타: 말레이시아/싱가포르/이스라엘
// 아프리카: 남아공/나이지리아/가나/케냐/우간다/짐바브웨
//
// 팀명은 정규화 매칭(espn-soccer-teams.mjs의 normalizeTeamName 재사용).
// 방위각(fieldBearing)은 전부 미조사 — 좌표만 등록, 수동 조사 예정.
// 원본 로직은 앱 저장소 scripts/fetchEspnWorldSoccerLeagues.mjs 와 동일(저장소 분리라 부득이 복사
// 유지). 매일 1회 GitHub Actions 자동 실행(.github/workflows/fetch-espn-world-soccer-leagues.yml).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTeamName } from './espn-soccer-teams.mjs';
import { BATCH2_TEAMS } from './espn-world-soccer-teams.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REQUEST_DELAY_MS = 900;

const LEAGUES = [
  { code: 'VENEZUELA', slug: 'ven.1' },
  { code: 'ECUADOR', slug: 'ecu.1' },
  { code: 'PERU', slug: 'per.1' },
  { code: 'BOLIVIA', slug: 'bol.1' },
  { code: 'PARAGUAY', slug: 'par.1' },
  { code: 'COSTARICA', slug: 'crc.1' },
  { code: 'ELSALVADOR', slug: 'slv.1' },
  { code: 'WALES', slug: 'wal.1' },
  { code: 'NORTHERNIRELAND', slug: 'nir.1' },
  { code: 'CYPRUS', slug: 'cyp.1' },
  { code: 'MALTA', slug: 'mlt.1' },
  { code: 'RUSSIA', slug: 'rus.1' },
  { code: 'MALAYSIA', slug: 'mys.1' },
  { code: 'SINGAPORE', slug: 'sgp.1' },
  { code: 'ISRAEL', slug: 'isr.1' },
  { code: 'SOUTHAFRICA', slug: 'rsa.1' },
  { code: 'NIGERIA', slug: 'nga.1' },
  { code: 'GHANA', slug: 'gha.1' },
  { code: 'KENYA', slug: 'ken.1' },
  { code: 'UGANDA', slug: 'uga.1' },
  { code: 'ZIMBABWE', slug: 'zim.1' },
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
  const teamMap = BATCH2_TEAMS[code] || {};
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
  if (unknownTeams.size) lines.push(`**미확인 팀명(espn-world-soccer-teams.mjs에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(venueId 미매핑)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 그늘각 — 전세계 21개리그(ESPN) 미확인 항목\nscripts/espn-world-soccer-teams.mjs 에서 매핑 추가해주세요. 승격/강등 등으로 새 팀이 생겼을 수 있습니다.\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] espn-world-soccer unknown notify failed:', e.message);
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

  const gamesPath = path.join(REPO_ROOT, 'games.json');
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
  console.log(`[espn-world-soccer] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[espn-world-soccer] fatal:', e);
  process.exit(1);
});

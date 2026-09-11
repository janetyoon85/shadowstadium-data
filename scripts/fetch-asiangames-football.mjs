// 2026 아이치·나고야 아시안게임 축구 자동 수집 — 야구(fetch-asiangames-baseball.mjs)와 완전히
// 같은 Bornan API, discipline만 'FBL'. 이중 UTF-8 인코딩 버그 등 디코딩 방식은 그쪽 파일 주석
// 참고. 남녀부 다 있어서 같은 나라가 같은 날 겹칠 수 있어 팀명에 "(남자)"/"(여자)" 붙여 구분.
//
// 원본 로직은 앱 저장소 scripts/fetchAsianGamesFootball.mjs 와 동일(저장소 분리라 부득이 복사
// 유지). 매일 1회 GitHub Actions 자동 실행(.github/workflows/fetch-asiangames-football.yml),
// 대회 진행 기간(9/14~10/3)엔 cron-job.org로 10분 주기 트리거 권장.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const API_HOST = 'back.results.asiangames2026.org';
const CHAMP = 'AG2026';
const DISC = 'FBL';
const REQUEST_DELAY_MS = 800;

const TEAM_KO = {
  BAN: '방글라데시', CHN: '중국', HKG: '홍콩', IRI: '이란', JPN: '일본', KGZ: '키르기스스탄',
  KOR: '대한민국', KSA: '사우디아라비아', KUW: '쿠웨이트', MYA: '미얀마', PHI: '필리핀',
  PRK: '북한', QAT: '카타르', THA: '태국', TPE: '차이니스 타이베이', UAE: '아랍에미리트',
  UZB: '우즈베키스탄', VIE: '베트남',
};

const VENUE_MAP = {
  GNS: 'gifu_nagaragawa_football_stadium',
  MPR: 'nagoya_mizuho_rugby_stadium',
  MSF: 'nagoya_minato_soccer_stadium',
  NAG: 'nagai_stadium_osaka',
  SSE: 'shizuoka_stadium_ecopa',
  TOS: 'toyota_stadium_nagoya',
  WAV: 'wave_stadium_kariya',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchDecoded(pathSuffix) {
  const url = `https://${API_HOST}/s/${CHAMP}/en/${pathSuffix}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${pathSuffix}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const fixed = Buffer.from(buf.toString('utf-8'), 'latin1');
  const inflated = zlib.inflateSync(fixed);
  return JSON.parse(inflated.toString('utf-8'));
}

function toKstDateTime(isoWithOffset) {
  const ms = Date.parse(isoWithOffset) + 9 * 3600 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

function agStatusToOurs(status) {
  if (status === 'OFFICIAL' || status === 'FINISHED' || status === 'UNOFFICIAL') return 'completed';
  if (status === 'LIVE') return 'live';
  if (status === 'POSTPONED') return 'postponed';
  return 'scheduled';
}

async function fetchAsianGamesFootballDays() {
  const days = await fetchDecoded(`${DISC}/schedule/days`);
  return days.map((d) => d.raw);
}

async function fetchAsianGamesFootballDay(dateStr, unknownTeams, unknownVenues) {
  const rawGames = await fetchDecoded(`${DISC}/schedule/daily/${dateStr}`);
  const games = [];
  for (const g of rawGames) {
    const homeOrg = g.Home?.Org;
    const awayOrg = g.Away?.Org;
    if (!homeOrg || !awayOrg) continue;
    const homeKoBase = TEAM_KO[homeOrg];
    const awayKoBase = TEAM_KO[awayOrg];
    if (!homeKoBase) unknownTeams.add(homeOrg);
    if (!awayKoBase) unknownTeams.add(awayOrg);
    const venueId = g.Venue ? VENUE_MAP[g.Venue] : undefined;
    if (g.Venue && !venueId) unknownVenues.add(`${g.Venue}:${g.VenueDesc}`);
    if (!homeKoBase || !awayKoBase || !venueId) continue;
    const gender = g.EventDesc === 'Women' ? '여자' : '남자';
    const { date, time } = toKstDateTime(g.DateTimeRaw);
    const status = agStatusToOurs(g.Status);
    const out = {
      date, time, league: 'ASIANGAMESFOOTBALL', venueId,
      home: `${homeKoBase} (${gender})`, away: `${awayKoBase} (${gender})`,
      stadium: g.VenueDesc, timeTbd: false,
      gameId: `ASIANGAMESFOOTBALL_AG2026_${g.ResCode || g.Key}`,
      status,
    };
    if (status === 'completed' || status === 'live') {
      const hs = Number(g.Home.Result);
      const as = Number(g.Away.Result);
      if (Number.isFinite(hs)) out.homeScore = hs;
      if (Number.isFinite(as)) out.awayScore = as;
    }
    games.push(out);
  }
  return games;
}

async function notifyUnknowns(unknownTeams, unknownVenues) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || (unknownTeams.size === 0 && unknownVenues.size === 0)) return;
  const lines = [];
  if (unknownTeams.size) lines.push(`**미확인 팀 코드(TEAM_KO에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(VENUE_MAP에 추가 필요)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 그늘각 — 아시안게임 축구 미확인 항목\nscripts/fetch-asiangames-football.mjs 에서 매핑 추가해주세요.\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] asiangames-football unknown notify failed:', e.message);
  }
}

async function main() {
  const unknownTeams = new Set();
  const unknownVenues = new Set();
  const allNew = [];
  let days;
  try {
    days = await fetchAsianGamesFootballDays();
  } catch (e) {
    console.error('[asiangames-football] failed to fetch days:', e.message);
    process.exit(1);
  }
  for (const d of days) {
    console.log(`Fetching ${d} ...`);
    await sleep(REQUEST_DELAY_MS);
    let gs;
    try {
      gs = await fetchAsianGamesFootballDay(d, unknownTeams, unknownVenues);
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
        if (prev.status !== g.status || prev.homeScore !== g.homeScore || prev.awayScore !== g.awayScore) {
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
  console.log(`[asiangames-football] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[asiangames-football] fatal:', e);
  process.exit(1);
});

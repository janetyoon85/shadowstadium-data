// ESPN 비공개 API(site.api.espn.com, 인증 불필요) 기반 야구 국가대표/비정기 대회 자동 수집
// (WBC/카리브해시리즈/올림픽야구) — Naver에 없는 대회라 별도 파이프라인. 매일 1회 GitHub
// Actions로 자동 실행(.github/workflows/fetch-espn-baseball.yml).
//
// 날짜를 하드코딩하지 않고 "오늘 기준 앞뒤 롤링 윈도우"로 매일 조회 — 다음 대회(WBC/카리브해
// 시리즈/올림픽야구)가 언제 열리든 코드 수정 없이 자동으로 잡힘. 이미 지난 경기는 gameId 기준
// 중복 스킵이라 매일 재조회해도 안전(속도만 약간 쓰고 데이터 변화 없음).
//
// 원본 로직은 shadowstadium(앱) 저장소의 scripts/fetchEspnBaseball.mjs 와 동일(팀명 번역표
// TEAM_KO, 구장 매핑 VENUE_MAP) — 앱 저장소는 한 번 확보한 히스토리 백필용, 이 파일은 저장소
// 분리라 부득이 복사 유지. 새 국가/구장 나오면 양쪽 다 갱신해야 함.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const REQUEST_DELAY_MS = 600;

const TEAM_KO = {
  Australia: '호주', Brazil: '브라질', Canada: '캐나다', 'Chinese Taipei': '차이니스 타이베이',
  Colombia: '콜롬비아', Cuba: '쿠바', Czechia: '체코', 'Dominican Republic': '도미니카공화국',
  'Great Britain': '영국', Israel: '이스라엘', Italy: '이탈리아', Japan: '일본',
  Korea: '대한민국', 'South Korea': '대한민국', Mexico: '멕시코', Netherlands: '네덜란드',
  Nicaragua: '니카라과', Panama: '파나마', 'Puerto Rico': '푸에르토리코', 'United States': '미국',
  Venezuela: '베네수엘라', 'Mexico Rojo': '멕시코 로호', 'Mexico Verde': '멕시코 베르데',
};

const VENUE_MAP = {
  'Tokyo Dome': 'tokyo_dome',
  'Hiram Bithorn Stadium': 'hiram_bithorn_stadium',
  'loanDepot park': 'loandepot_park',
  'Daikin Park': 'daikin_park',
  'Estadio Panamericano de los Charros': 'estadio_panamericano_zapopan',
  'Yokohama Baseball Stadium': 'yokohama_stadium',
};

const LEAGUES = [
  { slug: 'world-baseball-classic', league: 'WBC' },
  { slug: 'caribbean-series', league: 'CARIBBEANSERIES' },
  { slug: 'olympics-baseball', league: 'OLYMPICBASEBALL' },
];

// 롤링 윈도우 — 지난 대회 재확인(스코어 정정 등) + 다음 대회 조기 포착용.
const DAYS_BEFORE = 7;
const DAYS_AFTER = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchDate(slug, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/${slug}/scoreboard?dates=${yyyymmdd}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${slug} ${yyyymmdd}`);
  const json = await res.json();
  return json.events || [];
}

function toKstDateTime(isoUtc) {
  const ms = Date.parse(isoUtc) + 9 * 3600 * 1000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

function espnStatusToOurs(typeName) {
  if (typeName === 'STATUS_SCHEDULED') return 'scheduled';
  if (typeName === 'STATUS_FINAL' || typeName === 'STATUS_FINAL_AET') return 'completed';
  return 'live';
}

function dateRange(startYmd, endYmd) {
  const out = [];
  let cur = new Date(`${startYmd.slice(0, 4)}-${startYmd.slice(4, 6)}-${startYmd.slice(6, 8)}T00:00:00Z`);
  const end = new Date(`${endYmd.slice(0, 4)}-${endYmd.slice(4, 6)}-${endYmd.slice(6, 8)}T00:00:00Z`);
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    out.push(`${y}${m}${d}`);
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function fetchEspnBaseballLeague(slug, league, dates, unknownTeams, unknownVenues) {
  const games = [];
  const seenIds = new Set();
  for (const yyyymmdd of dates) {
    await sleep(REQUEST_DELAY_MS);
    let events;
    try {
      events = await fetchDate(slug, yyyymmdd);
    } catch (e) {
      console.warn(`[ESPN-BASEBALL] fetch failed ${slug} ${yyyymmdd}: ${e.message}`);
      continue;
    }
    for (const e of events) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      const comp = e.competitions[0];
      const home = comp.competitors.find((c) => c.homeAway === 'home');
      const away = comp.competitors.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;
      const homeEn = home.team.displayName;
      const awayEn = away.team.displayName;
      const homeKo = TEAM_KO[homeEn];
      const awayKo = TEAM_KO[awayEn];
      if (!homeKo) unknownTeams.add(`${league}:${homeEn}`);
      if (!awayKo) unknownTeams.add(`${league}:${awayEn}`);
      const venueName = comp.venue?.fullName;
      const venueId = venueName ? VENUE_MAP[venueName] : undefined;
      if (venueName && !venueId) unknownVenues.add(`${league}:${venueName}`);
      if (!homeKo || !awayKo || !venueId) continue;
      const { date, time } = toKstDateTime(e.date);
      const status = espnStatusToOurs(e.status.type.name);
      const g = {
        date, time, league, venueId,
        home: homeKo, away: awayKo,
        stadium: venueName, timeTbd: false,
        gameId: `${league}_ESPN_${e.id}`,
        status,
      };
      if (status === 'completed' || status === 'live') {
        if (typeof home.score !== 'undefined') g.homeScore = Number(home.score);
        if (typeof away.score !== 'undefined') g.awayScore = Number(away.score);
      }
      games.push(g);
    }
  }
  return games;
}

async function notifyUnknowns(unknownTeams, unknownVenues) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || (unknownTeams.size === 0 && unknownVenues.size === 0)) return;
  const lines = [];
  if (unknownTeams.size) lines.push(`**미확인 팀명(TEAM_KO에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(VENUE_MAP에 추가 필요)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 그늘각 — ESPN 야구(WBC/카리브해시리즈/올림픽) 미확인 항목\nscripts/fetch-espn-baseball.mjs 에서 매핑 추가해주세요(구장 실좌표 리서치 필요할 수 있음).\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] espn-baseball unknown notify failed:', e.message);
  }
}

async function main() {
  const now = new Date();
  const start = new Date(now.getTime() - DAYS_BEFORE * 86400000);
  const end = new Date(now.getTime() + DAYS_AFTER * 86400000);
  const dates = dateRange(ymd(start), ymd(end));

  const unknownTeams = new Set();
  const unknownVenues = new Set();
  const allNew = [];
  for (const { slug, league } of LEAGUES) {
    console.log(`Fetching ${league} (${slug}) rolling window ${dates[0]}~${dates[dates.length - 1]} ...`);
    const gs = await fetchEspnBaseballLeague(slug, league, dates, unknownTeams, unknownVenues);
    console.log(`  -> ${gs.length} games`);
    allNew.push(...gs);
  }
  await notifyUnknowns(unknownTeams, unknownVenues);

  const gamesPath = path.join(REPO_ROOT, 'games_2026.json');
  const games = JSON.parse(await fs.readFile(gamesPath, 'utf-8'));
  const existingIds = new Set(games.map((g) => g.gameId || `${g.date}|${g.time}|${g.league}|${g.venueId}|${g.home}|${g.away}`));
  let added = 0;
  let updated = 0;
  const byGameId = new Map(games.map((g) => [g.gameId, g]));
  for (const g of allNew) {
    const key = g.gameId;
    if (existingIds.has(key)) {
      // 이미 있는 경기(예정→진행중→종료로 상태 바뀐 경우) 최신값으로 갱신.
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
  console.log(`[espn-baseball] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[espn-baseball] fatal:', e);
  process.exit(1);
});

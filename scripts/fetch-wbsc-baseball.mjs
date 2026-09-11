// WBSC 공식 사이트(wbsc.org) 기반 연령별 국가대표 야구월드컵(U-18/U-15/U-23) 자동 수집.
// Naver·ESPN 둘 다 커버 안 하는 대회라 세 번째 파이프라인 신설(2026-09). 매일 1회 GitHub
// Actions로 자동 실행(.github/workflows/fetch-wbsc-baseball.yml).
//
// wbsc.org 스케줄 페이지는 서버렌더링 시 <div id="app" data-page="{...}"> 속성 안에 전체 경기
// JSON을 그대로 박아둔다(Inertia.js). ESPN처럼 고정 슬러그로 날짜 롤링 조회가 안 되고 대회
// (edition)마다 URL의 tournamentkey 자체가 바뀌므로 TOURNAMENTS 배열에 아는 tournamentkey를
// 직접 등록해두는 방식 — 새 대회 열리면(다음: 2027 U-18, 2028 U-15/U-23) 여기 추가 필요.
// 이미 끝난 대회(예: 2025 U-18)도 계속 등록해두는 게 안전(재조회해도 gameId 기준 스킵이라
// 데이터 변화 없이 속도만 조금 씀 — 원본 로직은 앱 저장소 scripts/fetchWbscBaseball.mjs 와
// 동일, 저장소 분리라 부득이 복사 유지. 새 국가/구장 나오면 양쪽 다 갱신해야 함).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REQUEST_DELAY_MS = 800;

const TEAM_KO = {
  Korea: '대한민국', 'Chinese Taipei': '차이니스 타이베이', 'United States of America': '미국',
  'Puerto Rico': '푸에르토리코', Panama: '파나마', Cuba: '쿠바', Japan: '일본', Italy: '이탈리아',
  China: '중국', Germany: '독일', Australia: '호주', 'South Africa': '남아프리카공화국',
  Czechia: '체코', 'Great Britain': '영국', 'Dominican Republic': '도미니카공화국', Mexico: '멕시코',
  Nicaragua: '니카라과', Venezuela: '베네수엘라',
};

const VENUE_MAP = {
  'Okinawa Cellular Stadium NAHA': 'okinawa_cellular_naha',
  'Nishizaki Stadium': 'itoman_nishizaki_stadium',
  'Estadio Beto Ávila': 'estadio_beto_avila_cancun',
  'Parque Kukulcán Alamo': 'parque_kukulcan_alamo_merida',
  'Estadio Nacional Soberania': 'estadio_nacional_soberania_managua',
  'Estadio Rigoberto López Pérez': 'estadio_rigoberto_lopez_perez_leon',
  'Estadio Roberto Clemente': 'estadio_roberto_clemente_masaya',
};

const TOURNAMENTS = [
  { tournamentkey: '2025-u18-baseball-world-cup', league: 'U18BASEBALLWORLDCUP' },
  { tournamentkey: '2026-vii-u-15-baseball-world-cup', league: 'U15BASEBALLWORLDCUP' },
  { tournamentkey: '2026-vi-wbsc-u-23-baseball-world-cup', league: 'U23BASEBALLWORLDCUP' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function fetchTournamentGames(tournamentkey) {
  const url = `https://www.wbsc.org/en/events/${tournamentkey}/schedule-and-results`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${tournamentkey}`);
  const html = await res.text();
  const m = html.match(/data-page="({.*?})"\s*>\s*<\/div>/s);
  if (!m) throw new Error(`data-page attribute not found for ${tournamentkey} (page structure may have changed)`);
  const data = JSON.parse(unescapeHtml(m[1]));
  return data.props.games || [];
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

function wbscStatusToOurs(g) {
  if (g.gamestatustext === 'F') return 'completed';
  if (g.gamestatus === 0 && !g.gamestatustext) return 'scheduled';
  return 'live';
}

async function fetchWbscBaseballTournament(tournamentkey, league, unknownTeams, unknownVenues) {
  const rawGames = await fetchTournamentGames(tournamentkey);
  const games = [];
  for (const g of rawGames) {
    const homeEn = g.homelabel;
    const awayEn = g.awaylabel;
    const homeKo = TEAM_KO[homeEn];
    const awayKo = TEAM_KO[awayEn];
    if (!homeKo) unknownTeams.add(`${league}:${homeEn}`);
    if (!awayKo) unknownTeams.add(`${league}:${awayEn}`);
    const stadiumName = g.stadium;
    const venueId = stadiumName ? VENUE_MAP[stadiumName] : undefined;
    if (stadiumName && !venueId) unknownVenues.add(`${league}:${stadiumName}`);
    if (!homeKo || !awayKo || !venueId) continue;
    const { date, time } = toKstDateTime(g.utc);
    const status = wbscStatusToOurs(g);
    const out = {
      date, time, league, venueId,
      home: homeKo, away: awayKo,
      stadium: stadiumName, timeTbd: false,
      gameId: `${league}_WBSC_${g.id}`,
      status,
    };
    if (status === 'completed' || status === 'live') {
      out.homeScore = Number(g.homeruns);
      out.awayScore = Number(g.awayruns);
    }
    games.push(out);
  }
  return games;
}

async function notifyUnknowns(unknownTeams, unknownVenues) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || (unknownTeams.size === 0 && unknownVenues.size === 0)) return;
  const lines = [];
  if (unknownTeams.size) lines.push(`**미확인 팀명(TEAM_KO에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(VENUE_MAP에 추가 필요)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 그늘각 — WBSC 야구(U-18/U-15/U-23) 미확인 항목\nscripts/fetch-wbsc-baseball.mjs 에서 매핑 추가해주세요(구장 실좌표 리서치 필요할 수 있음).\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] wbsc-baseball unknown notify failed:', e.message);
  }
}

async function main() {
  const unknownTeams = new Set();
  const unknownVenues = new Set();
  const allNew = [];
  for (const { tournamentkey, league } of TOURNAMENTS) {
    console.log(`Fetching ${league} (${tournamentkey}) ...`);
    await sleep(REQUEST_DELAY_MS);
    let gs;
    try {
      gs = await fetchWbscBaseballTournament(tournamentkey, league, unknownTeams, unknownVenues);
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
  console.log(`[wbsc-baseball] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[wbsc-baseball] fatal:', e);
  process.exit(1);
});

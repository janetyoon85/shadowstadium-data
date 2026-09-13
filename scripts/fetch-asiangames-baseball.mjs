// 2026 아이치·나고야 아시안게임(9/21~27) 야구 자동 수집 — 네 번째 데이터 소스.
// Naver/ESPN/WBSC 어디에도 없는 대회. 공식 결과 사이트(results.asiangames2026.org)는
// 서버렌더링이 아니라 순수 SPA("Bornan" 벤더)라 WBSC의 data-page 트릭이 안 통해서, JS 번들에서
// 실제 백엔드 API를 역추적해서 직접 호출:
//   https://back.results.asiangames2026.org/s/AG2026/en/BBL/schedule/{days|daily/{date}}
//
// ⚠ 이 API 응답은 정상 gzip/deflate가 아니라, zlib deflate 바이트가 서버에서 UTF-8로 한 번
//   잘못(또는 의도적으로) 인코딩돼 내려온다 — 그냥 zlib.inflate하면 "incorrect header check"
//   에러. 응답 버퍼를 toString('utf-8')로 디코딩했다가 Buffer.from(str,'latin1')로 재인코딩
//   해야 원래 zlib deflate 바이트가 복원됨(node 네이티브 fetch로 재현 확인 — curl 환경 문제
//   아니라 서버 쪽 실제 동작).
//
// 팀은 Org 3글자 코드(TEAM_KO) 기준 — Home/Away.Org가 빈 문자열이면 아직 미확정(메달 결승 등)
// 이라 조용히 스킵. 매일 1회 GitHub Actions 자동 실행(.github/workflows/fetch-asiangames-baseball.yml).
// 대회가 짧아서(9/21~27) 실제 진행 기간엔 cron-job.org로 10분 주기 트리거 권장(다른 라이브
// 크롤러들과 동일 패턴) — 대회 끝나면 트리거 꺼도 무방(day 목록이 고정이라 재실행해도 안전하지만
// 낭비).
//
// 원본 로직은 앱 저장소 scripts/fetchAsianGamesBaseball.mjs 와 동일(저장소 분리라 부득이 복사
// 유지). 완료 경기 스코어 필드(Home/Away.Result) 포맷은 대회 시작 전이라 미검증 — 숫자 파싱
// 가능하면 사용.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const API_HOST = 'back.results.asiangames2026.org';
const CHAMP = 'AG2026';
const DISC = 'BBL';
const REQUEST_DELAY_MS = 800;

const TEAM_KO = {
  CHN: '중국', HKG: '홍콩', JPN: '일본', KOR: '대한민국', PHI: '필리핀', PLE: '팔레스타인', THA: '태국', TPE: '차이니스 타이베이',
};

const VENUE_MAP = {
  OCB: 'okazaki_red_diamond_stadium',
  TMB: 'toyohashi_municipal',
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

async function fetchAsianGamesBaseballDays() {
  const days = await fetchDecoded(`${DISC}/schedule/days`);
  return days.map((d) => d.raw);
}

async function fetchAsianGamesBaseballDay(dateStr, unknownTeams, unknownVenues) {
  const rawGames = await fetchDecoded(`${DISC}/schedule/daily/${dateStr}`);
  const games = [];
  for (const g of rawGames) {
    const homeOrg = g.Home?.Org;
    const awayOrg = g.Away?.Org;
    if (!homeOrg || !awayOrg) continue;
    const homeKo = TEAM_KO[homeOrg];
    const awayKo = TEAM_KO[awayOrg];
    if (!homeKo) unknownTeams.add(homeOrg);
    if (!awayKo) unknownTeams.add(awayOrg);
    const venueId = g.Venue ? VENUE_MAP[g.Venue] : undefined;
    if (g.Venue && !venueId) unknownVenues.add(`${g.Venue}:${g.VenueDesc}`);
    if (!homeKo || !awayKo || !venueId) continue;
    const { date, time } = toKstDateTime(g.DateTimeRaw);
    const status = agStatusToOurs(g.Status);
    const out = {
      date, time, league: 'ASIANGAMESBASEBALL', venueId,
      home: homeKo, away: awayKo,
      stadium: g.VenueDesc, timeTbd: false,
      gameId: `ASIANGAMESBASEBALL_AG2026_${g.ResCode || g.Key}`,
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
  const content = `🟡 그늘각 — 아시안게임 야구 미확인 항목\nscripts/fetch-asiangames-baseball.mjs 에서 매핑 추가해주세요.\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] asiangames-baseball unknown notify failed:', e.message);
  }
}

async function main() {
  const unknownTeams = new Set();
  const unknownVenues = new Set();
  const allNew = [];
  let days;
  try {
    days = await fetchAsianGamesBaseballDays();
  } catch (e) {
    console.error('[asiangames-baseball] failed to fetch days:', e.message);
    process.exit(1);
  }
  for (const d of days) {
    console.log(`Fetching ${d} ...`);
    await sleep(REQUEST_DELAY_MS);
    let gs;
    try {
      gs = await fetchAsianGamesBaseballDay(d, unknownTeams, unknownVenues);
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
  console.log(`[asiangames-baseball] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[asiangames-baseball] fatal:', e);
  process.exit(1);
});

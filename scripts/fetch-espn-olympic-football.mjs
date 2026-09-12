// ESPN 공식 API(site.api.espn.com) 기반 올림픽 축구(남자 U23/여자 성인부) 자동 수집 — 올림픽
// 야구(fetch-espn-baseball.mjs)와 같은 소스·같은 롤링윈도우 패턴. Naver에는 올림픽 축구 카테고리
// 자체가 없어(2026-09 CMS 카테고리 전수조사로 확인) 별도 파이프라인.
//
// 남자부 슬러그(fifa.olympics)는 팀명이 "Argentina U23"처럼 U23 접미사가 붙어있어 제거 후 조회.
// 여자부(fifa.w.olympics)는 접미사 없음. 아시안게임 축구와 동일하게 한 리그 코드(OLYMPICFOOTBALL)
// 로 통합하고 팀명에 "(남자)"/"(여자)" 접미사를 붙여 구분(같은 대회 기간에 남녀부 동시 진행).
//
// 날짜를 하드코딩하지 않고 롤링 윈도우로 매일 조회 — 다음 올림픽(2028 LA)이 와도 코드 수정 없이
// 자동으로 잡힘. 단, 개최지가 대회마다 완전히 바뀌어 VENUE_MAP은 처음엔 비어있고(2026-09 시점
// LA28 경기장 미확정) 각 대회 임박 시 ESPN에 뜨는 실제 구장명을 Discord 알림으로 받아 채워야 함
// (기존 방식과 동일 — 미매핑 구장은 skip + notifyUnknowns).
//
// 원본 로직은 앱 저장소 scripts/fetchEspnOlympicFootball.mjs 와 동일(저장소 분리라 부득이 복사 유지).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';

// 최근 3개 대회(2016 리우/2020 도쿄/2024 파리) 남녀 출전국 + 상시 강호 위주. COUNTRY_TO_ISO2
// (앱 저장소 App.tsx)와 동일 한글 표기 사용 — teamFlag() 국기 매칭이 이 철자에 의존.
export const TEAM_KO = {
  Argentina: '아르헨티나', Brazil: '브라질', Germany: '독일', Nigeria: '나이지리아', Honduras: '온두라스',
  Portugal: '포르투갈', 'South Korea': '대한민국', Korea: '대한민국', Iraq: '이라크', Colombia: '콜롬비아',
  Sweden: '스웨덴', Denmark: '덴마크', 'South Africa': '남아프리카공화국', Mexico: '멕시코', Japan: '일본',
  France: '프랑스', 'New Zealand': '뉴질랜드', Egypt: '이집트', Spain: '스페인', 'Ivory Coast': '코트디부아르',
  "Cote d'Ivoire": '코트디부아르', 'Saudi Arabia': '사우디아라비아', Israel: '이스라엘', Romania: '루마니아',
  Uzbekistan: '우즈베키스탄', Guinea: '기니', Mali: '말리', Ukraine: '우크라이나', Morocco: '모로코',
  Paraguay: '파라과이', 'Dominican Republic': '도미니카공화국', 'United States': '미국', Zambia: '잠비아',
  Zimbabwe: '짐바브웨', Canada: '캐나다', Australia: '호주', China: '중국', 'China PR': '중국',
  Netherlands: '네덜란드', Chile: '칠레', 'Great Britain': '영국', Vietnam: '베트남', 'Costa Rica': '코스타리카',
  Panama: '파나마', Guatemala: '과테말라', Jamaica: '자메이카', Thailand: '태국', Cameroon: '카메룬',
  Ghana: '가나', Tunisia: '튀니지', Gabon: '가봉', Senegal: '세네갈', Uruguay: '우루과이', Venezuela: '베네수엘라',
  Ecuador: '에콰도르', Peru: '페루', Bolivia: '볼리비아', India: '인도', Iran: '이란', Qatar: '카타르',
  Kuwait: '쿠웨이트', 'United Arab Emirates': '아랍에미리트', Jordan: '요르단', Turkey: '튀르키예', Poland: '폴란드',
  Serbia: '세르비아', Italy: '이탈리아', England: '잉글랜드', Wales: '웨일스',
};

export const VENUE_MAP = {
  // 2026-09 시점 미확정(LA 2028) — 대회 임박 시 ESPN 실제 구장명 확인해 채울 것.
};

const LEAGUES = [
  { slug: 'fifa.olympics', gender: '남자', stripSuffix: / U23$/ },
  { slug: 'fifa.w.olympics', gender: '여자', stripSuffix: null },
];

// 롤링 윈도우 — 지난 대회 재확인(스코어 정정 등) + 다음 대회 조기 포착용.
const DAYS_BEFORE = 7;
const DAYS_AFTER = 400; // 올림픽은 4년 주기라 대회 임박 몇 달 전부터 조기 포착하려면 길게.

function fmtDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
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

function espnStatusToOurs(statusType) {
  const name = statusType?.name || '';
  if (/POSTPONED/i.test(name)) return 'postponed';
  if (/CANCELED|CANCELLED|ABANDONED/i.test(name)) return 'cancelled';
  if (statusType?.completed) return 'completed';
  if (statusType?.state === 'in') return 'live';
  return 'scheduled';
}

// ESPN scoreboard 응답에 이미 comp.details(득점 이벤트 배열)가 포함돼 있어서 별도 요청 불필요.
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

async function fetchRange(slug, gender, stripSuffix, fromYmd, toYmd, unknownTeams, unknownVenues) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${fromYmd}-${toYmd}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} olympicfootball-${gender}`);
  const j = await res.json();
  const games = [];
  for (const e of j.events || []) {
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === 'home');
    const away = comp.competitors?.find((c) => c.homeAway === 'away');
    let homeEn = home?.team?.displayName;
    let awayEn = away?.team?.displayName;
    if (!homeEn || !awayEn) continue;
    if (stripSuffix) { homeEn = homeEn.replace(stripSuffix, ''); awayEn = awayEn.replace(stripSuffix, ''); }
    const homeKoBase = TEAM_KO[homeEn];
    const awayKoBase = TEAM_KO[awayEn];
    if (!homeKoBase) unknownTeams?.add(`${gender}: ${homeEn}`);
    if (!awayKoBase) unknownTeams?.add(`${gender}: ${awayEn}`);
    if (!homeKoBase || !awayKoBase) continue;
    const venueName = comp.venue?.fullName;
    const venueId = venueName ? VENUE_MAP[venueName] : undefined;
    if (venueName && !venueId) unknownVenues?.add(`${gender}: ${venueName} (${homeEn} vs ${awayEn})`);
    if (!venueId) continue;
    const { date, time } = toKstDateTime(e.date);
    const status = espnStatusToOurs(comp.status?.type);
    const out = {
      date, time, league: 'OLYMPICFOOTBALL', venueId,
      home: `${homeKoBase} (${gender})`, away: `${awayKoBase} (${gender})`,
      stadium: venueName || '', timeTbd: !comp.timeValid,
      gameId: `OLYMPICFOOTBALL_ESPN_${e.id}`,
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

export async function fetchOlympicFootball(startDate, endDate, unknownTeams, unknownVenues) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const all = [];
  for (const { slug, gender, stripSuffix } of LEAGUES) {
    for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 14)) {
      const chunkEnd = new Date(Math.min(cursor.getTime() + 13 * 86400000, end.getTime()));
      const games = await fetchRange(slug, gender, stripSuffix, fmtDate(cursor), fmtDate(chunkEnd), unknownTeams, unknownVenues);
      all.push(...games);
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return all;
}

async function notifyUnknowns(unknownTeams, unknownVenues) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || (unknownTeams.size === 0 && unknownVenues.size === 0)) return;
  const lines = [];
  if (unknownTeams.size) lines.push(`**미확인 팀명(TEAM_KO에 추가 필요)**\n${[...unknownTeams].map((x) => `• ${x}`).join('\n')}`);
  if (unknownVenues.size) lines.push(`**미확인 구장(VENUE_MAP에 추가 필요 — 신규 올림픽 개최지일 가능성)**\n${[...unknownVenues].map((x) => `• ${x}`).join('\n')}`);
  const content = `🟡 그늘각 — 올림픽 축구 미확인 항목\nscripts/fetch-espn-olympic-football.mjs 에서 매핑 추가해주세요.\n${lines.join('\n\n')}`;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) {
    console.warn('[discord] olympic-football unknown notify failed:', e.message);
  }
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const now = new Date();
  const start = new Date(now.getTime() - DAYS_BEFORE * 86400000);
  const end = new Date(now.getTime() + DAYS_AFTER * 86400000);
  const startDate = ymd(start);
  const endDate = ymd(end);

  const unknownTeams = new Set();
  const unknownVenues = new Set();
  console.log(`Fetching Olympic football ${startDate}~${endDate} ...`);
  let allNew;
  try {
    allNew = await fetchOlympicFootball(startDate, endDate, unknownTeams, unknownVenues);
  } catch (e) {
    console.error('[olympic-football] fetch failed:', e.message);
    process.exit(1);
  }
  console.log(`  -> ${allNew.length} games`);
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
  console.log(`[olympic-football] added=${added} updated=${updated} total=${games.length}`);
}

main().catch((e) => {
  console.error('[olympic-football] fatal:', e);
  process.exit(1);
});

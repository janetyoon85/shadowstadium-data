// 1회성 백필(2026-09-28) — player-name-auto.json은 enrichEuroAssists가 "앞으로 새로 완료되는
// 경기"에서만 자동으로 채우는데, 이미 오래전에 완료돼 캐시가 final:true로 잠긴 수천 경기는
// 이 기능 도입 이전이라 한 번도 이 사전에 안 들어감 — 사용자 요청("기존 선수도 더 추가해줘",
// "과거 이미 종료된 경기도 재조회해서 이름 사전 채우기")으로 과거 완료 경기 전체를 다시 훑어서
// 채움. enrichEuroAssists의 매칭 로직(2026-09-28 동시킥오프+동일스코어 콜리전 수정 반영)을
// 이 목적에 맞게 축소 재사용 — games.json의 scorers 필드 자체는 건드리지 않고(스코프를 좁혀
// 리스크 최소화) player-name-auto.json만 채움.
//
// 실행 시간이 김(리그+날짜별 스코어보드 1,000회+, 매칭 성공 경기별 summary 요청) — 백그라운드로
// 돌리고 중간에 주기적으로 체크포인트 저장.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAthleteDisplayName } from './espn-nationality.mjs';
import { selectUniqueScoreMatch } from './espn-match-select.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const PLAYER_NAME_AUTO_PATH = path.join(REPO_ROOT, 'player-name-auto.json');
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const REQUEST_DELAY_MS = 400;
const CHECKPOINT_EVERY = 25;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchEspnScoreboard(slug, yyyymmdd) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${yyyymmdd}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} scoreboard ${slug} ${yyyymmdd}`);
  const json = await res.json();
  return json.events || [];
}

async function fetchEspnSummary(slug, eventId) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} summary ${slug} ${eventId}`);
  return res.json();
}

function extractEspnGoalsBySide(summaryJson, homeTeamName, awayTeamName) {
  const events = summaryJson.keyEvents || [];
  const home = [];
  const away = [];
  for (const e of events) {
    const typeText = (e.type && e.type.text) || '';
    if (!/goal/i.test(typeText)) continue;
    const scoringTeam = e.team && e.team.displayName;
    const side = scoringTeam === homeTeamName ? 'home' : scoringTeam === awayTeamName ? 'away' : null;
    if (side == null) continue;
    const clockDigits = (e.clock && e.clock.displayValue) || '';
    const clockNum = parseInt(clockDigits, 10);
    const athleteId = e.participants?.[0]?.athlete?.id;
    const teamId = e.team?.id;
    const entry = { m: Number.isFinite(clockNum) ? clockNum : null, teamId, athleteId };
    (side === 'home' ? home : away).push(entry);
  }
  return { home, away };
}

function naverKickoffUtcMs(g) {
  return Date.parse(`${g.date}T${g.time}:00+09:00`);
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const src = await fs.readFile(path.join(__dirname, 'fetch-schedule.mjs'), 'utf-8');
  const m = src.match(/const ESPN_LEAGUE_SLUG = \{([\s\S]*?)\n\};/);
  const slugMap = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^\s*([A-Z0-9]+):\s*'([^']+)'/);
    if (mm) slugMap[mm[1]] = mm[2];
  }

  const games = await loadJson(GAMES_FILE, []);
  const autoDict = await loadJson(PLAYER_NAME_AUTO_PATH, {});

  const targets = games.filter(
    (g) => slugMap[g.league] && g.status === 'completed' && g.gameId && g.date && g.time &&
      ((g.scorers?.home || []).some((s) => s.n) || (g.scorers?.away || []).some((s) => s.n)),
  );

  // 리그+날짜별로 묶어서 스코어보드 재사용(같은 날 여러 경기).
  const groups = new Map();
  for (const g of targets) {
    const key = `${g.league}|${g.date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }

  console.log(`[backfill] targets=${targets.length} groups=${groups.size}`);

  let processed = 0;
  let matched = 0;
  let added = 0;
  let scoreboardFail = 0;
  let summaryFail = 0;

  for (const [key, groupGames] of groups) {
    const [league] = key.split('|');
    const slug = slugMap[league];
    const day = groupGames[0].date.replace(/-/g, '');
    let events;
    try {
      await sleep(REQUEST_DELAY_MS);
      events = await fetchEspnScoreboard(slug, day);
    } catch (e) {
      scoreboardFail++;
      continue;
    }

    for (const g of groupGames) {
      processed++;
      const kickoffMs = naverKickoffUtcMs(g);
      const match = selectUniqueScoreMatch(events, kickoffMs, g.homeScore, g.awayScore);
      if (!match) continue;

      const comp = match.competitions?.[0];
      const homeC = comp?.competitors?.find((c) => c.homeAway === 'home');
      const awayC = comp?.competitors?.find((c) => c.homeAway === 'away');
      let summary;
      try {
        await sleep(REQUEST_DELAY_MS);
        summary = await fetchEspnSummary(slug, match.id);
      } catch (e) {
        summaryFail++;
        continue;
      }
      const espnGoals = extractEspnGoalsBySide(summary, homeC?.team?.displayName, awayC?.team?.displayName);
      const naverHomeLen = (g.scorers?.home || []).length;
      const naverAwayLen = (g.scorers?.away || []).length;
      if (espnGoals.home.length !== naverHomeLen || espnGoals.away.length !== naverAwayLen) continue;
      matched++;

      for (const [naverArr, espnArr] of [
        [g.scorers?.home || [], espnGoals.home],
        [g.scorers?.away || [], espnGoals.away],
      ]) {
        const naverSorted = [...naverArr].sort((a, b) => (a.m ?? 999) - (b.m ?? 999));
        const espnSorted = [...espnArr].sort((a, b) => (a.m ?? 999) - (b.m ?? 999));
        for (let i = 0; i < naverSorted.length; i++) {
          const s = naverSorted[i];
          const espnEntry = espnSorted[i];
          if (!s.n || !espnEntry?.teamId || !espnEntry?.athleteId) continue;
          try {
            const displayName = await getAthleteDisplayName('soccer', slug, espnEntry.teamId, espnEntry.athleteId);
            if (displayName && autoDict[s.n] !== displayName) {
              autoDict[s.n] = displayName;
              added++;
            }
          } catch {
            // 로스터 fetch 실패 — 이 선수만 건너뜀(전체 백필 중단하지 않음).
          }
        }
      }

      if (processed % CHECKPOINT_EVERY === 0) {
        await fs.writeFile(PLAYER_NAME_AUTO_PATH, JSON.stringify(autoDict, null, 2) + '\n', 'utf-8');
        console.log(`[backfill] progress processed=${processed}/${targets.length} matched=${matched} added=${added} scoreboardFail=${scoreboardFail} summaryFail=${summaryFail}`);
      }
    }
  }

  await fs.writeFile(PLAYER_NAME_AUTO_PATH, JSON.stringify(autoDict, null, 2) + '\n', 'utf-8');
  console.log(`[backfill] DONE processed=${processed} matched=${matched} added=${added} scoreboardFail=${scoreboardFail} summaryFail=${summaryFail} totalDictSize=${Object.keys(autoDict).length}`);
}

main().catch((err) => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});

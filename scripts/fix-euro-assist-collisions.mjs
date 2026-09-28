// 1회성 정리 스크립트(2026-09-28) — enrichEuroAssists의 동시킥오프+동일스코어 오매칭 버그
// (fetch-schedule.mjs의 match-selection 수정과 함께 적용)로 이미 오염된 과거 데이터 정리.
//
// 대상: 같은 리그(ESPN_LEAGUE_SLUG 대상)에서 같은 날짜+시각에 킥오프하고 최종 스코어까지
// 동일한 완료 경기가 2개 이상 있는 경우(2026-09-28 실측: 249경기) — 이 경기들은 어시스트/
// 국적/카드가 전혀 무관한 다른 경기 데이터로 오염됐을 위험이 있어, scorers의 a/nat/aNat과
// cards 필드를 지우고 euro_assists.json/euro_cards.json 캐시 항목도 삭제해서 다음 실행에서
// 수정된 로직으로 재처리(또는 안전하게 미매칭 처리)되게 함.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const EURO_ASSISTS_FILE = path.join(REPO_ROOT, 'euro_assists.json');
const EURO_CARDS_FILE = path.join(REPO_ROOT, 'euro_cards.json');

const ESPN_LEAGUE_SRC = await fs.readFile(path.join(__dirname, 'fetch-schedule.mjs'), 'utf-8');
const m = ESPN_LEAGUE_SRC.match(/const ESPN_LEAGUE_SLUG = \{([\s\S]*?)\n\};/);
const leagueKeys = new Set([...m[1].matchAll(/^\s*([A-Z0-9]+):/gm)].map((x) => x[1]));

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const games = await loadJson(GAMES_FILE, []);
  const euroAssists = await loadJson(EURO_ASSISTS_FILE, {});
  const euroCards = await loadJson(EURO_CARDS_FILE, {});

  const groups = new Map();
  for (const g of games) {
    if (!g.gameId || !leagueKeys.has(g.league) || !g.date || !g.time || g.status !== 'completed') continue;
    const key = `${g.league}|${g.date}|${g.time}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }

  const affected = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    const byScore = new Map();
    for (const g of arr) {
      const sk = `${g.homeScore}-${g.awayScore}`;
      if (!byScore.has(sk)) byScore.set(sk, []);
      byScore.get(sk).push(g);
    }
    for (const sub of byScore.values()) {
      if (sub.length > 1) affected.push(...sub);
    }
  }

  let cleaned = 0;
  for (const g of affected) {
    let touched = false;
    for (const side of ['home', 'away']) {
      const list = g.scorers?.[side];
      if (Array.isArray(list)) {
        for (const s of list) {
          if ('a' in s || 'nat' in s || 'aNat' in s) {
            delete s.a;
            delete s.nat;
            delete s.aNat;
            touched = true;
          }
        }
      }
    }
    if (g.cards && (g.cards.home?.length || g.cards.away?.length)) {
      g.cards = { home: [], away: [] };
      touched = true;
    }
    if (euroAssists[g.gameId]) {
      delete euroAssists[g.gameId];
      touched = true;
    }
    if (euroCards[g.gameId]) {
      delete euroCards[g.gameId];
      touched = true;
    }
    if (touched) cleaned++;
  }

  await fs.writeFile(GAMES_FILE, JSON.stringify(games, null, 2) + '\n', 'utf-8');
  await fs.writeFile(EURO_ASSISTS_FILE, JSON.stringify(euroAssists, null, 2) + '\n', 'utf-8');
  await fs.writeFile(EURO_CARDS_FILE, JSON.stringify(euroCards, null, 2) + '\n', 'utf-8');
  console.log(`[fix-euro-assist-collisions] affected=${affected.length} cleaned=${cleaned}`);
}

main().catch((err) => {
  console.error('[fix-euro-assist-collisions] FATAL:', err);
  process.exit(1);
});

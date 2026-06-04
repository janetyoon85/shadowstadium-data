// Phase 4B cron — 매 */15 min UTC 실행, 발송 윈도우 도달한 (game, lead) 쌍을 FCM 토픽으로 push.
//
// 로직:
//   for each scheduled, non-TBD game g:
//     S = Date.parse(`${g.date}T${g.time}:00+09:00`)   // KST 고정 (DST 없음)
//     if (now >= S) skip                                 // 이미 시작
//     for L of [1,3,6,12,24]:
//       key = `${g.gameId}_h${L}`
//       if (sent[key]) skip                              // 이미 발송
//       if (now < S - L*3600000) skip                    // 윈도우 미도달
//       sendGame(g.gameId, L, {...})                     // → game_<id>_h<L>
//       sent[key] = ISO timestamp
//
// 가드:
//   - status !== 'scheduled' → skip
//   - timeTbd → skip
//   - 중복 gameId (예: K1_1 데이터 이슈) → 첫 occurrence만 처리, 두 번째는 warn + skip
//   - 알 수 없는 league → 기본 이모지
//
// 출력: sent-reminders.json (repo 커밋). 워크플로가 변경 있으면 push.
// 정리: 게임 시작 24h 지난 sent 엔트리는 자동 삭제 (파일 크기 관리).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendGame } from './send-reminders.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games_2026.json');
const SENT_FILE = path.join(REPO_ROOT, 'sent-reminders.json');

const LEAD_HOURS = [1, 3, 6, 12, 24];
const SPORT_ICON = { KBO: '⚾', 'K리그1': '⚽', 'K리그2': '⚽' };
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

function startMs(date, time) {
  // KST = UTC+9, 한국은 DST 없음.
  return Date.parse(`${date}T${time}:00+09:00`);
}

async function loadJson(file, fallback) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function buildContent(g) {
  const icon = SPORT_ICON[g.league] ?? '🏟️';
  const dh = g.doubleheaderNum ? ` (${g.doubleheaderNum}차전)` : '';
  const stadium = g.stadium ? ` · ${g.stadium}` : '';
  return {
    title: `${icon} ${g.away} vs ${g.home}${stadium}`,
    body: `${g.time} 경기${dh} · 그늘 자리·날씨 확인`,
  };
}

async function main() {
  const games = await loadJson(GAMES_FILE, []);
  const sent = await loadJson(SENT_FILE, {});
  const now = Date.now();

  if (!Array.isArray(games) || games.length === 0) {
    console.error('[reminders] games_2026.json empty/invalid');
    process.exit(1);
  }

  const seenGameIds = new Set();
  const sends = [];

  for (const g of games) {
    if (g.status !== 'scheduled') continue;
    if (g.timeTbd) continue;
    if (!g.gameId) continue;
    if (seenGameIds.has(g.gameId)) {
      console.warn(`[reminders] dup gameId, skip 2nd: ${g.gameId} ${g.date} ${g.away}@${g.home}`);
      continue;
    }
    seenGameIds.add(g.gameId);

    const S = startMs(g.date, g.time);
    if (Number.isNaN(S)) {
      console.warn(`[reminders] invalid datetime: ${g.gameId} ${g.date} ${g.time}`);
      continue;
    }
    if (now >= S) continue;

    for (const L of LEAD_HOURS) {
      const key = `${g.gameId}_h${L}`;
      if (sent[key]) continue;
      if (now < S - L * 3600000) continue;
      sends.push({ g, L, key });
    }
  }

  // 발송
  let sentCount = 0;
  for (const s of sends) {
    const { title, body } = buildContent(s.g);
    try {
      const id = await sendGame(s.g.gameId, s.L, {
        title,
        body,
        venueId: s.g.venueId,
        date: s.g.date,
        doubleheaderNum: s.g.doubleheaderNum,
      });
      sent[s.key] = new Date().toISOString();
      sentCount++;
      console.log(`[reminders] sent ${s.key} → ${id}`);
    } catch (e) {
      console.error(`[reminders] FAIL ${s.key}: ${e?.message ?? e}`);
    }
  }

  // Cleanup: 24h+ 지난 게임의 sent 엔트리 제거 (파일 크기 관리).
  // gameId가 games 데이터에서 사라진 경우는 보존 (안전).
  const gameById = new Map(games.map((g) => [g.gameId, g]).filter(([k]) => k));
  let cleaned = 0;
  for (const key of Object.keys(sent)) {
    const gameId = key.split('_h')[0];
    const g = gameById.get(gameId);
    if (!g || g.timeTbd) continue;
    const S = startMs(g.date, g.time);
    if (Number.isNaN(S)) continue;
    if (S + CLEANUP_AFTER_MS < now) {
      delete sent[key];
      cleaned++;
    }
  }

  await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 2) + '\n', 'utf8');
  console.log(`[reminders] sent=${sentCount} cleaned=${cleaned} total_state=${Object.keys(sent).length}`);
}

main().catch((err) => {
  console.error('[reminders] FATAL:', err);
  process.exit(1);
});

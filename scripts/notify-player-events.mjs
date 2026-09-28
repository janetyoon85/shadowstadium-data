// 즐겨찾기 선수 알림(2026-09-28) 감지+발송 cron. 5분 주기(cron-job.org 트리거).
//
// cron-reminders.mjs 와 동일 철학: "새 스냅샷 vs 이전 스냅샷 diff"가 아니라 "이미 보낸 키
// 집합에 없는 것만 보낸다" — 배열 인덱스를 dedup 키에 포함하므로 scorers 배열이 append-only로
// 유지된다는 가정에 의존(기존 enrichEuroAssists의 index-zip 방식과 동급 리스크, 수용됨).
//
// 1차 스코프: 축구 골(scorers[].n)/어시(scorers[].a)만. 야구는 2차(하이라이트 player 필드
// 추가 후) 예정.
//
// 서버는 누가 그 선수를 즐겨찾기했는지 모름 — 구독자 0인 토픽에 발송해도 FCM에서 무해한
// no-op이라, 매 경기의 모든 스코어러에 대해 그냥 다 발송한다(팀 리마인더와 동일 설계).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendPlayerEvent } from './send-player-alert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const SENT_FILE = path.join(REPO_ROOT, 'sent-player-alerts.json');

const CLEANUP_AFTER_DAYS = 14;

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function scoreLine(g) {
  if (typeof g.homeScore !== 'number' || typeof g.awayScore !== 'number') return '';
  return ` · ${g.away} ${g.awayScore}-${g.homeScore} ${g.home}`;
}

async function main() {
  const games = await loadJson(GAMES_FILE, []);
  const sent = await loadJson(SENT_FILE, {});
  if (!Array.isArray(games) || games.length === 0) {
    console.error('[player-alerts] games.json empty/invalid');
    process.exit(1);
  }

  const pending = [];
  for (const g of games) {
    if (!g.gameId || !g.scorers) continue;
    const sides = [
      { key: 'home', team: g.home },
      { key: 'away', team: g.away },
    ];
    for (const { key, team } of sides) {
      const list = g.scorers[key];
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.n) {
          const dedupKey = `${g.gameId}:${key}:scorer:${i}`;
          if (!sent[dedupKey]) pending.push({ dedupKey, name: s.n, game: g, team, kind: 'goal', minute: s.m });
        }
        if (s.a) {
          const dedupKey = `${g.gameId}:${key}:assist:${i}`;
          if (!sent[dedupKey]) pending.push({ dedupKey, name: s.a, game: g, team, kind: 'assist', minute: s.m });
        }
      }
    }
  }

  let sentCount = 0;
  for (const item of pending) {
    const { dedupKey, name, game: g, team, kind, minute } = item;
    const icon = kind === 'goal' ? '⚽' : '🅰️';
    const label = kind === 'goal' ? '골' : '어시스트';
    const minuteLabel = typeof minute === 'number' ? ` (${minute}분)` : '';
    const title = `${icon} ${name} ${label}!`;
    const body = `${team}${scoreLine(g)}${minuteLabel}`;
    try {
      await sendPlayerEvent(name, { title, body, gameId: g.gameId });
      sent[dedupKey] = new Date().toISOString();
      sentCount++;
    } catch (e) {
      console.error(`[player-alerts] FAIL ${dedupKey}: ${e?.message ?? e}`);
    }
  }

  // Cleanup: games.json에서 사라졌거나 오래된(14일+) 경기의 sent 엔트리 제거.
  const gameById = new Map(games.map((g) => [g.gameId, g]).filter(([k]) => k));
  const now = Date.now();
  let cleaned = 0;
  for (const key of Object.keys(sent)) {
    const gameId = key.split(':')[0];
    const g = gameById.get(gameId);
    if (!g) continue; // 데이터에서 사라진 경우는 보존(안전) — 리마인더와 동일 방침.
    const gameMs = Date.parse(`${g.date}T00:00:00+09:00`);
    if (!Number.isNaN(gameMs) && now - gameMs > CLEANUP_AFTER_DAYS * 24 * 3600000) {
      delete sent[key];
      cleaned++;
    }
  }

  await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 2) + '\n', 'utf8');
  console.log(`[player-alerts] sent=${sentCount} cleaned=${cleaned} total_state=${Object.keys(sent).length}`);
}

main().catch((err) => {
  console.error('[player-alerts] FATAL:', err);
  process.exit(1);
});

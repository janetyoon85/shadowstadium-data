// 즐겨찾기 선수 알림(2026-09-28) 감지+발송 cron. 5분 주기(cron-job.org 트리거).
//
// cron-reminders.mjs 와 동일 철학: "새 스냅샷 vs 이전 스냅샷 diff"가 아니라 "이미 보낸 키
// 집합에 없는 것만 보낸다" — 배열 인덱스를 dedup 키에 포함하므로 scorers 배열이 append-only로
// 유지된다는 가정에 의존(기존 enrichEuroAssists의 index-zip 방식과 동급 리스크, 수용됨).
//
// 1차 스코프: 축구 골(scorers[].n)/어시(scorers[].a)/카드(cards[].n). 야구는 2차(하이라이트
// player 필드 추가 후) 예정.
//
// 서버는 누가 그 선수를 즐겨찾기했는지 모름 — 구독자 0인 토픽에 발송해도 FCM에서 무해한
// no-op이라, 매 경기의 모든 스코어러에 대해 그냥 다 발송한다(팀 리마인더와 동일 설계).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendPlayerEvent } from './send-player-alert.mjs';
import { canonicalPlayerName } from './player-name-canon.mjs';

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
    if (!g.gameId || (!g.scorers && !g.cards)) continue;
    const sides = [
      { key: 'home', team: g.home },
      { key: 'away', team: g.away },
    ];
    if (g.scorers) {
      for (const { key, team } of sides) {
        const list = g.scorers[key];
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          // 득점자(한글, 네이버원문)/어시스트(영문, ESPN원문)가 같은 선수여도 문자열이 갈라지는
          // 문제 발견(2026-09-28) — canonicalPlayerName으로 정규화해서 토픽을 계산해야 "손흥민"으로
          // 즐겨찾기한 사람이 어시스트("Son Heung-Min")에도 알림을 받음(build-player-index.mjs와
          // 동일 정규화 재사용, 두 스크립트가 다른 이름으로 정규화하면 다시 어긋나므로 반드시 동기화).
          if (s.n) {
            const dedupKey = `${g.gameId}:${key}:scorer:${i}`;
            if (!sent[dedupKey]) pending.push({ dedupKey, name: canonicalPlayerName(s.n), game: g, team, kind: 'goal', minute: s.m });
          }
          if (s.a) {
            const dedupKey = `${g.gameId}:${key}:assist:${i}`;
            if (!sent[dedupKey]) pending.push({ dedupKey, name: canonicalPlayerName(s.a), game: g, team, kind: 'assist', minute: s.m });
          }
        }
      }
    }
    // 카드(경고/퇴장) 알림(2026-09-28, 사용자 요청) — cards[].n도 리그마다 원문 언어가 달라
    // 골/어시와 동일하게 canonicalPlayerName으로 정규화.
    if (g.cards) {
      for (const { key, team } of sides) {
        const list = g.cards[key];
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c.n) continue;
          const dedupKey = `${g.gameId}:${key}:card:${i}`;
          if (!sent[dedupKey]) pending.push({ dedupKey, name: canonicalPlayerName(c.n), game: g, team, kind: c.type === 'R' ? 'red' : 'yellow', minute: c.m });
        }
      }
    }
  }

  let sentCount = 0;
  for (const item of pending) {
    const { dedupKey, name, game: g, team, kind, minute } = item;
    const icon = kind === 'goal' ? '⚽' : kind === 'assist' ? '🅰️' : kind === 'red' ? '🟥' : '🟨';
    const label = kind === 'goal' ? '골' : kind === 'assist' ? '어시스트' : kind === 'red' ? '퇴장' : '경고';
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

// B-5d: cancelled 게임의 rescheduledTo 자동 추론
//
// 매칭 규칙:
//   - cancelled G_c → 미래 30일 이내 doubleheaderNum=2 게임 G_dh2 찾기
//   - 같은 (home, away, league) 필수
//   - 같은 venueId 가산점 (다르면 LOW 신뢰)
//   - 후보 1개 + 동일 venue + 7일 이내 → HIGH
//   - 후보 1개 + 동일 venue + 7-15일 → MEDIUM
//   - 후보 1개 + 16-30일 OR venue 다름 → LOW
//   - 후보 2개 이상 → AMBIGUOUS (가장 가까운 날짜 채택, 나머진 alternatives)
//
// CLI:
//   --dry-run   : 파일 수정 X, console에 결과만
//   --verbose   : 모든 매칭 시도 로그
//
// Exit: 0 정상, 1 에러 (JSON 손상 등)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROD_PATH = path.join(REPO_ROOT, 'games_2026.json');

const WINDOW_DAYS = 30;
const HIGH_MAX_DAYS = 7;
const MEDIUM_MAX_DAYS = 15;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERBOSE = argv.includes('--verbose');

function daysBetween(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00`).getTime();
  const b = new Date(`${dateB}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

function gameKey(g) {
  return `${g.venueId}_${g.date}${g.doubleheaderNum === 2 ? '_2' : ''}`;
}

/**
 * Find rescheduledTo candidate for a cancelled game.
 * @param {Object} cancelled - the cancelled game
 * @param {Array} allGames - full dataset
 * @returns {{ match: Object|null, confidence: string|null, alternatives: Array, daysAway: number|null }}
 */
function findRescheduleCandidate(cancelled, allGames) {
  const candidates = allGames.filter((g) => {
    if (g.status !== 'scheduled') return false;
    if (g.doubleheaderNum !== 2) return false;
    if (g.league !== cancelled.league) return false;
    if (g.home !== cancelled.home || g.away !== cancelled.away) return false;
    const days = daysBetween(cancelled.date, g.date);
    if (days < 1 || days > WINDOW_DAYS) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { match: null, confidence: null, alternatives: [], daysAway: null };
  }

  // Sort by distance (closest first)
  candidates.sort((a, b) => daysBetween(cancelled.date, a.date) - daysBetween(cancelled.date, b.date));
  const chosen = candidates[0];
  const daysAway = daysBetween(cancelled.date, chosen.date);
  const sameVenue = chosen.venueId === cancelled.venueId;

  let confidence;
  if (candidates.length > 1) {
    confidence = 'AMBIGUOUS';
  } else if (!sameVenue) {
    confidence = 'LOW';
  } else if (daysAway <= HIGH_MAX_DAYS) {
    confidence = 'HIGH';
  } else if (daysAway <= MEDIUM_MAX_DAYS) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  return {
    match: chosen,
    confidence,
    alternatives: candidates.slice(1),
    daysAway,
  };
}

async function main() {
  let raw;
  try {
    raw = await fs.readFile(PROD_PATH, 'utf-8');
  } catch (e) {
    console.error(`[fatal] cannot read ${PROD_PATH}: ${e.message}`);
    process.exit(1);
  }

  let games;
  try {
    games = JSON.parse(raw);
    if (!Array.isArray(games)) throw new Error('not an array');
  } catch (e) {
    console.error(`[fatal] invalid JSON: ${e.message}`);
    process.exit(1);
  }

  const cancelled = games.filter((g) => g.status === 'cancelled');
  const tally = { HIGH: 0, MEDIUM: 0, LOW: 0, AMBIGUOUS: 0 };
  let unmatched = 0;
  const warnings = [];
  let changedCount = 0;

  for (const g of games) {
    if (g.status !== 'cancelled') {
      // 비-cancelled에 잘못 채워진 rescheduledTo가 있으면 지움
      if (g.rescheduledTo) {
        if (VERBOSE) console.log(`[clean] non-cancelled had rescheduledTo: ${gameKey(g)}`);
        delete g.rescheduledTo;
        changedCount++;
      }
      continue;
    }

    const prev = g.rescheduledTo;
    const { match, confidence, alternatives, daysAway } = findRescheduleCandidate(g, games);

    if (!match) {
      if (prev) {
        if (VERBOSE) console.log(`[unmatch] ${gameKey(g)} previously had rescheduledTo=${prev}, clearing`);
        delete g.rescheduledTo;
        changedCount++;
      }
      unmatched++;
      if (VERBOSE) {
        console.log(`[unmatched] ${g.date} ${g.venueId} ${g.home} vs ${g.away} → no candidate in +1~+${WINDOW_DAYS}d`);
      }
      continue;
    }

    tally[confidence]++;
    const newValue = match.date;
    if (prev !== newValue) {
      g.rescheduledTo = newValue;
      changedCount++;
    }

    if (VERBOSE || confidence === 'LOW' || confidence === 'AMBIGUOUS') {
      const altStr = alternatives.length > 0
        ? ` (other candidates: ${alternatives.map((a) => `${a.date}@${a.venueId}`).join(', ')})`
        : '';
      const line = `[${confidence}] ${g.date} ${g.venueId} ${g.home} vs ${g.away} → ${match.date}@${match.venueId} (${daysAway}d)${altStr}`;
      if (confidence === 'LOW' || confidence === 'AMBIGUOUS') {
        console.warn(line);
        warnings.push({
          game: gameKey(g),
          confidence,
          reason: confidence === 'AMBIGUOUS'
            ? `${alternatives.length + 1} candidates within ${WINDOW_DAYS}d`
            : !match.venueId || match.venueId !== g.venueId ? 'venue mismatch'
            : `${daysAway} days away (>15d)`,
          alternatives: alternatives.map((a) => ({ date: a.date, venueId: a.venueId })),
        });
      } else {
        console.log(line);
      }
    }
  }

  const summary = {
    totalCancelled: cancelled.length,
    matched: tally,
    unmatched,
    warnings,
    changedCount,
    dryRun: DRY_RUN,
  };

  console.log(`\n[summary] ${JSON.stringify(summary, null, 2)}`);

  if (DRY_RUN) {
    console.log(`\n[dry-run] no file modified. ${changedCount} field(s) would change.`);
    return;
  }

  if (changedCount === 0) {
    console.log(`\n[no-op] no rescheduledTo changes. file untouched.`);
    return;
  }

  await fs.writeFile(PROD_PATH, JSON.stringify(games, null, 2) + '\n', 'utf-8');
  console.log(`\n[update] ${PROD_PATH} rewritten (${changedCount} rescheduledTo field(s) modified)`);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});

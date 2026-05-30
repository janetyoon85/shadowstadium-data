const REQUIRED_FIELDS = ['date', 'time', 'league', 'venueId', 'home', 'away'];
const VALID_LEAGUES = ['KBO', 'K리그1', 'K리그2'];
const VALID_STATUSES = ['scheduled', 'cancelled', 'postponed', 'completed'];

const MIN_COUNTS = {
  KBO: 500,
  'K리그1': 150,
  'K리그2': 200,
};

export function validateGame(game) {
  const errors = [];
  for (const f of REQUIRED_FIELDS) {
    if (!game[f]) errors.push(`missing ${f}`);
  }
  if (game.date && !/^\d{4}-\d{2}-\d{2}$/.test(game.date)) errors.push(`bad date format: ${game.date}`);
  if (game.time && !/^\d{2}:\d{2}$/.test(game.time)) errors.push(`bad time format: ${game.time}`);
  if (game.league && !VALID_LEAGUES.includes(game.league)) errors.push(`bad league: ${game.league}`);
  if (game.status && !VALID_STATUSES.includes(game.status)) errors.push(`bad status: ${game.status}`);
  if (game.doubleheaderNum != null && game.doubleheaderNum !== 1 && game.doubleheaderNum !== 2) {
    errors.push(`bad doubleheaderNum: ${game.doubleheaderNum}`);
  }
  return errors;
}

export function validateDataset(games) {
  const errors = [];
  const warnings = [];

  // Per-game (excluding missing venueId — handled separately as filterable)
  let badCount = 0;
  for (const g of games) {
    const ge = validateGame(g).filter((e) => e !== 'missing venueId');
    if (ge.length > 0) {
      badCount++;
      if (badCount <= 5) {
        errors.push(`game ${g.gameId || '<no-id>'} (${g.date || '?'} ${g.home || '?'}vs${g.away || '?'}): ${ge.join(', ')}`);
      }
    }
  }
  if (badCount > 5) errors.push(`... and ${badCount - 5} more invalid games`);
  const missingVenue = games.filter((g) => !g.venueId).length;
  if (missingVenue > 0) warnings.push(`${missingVenue} games missing venueId → will be filtered from prod output`);

  // League counts (only games that will actually be exported = have venueId)
  const cnt = { KBO: 0, 'K리그1': 0, 'K리그2': 0 };
  for (const g of games) {
    if (!g.venueId) continue;
    if (cnt[g.league] !== undefined) cnt[g.league]++;
  }
  for (const [league, min] of Object.entries(MIN_COUNTS)) {
    if (cnt[league] < min) {
      errors.push(`${league} count ${cnt[league]} < ${min} threshold`);
    }
  }

  // gameId dupe check
  const seen = new Map();
  let dupeCount = 0;
  for (const g of games) {
    if (!g.gameId) continue;
    if (seen.has(g.gameId)) {
      dupeCount++;
      if (dupeCount <= 5) {
        errors.push(`duplicate gameId: ${g.gameId} (${g.date} vs ${seen.get(g.gameId)})`);
      }
    } else {
      seen.set(g.gameId, g.date);
    }
  }
  if (dupeCount > 5) errors.push(`... and ${dupeCount - 5} more duplicate gameIds`);

  // Doubleheader sanity: same (date,venueId,home,away) should have at most 2 games
  const dh = new Map();
  for (const g of games) {
    const k = `${g.date}|${g.venueId}|${g.home}|${g.away}`;
    if (!dh.has(k)) dh.set(k, []);
    dh.get(k).push(g);
  }
  for (const [k, grp] of dh) {
    if (grp.length > 2) {
      warnings.push(`>2 games for ${k}: ${grp.map((x) => x.time + (x.doubleheaderNum ? `#${x.doubleheaderNum}` : '')).join(', ')}`);
    }
    if (grp.length === 2) {
      const nums = grp.map((x) => x.doubleheaderNum).sort();
      if (nums[0] !== 1 || nums[1] !== 2) {
        warnings.push(`doubleheader pair missing 1/2 nums: ${k} → ${nums}`);
      }
    }
  }

  // rescheduledTo integrity (B-5d)
  const rsErrors = validateRescheduledTo(games);
  errors.push(...rsErrors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts: cnt,
    totalGames: games.length,
  };
}

/**
 * B-5d: rescheduledTo 필드 정합성 검증.
 * - cancelled 게임만 rescheduledTo 가질 수 있음
 * - 값은 YYYY-MM-DD 형식
 * - 가리키는 날짜에 같은 (home, away, venueId) doubleheaderNum=2 게임이 실제 존재해야 함 (orphan reference 금지)
 * - cancelled date와 rescheduledTo가 같은 시즌(연도)에 속함
 */
export function validateRescheduledTo(games) {
  const errors = [];
  let orphanCount = 0;
  let badCount = 0;
  for (const g of games) {
    if (g.rescheduledTo == null) continue;
    const key = `${g.gameId || g.venueId + '_' + g.date}`;
    // status check: only cancelled can have rescheduledTo
    if (g.status !== 'cancelled') {
      badCount++;
      if (badCount <= 5) errors.push(`rescheduledTo on non-cancelled game ${key} (status=${g.status})`);
      continue;
    }
    // format check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.rescheduledTo)) {
      badCount++;
      if (badCount <= 5) errors.push(`rescheduledTo bad format ${key}: ${g.rescheduledTo}`);
      continue;
    }
    // same season check
    const cancelYear = g.date?.slice(0, 4);
    const targetYear = g.rescheduledTo.slice(0, 4);
    if (cancelYear && cancelYear !== targetYear) {
      badCount++;
      if (badCount <= 5) errors.push(`rescheduledTo cross-season ${key}: ${g.date} → ${g.rescheduledTo}`);
      continue;
    }
    // orphan reference check: target doubleheaderNum=2 game must exist
    const target = games.find((x) =>
      x.date === g.rescheduledTo &&
      x.venueId === g.venueId &&
      x.home === g.home &&
      x.away === g.away &&
      x.doubleheaderNum === 2,
    );
    if (!target) {
      orphanCount++;
      if (orphanCount <= 5) {
        errors.push(`rescheduledTo orphan ${key} → ${g.rescheduledTo} (no doubleheaderNum=2 game found for matchup)`);
      }
    }
  }
  if (badCount > 5) errors.push(`... and ${badCount - 5} more rescheduledTo errors`);
  if (orphanCount > 5) errors.push(`... and ${orphanCount - 5} more orphan references`);
  return errors;
}

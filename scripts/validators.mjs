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

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts: cnt,
    totalGames: games.length,
  };
}

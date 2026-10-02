// 농구 팀기록/선수기록 → basketball/stats.json
//   KBL/WKBL 팀기록: Naver statistics API (선수기록은 Naver가 농구엔 미제공)
//   NBA/WNBA 팀·선수기록: ESPN common v3 byteam/byathlete
// 6시간 이내 재실행이면 건너뜀(fetch-basketball 크론에 얹혀 돌기 때문).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'basketball');
const UA = 'Mozilla/5.0 (compatible; shadeside-crawler)';
const FORCE = process.argv.includes('--force');
const r1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);

async function getJson(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

const NAVER = [{ lg: 'KBL', cat: 'kbl' }, { lg: 'WKBL', cat: 'wkbl' }];
async function naverTeams(cfg) {
  const base = `https://api-gw.sports.naver.com/statistics/categories/${cfg.cat}`;
  const sj = await getJson(`${base}/seasons`);
  const seasons = (sj?.result?.seasons || []).slice().sort((a, b) => b.year - a.year);
  for (const s of seasons.slice(0, 3)) {
    const tj = await getJson(`${base}/seasons/${s.seasonCode}/teams`);
    const rows = (tj?.result?.seasonTeamStats || []).filter((x) => x.matchesPlayed > 0);
    if (!rows.length) continue;
    return {
      season: s.title,
      team: rows.map((x) => ({
        k: `naver:${cfg.lg}:${x.teamId}`, rank: x.rank, gp: x.matchesPlayed, w: x.wins, l: x.losses, pct: x.winRate,
        pts: r1(x.pointsPerGame), opp: r1(x.pointsConcededPerGame), reb: r1(x.reboundPerGame), ast: r1(x.assistPerGame),
        stl: r1(x.stealPerGame), blk: r1(x.blockShotPerGame), to: r1(x.turnoverPerGame),
        fg: r1(x.fieldGoalThrowSuccessRate), tp: r1(x.threePointSuccessRate), ft: r1(x.freeThrowSuccessRate),
      })).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    };
  }
  return null;
}

const ESPN = [{ lg: 'NBA', slug: 'nba' }, { lg: 'WNBA', slug: 'wnba' }];
async function espnPull(cfg, kind) {
  const base = `https://site.web.api.espn.com/apis/common/v3/sports/basketball/${cfg.slug}/statistics/${kind}?limit=300&seasontype=2`;
  let j = await getJson(base);
  const list = (x) => (x?.[kind === 'byteam' ? 'teams' : 'athletes'] || []);
  const played = (x) => list(x).some((e) => (flatWith(x, e).gamesPlayed || 0) > 0);
  if (j && !played(j) && j.currentSeason?.year) j = (await getJson(`${base}&season=${j.currentSeason.year - 1}`)) || j;
  return j;
}
function flatWith(j, e) {
  const o = {};
  (j.categories || []).forEach((c, ci) => {
    const ec = (e.categories || [])[ci] || (e.categories || []).find((x) => x.name === c.name);
    (c.names || []).forEach((n, i) => { if (!(n in o) && ec?.values) o[n] = ec.values[i]; });
  });
  return o;
}
async function espnLeague(cfg) {
  const tj = await espnPull(cfg, 'byteam');
  const pj = await espnPull(cfg, 'byathlete');
  const out = {};
  if (tj?.teams?.length) {
    const team = tj.teams.map((e) => {
      const s = flatWith(tj, e);
      return { k: `espn:${cfg.lg}:${e.team.id}`, gp: s.gamesPlayed, pts: r1(s.avgPoints), reb: r1(s.avgRebounds), ast: r1(s.avgAssists), stl: r1(s.avgSteals), blk: r1(s.avgBlocks), to: r1(s.avgTurnovers), fg: r1(s.fieldGoalPct), tp: r1(s.threePointFieldGoalPct), ft: r1(s.freeThrowPct) };
    }).filter((x) => x.gp > 0).sort((a, b) => (b.pts || 0) - (a.pts || 0));
    if (team.length) { out.team = team; out.season = tj.requestedSeason?.displayName || tj.currentSeason?.displayName; }
  }
  if (pj?.athletes?.length) {
    const player = pj.athletes.map((e) => {
      const s = flatWith(pj, e);
      const a = e.athlete;
      return { id: `espnbk:${cfg.lg.toLowerCase()}:${a.id}`, n: a.displayName, k: a.teamId ? `espn:${cfg.lg}:${a.teamId}` : undefined, pos: a.position?.abbreviation, gp: s.gamesPlayed, min: r1(s.avgMinutes), pts: r1(s.avgPoints), reb: r1(s.avgRebounds), ast: r1(s.avgAssists), stl: r1(s.avgSteals), blk: r1(s.avgBlocks), to: r1(s.avgTurnovers), fg: r1(s.fieldGoalPct), tp: r1(s.threePointFieldGoalPct), ft: r1(s.freeThrowPct) };
    }).filter((x) => x.gp >= 5).sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 150);
    if (player.length) { out.player = player; out.season ||= pj.requestedSeason?.displayName; }
  }
  return out.team || out.player ? out : null;
}

const file = path.join(DIR, 'stats.json');
let cur = {};
try { cur = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
const now = Date.now();
if (!FORCE && now - (cur.updated || 0) < 6 * 3600e3) { console.log('[bk-stats] fresh, skip'); process.exit(0); }
const leagues = cur.leagues || {};
for (const cfg of NAVER) {
  const r = await naverTeams(cfg);
  if (r) leagues[cfg.lg] = { ...(leagues[cfg.lg] || {}), ...r };
  else console.log('[bk-stats] naver miss', cfg.lg);
}
for (const cfg of ESPN) {
  const r = await espnLeague(cfg);
  if (r) leagues[cfg.lg] = { ...(leagues[cfg.lg] || {}), ...r };
  else console.log('[bk-stats] espn miss', cfg.lg);
}
await fs.writeFile(file, JSON.stringify({ updated: now, leagues }));
console.log('[bk-stats]', Object.entries(leagues).map(([k, v]) => `${k}: team=${v.team?.length || 0} player=${v.player?.length || 0} ${v.season || ''}`).join(' | '));

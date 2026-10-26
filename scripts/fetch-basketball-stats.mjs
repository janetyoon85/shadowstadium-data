// 농구 팀기록/선수기록 → basketball/stats.json
//   KBL/WKBL 팀기록: Naver statistics API (선수기록은 Naver가 농구엔 미제공)
//   NBA/WNBA 팀·선수기록: ESPN common v3 byteam/byathlete
// 50분 이내 재실행이면 건너뜀.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'basketball');
const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)';
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

import { EL_SEASON, EL_API, elTeamKey, elName } from './euroleague-common.mjs';
const EL_SEASON_LABEL = (() => { const y = Number(EL_SEASON.replace(/^E/, '')); return `${y}-${String(y + 1).slice(2)}`; })();
const pct = (m, a) => (a > 0 ? r1((100 * m) / a) : undefined);
// 유로리그(공식 API): 팀·선수 경기당 평균. 선수 사진(headshot)은 player-wd.json 에 {img} 로 넣어 앱 선수단 화면이 쓰게 한다.
async function euroleagueStats() {
  const tj = await getJson(`${EL_API}/v3/competitions/E/statistics/teams/traditional?seasonMode=Single&seasonCode=${EL_SEASON}&limit=40`);
  const pj = await getJson(`${EL_API}/v3/competitions/E/statistics/players/traditional?seasonMode=Single&seasonCode=${EL_SEASON}&limit=400`);
  const std = await fs.readFile(path.join(DIR, 'standings.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  const gpOpp = Object.fromEntries((std['espn:EUROLEAGUE']?.rows || []).map((r) => [r.k, r.gp && r.pa ? r1(Number(r.pa) / r.gp) : undefined]));
  const out = {};
  if (tj?.teams?.length) {
    const team = tj.teams.map((e) => {
      const k = elTeamKey(e.team.code);
      return k && { k, gp: e.gamesPlayed, pts: r1(e.pointsScored), opp: gpOpp[k], reb: r1(e.totalRebounds), ast: r1(e.assists), stl: r1(e.steals), blk: r1(e.blocks), to: r1(e.turnovers), fg: pct(e.twoPointersMade + e.threePointersMade, e.twoPointersAttempted + e.threePointersAttempted), tp: pct(e.threePointersMade, e.threePointersAttempted), ft: pct(e.freeThrowsMade, e.freeThrowsAttempted) };
    }).filter((x) => x && x.gp > 0).sort((a, b) => (b.pts || 0) - (a.pts || 0));
    if (team.length) { out.team = team; out.season = EL_SEASON_LABEL; }
  }
  const photos = {};
  if (pj?.players?.length) {
    const player = pj.players.map((e) => {
      const p = e.player, k = elTeamKey(p.team?.code), id = `elbk:${p.code}`;
      if (p.imageUrl) photos[id] = { img: p.imageUrl, en: elName(p.name), src: 'euroleague' };
      return { id, n: elName(p.name), k: k || undefined, gp: e.gamesPlayed, min: r1(e.minutesPlayed), pts: r1(e.pointsScored), reb: r1(e.totalRebounds), ast: r1(e.assists), stl: r1(e.steals), blk: r1(e.blocks), to: r1(e.turnovers), fg: pct(e.twoPointersMade + e.threePointersMade, e.twoPointersAttempted + e.threePointersAttempted), tp: pct(e.threePointersMade, e.threePointersAttempted), ft: pct(e.freeThrowsMade, e.freeThrowsAttempted) };
    }).filter((x) => x.gp >= 3).sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 150);
    if (player.length) { out.player = player; out.season ||= EL_SEASON_LABEL; }
  }
  if (Object.keys(photos).length) {
    const wdFile = path.join(DIR, 'player-wd.json');
    const wd = await fs.readFile(wdFile, 'utf8').then(JSON.parse).catch(() => ({}));
    let n = 0;
    for (const [id, v] of Object.entries(photos)) if (!wd[id]?.img) { wd[id] = { ...(wd[id] || {}), ...v }; n++; }
    if (n) await fs.writeFile(wdFile, JSON.stringify(wd));
  }
  return out.team || out.player ? out : null;
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

// 네이버는 농구 선수기록 API가 없어 박스스코어(box-*.json)를 직접 집계(2026-10-03). 시즌 초반엔 표본이 적다.
async function naverPlayersFromBox(lg) {
  const games = JSON.parse(await fs.readFile(path.join(DIR, 'games.json'), 'utf8').catch(() => '{}'));
  const gm = new Map((games.games || games || []).filter?.((g) => g.lg === lg).map((g) => [g.id, g]) || []);
  const acc = new Map();
  const files = (await fs.readdir(DIR)).filter((f) => /^box-\d{4}-\d{2}\.json$/.test(f)).sort();
  const prefix = `nbk:${lg.toLowerCase()}:`;
  for (const f of files) {
    const b = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8'));
    for (const [id, box] of Object.entries(b)) {
      if (!id.startsWith('nv:')) continue;
      for (const side of ['h', 'a']) {
        for (const p of box.pl?.[side] || []) {
          if (!p.pid?.startsWith(prefix)) continue;
          const [mm, ss] = String(p.min || '0:0').split(':').map(Number);
          const min = (mm || 0) + (ss || 0) / 60;
          if (!min && !p.pts) continue;
          let a = acc.get(p.pid);
          if (!a) acc.set(p.pid, (a = { id: p.pid, n: p.n, k: gm.get(id)?.[side]?.k, pos: p.pos, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 }));
          a.gp++; a.min += min; for (const k of ['pts', 'reb', 'ast', 'stl', 'blk', 'to']) a[k] += p[k] || 0;
          a.fgm += p.fg?.[0] || 0; a.fga += p.fg?.[1] || 0; a.tpm += p.tp?.[0] || 0; a.tpa += p.tp?.[1] || 0;
          if (gm.get(id)?.[side]?.k) a.k = gm.get(id)[side].k;
        }
      }
    }
  }
  const rows = [...acc.values()].map((a) => ({
    id: a.id, n: a.n, k: a.k, pos: a.pos, gp: a.gp, min: r1(a.min / a.gp), pts: r1(a.pts / a.gp), reb: r1(a.reb / a.gp), ast: r1(a.ast / a.gp),
    stl: r1(a.stl / a.gp), blk: r1(a.blk / a.gp), to: r1(a.to / a.gp), fg: a.fga ? r1((a.fgm / a.fga) * 100) : undefined, tp: a.tpa ? r1((a.tpm / a.tpa) * 100) : undefined,
  })).sort((x, y) => (y.pts || 0) - (x.pts || 0)).slice(0, 150);
  return rows;
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
if (!FORCE && now - (cur.updated || 0) < 50 * 60e3) { console.log('[bk-stats] fresh, skip'); process.exit(0); }
const leagues = cur.leagues || {};
for (const cfg of NAVER) {
  const r = await naverTeams(cfg);
  if (r) leagues[cfg.lg] = { ...(leagues[cfg.lg] || {}), ...r };
  else console.log('[bk-stats] naver miss', cfg.lg);
  try {
    const pl = await naverPlayersFromBox(cfg.lg);
    if (pl.length) leagues[cfg.lg] = { ...(leagues[cfg.lg] || {}), player: pl };
  } catch (e) { console.log('[bk-stats] naver box agg fail', cfg.lg, e?.message); }
}
for (const cfg of ESPN) {
  const r = await espnLeague(cfg);
  if (r) leagues[cfg.lg] = { ...(leagues[cfg.lg] || {}), ...r };
  else console.log('[bk-stats] espn miss', cfg.lg);
}
{ const r = await euroleagueStats(); if (r) leagues.EUROLEAGUE = { ...(leagues.EUROLEAGUE || {}), ...r }; else console.log('[bk-stats] euroleague miss'); }
await fs.writeFile(file, JSON.stringify({ updated: now, leagues }));
console.log('[bk-stats]', Object.entries(leagues).map(([k, v]) => `${k}: team=${v.team?.length || 0} player=${v.player?.length || 0} ${v.season || ''}`).join(' | '));

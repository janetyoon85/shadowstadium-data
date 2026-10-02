// 농구 백데이터 크롤러(2026-10-02, 사용자: "네이버 espn 농구쪽 추가로 넣자 … 우선 백데이터만 준비").
// 소스: 네이버 스포츠(KBL/WKBL/NBA, api-gw.sports.naver.com) + ESPN(NBA/WNBA/G리그/NBL/FIBA 등, 키 불필요).
// 앱 UI는 아직 없음 — 기존 games.json 파이프라인과 섞이지 않게 basketball/ 폴더로 완전 분리:
//   basketball/games.json      슬림 경기목록(-BACK~+AHEAD일 롤링)
//   basketball/box-YYYY-MM.json 종료경기 박스스코어(팀스탯+선수스탯) 월별 영구 샤드
//   basketball/teams.json      팀(로고/한글·영문명/약어)
//   basketball/standings.json  순위
//   basketball/players.json    선수 인덱스(players.json과 동일 형식 → backfill-player-photos가 같이 처리)
//   basketball/venues.json     구장(venue-info/venue-photos 크롤러가 같이 처리)
//   basketball/team-name-en.json 팀 영문명(team-info 크롤러가 같이 처리, 키 'bk:<src>:<lg>:<code>')
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(path.resolve(__dirname, '..'), 'basketball');
const UA = 'Mozilla/5.0';
const BACK = Number(process.env.BASKETBALL_BACK_DAYS || 3);
const AHEAD = Number(process.env.BASKETBALL_AHEAD_DAYS || 10);
const DETAIL_BUDGET = Number(process.env.BASKETBALL_DETAIL_BUDGET || 80);
const KEEP_DAYS = 45;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAVER = [
  { lg: 'KBL', cat: 'kbl', up: 'kbasketball' },
  { lg: 'WKBL', cat: 'wkbl', up: 'kbasketball' },
  { lg: 'NBA', cat: 'nba', up: 'wbasketball' },
];
const ESPN = [
  { lg: 'NBA', slug: 'nba', photo: 'nba' },
  { lg: 'WNBA', slug: 'wnba', photo: 'wnba' },
  { lg: 'GLEAGUE', slug: 'nba-development', photo: 'nba-gleague' },
  { lg: 'NBL', slug: 'nbl', photo: 'nbl' },
  { lg: 'FIBA', slug: 'fiba', photo: 'fiba' },
  { lg: 'OLYMPICS_M', slug: 'mens-olympics-basketball', photo: 'mens-olympics-basketball' },
  { lg: 'OLYMPICS_W', slug: 'womens-olympics-basketball', photo: 'womens-olympics-basketball' },
];
// KBL/WKBL 영문명(네이버는 한글만 줌) — Wikipedia 팀정보/로고 검색용.
const KR_TEAM_EN = {
  '서울 SK': 'Seoul SK Knights', '서울 삼성': 'Seoul Samsung Thunders', '부산 KCC': 'Busan KCC Egis', '창원 LG': 'Changwon LG Sakers',
  '수원 KT': 'Suwon KT Sonicboom', '안양 정관장': 'Anyang Jeong Kwan Jang Red Boosters', '고양 소노': 'Goyang Sono Skygunners',
  '울산 현대모비스': 'Ulsan Hyundai Mobis Phoebus', '원주 DB': 'Wonju DB Promy', '대구 한국가스공사': 'Daegu KOGAS Pegasus',
  '아산 우리은행': 'Asan Woori Bank Woori Won', '용인 삼성생명': 'Yongin Samsung Life Blueminx', '청주 KB스타즈': 'Cheongju KB Stars',
  '부천 하나은행': 'Bucheon Hana Bank', '인천 신한은행': 'Incheon Shinhan Bank S-Birds', 'BNK 썸': 'Busan BNK Sum',
  'KB스타즈': 'Cheongju KB Stars', '삼성생명': 'Yongin Samsung Life Blueminx', '우리은행': 'Asan Woori Bank Woori Won', '하나은행': 'Bucheon Hana Bank',
  '신한은행': 'Incheon Shinhan Bank S-Birds', 'BNK': 'Busan BNK Sum',
};
const KR_VENUE_EN = {
  '잠실실내체육관': ['Jamsil Arena', 'Seoul'], '잠실학생체육관': ['Jamsil Students\' Gymnasium', 'Seoul'], '부산사직체육관': ['Sajik Arena', 'Busan'],
  '창원체육관': ['Changwon Gymnasium', 'Changwon'], '수원KT아레나': ['Suwon KT Arena', 'Suwon'], '안양정관장아레나': ['Anyang Gymnasium', 'Anyang'],
  '안양체육관': ['Anyang Gymnasium', 'Anyang'], '고양소노아레나': ['Goyang Gymnasium', 'Goyang'], '고양체육관': ['Goyang Gymnasium', 'Goyang'],
  '울산동천체육관': ['Dongchun Gymnasium', 'Ulsan'], '원주종합체육관': ['Wonju Gymnasium', 'Wonju'], '대구체육관': ['Daegu Gymnasium', 'Daegu'],
  '아산이순신체육관': ['Asan Yi Sun-sin Gymnasium', 'Asan'], '용인실내체육관': ['Yongin Gymnasium', 'Yongin'], '청주체육관': ['Cheongju Gymnasium', 'Cheongju'],
  '부천체육관': ['Bucheon Gymnasium', 'Bucheon'], '인천도원체육관': ['Incheon Dowon Gymnasium', 'Incheon'], '부산동소문체육관': ['Busan Dongsomun Gymnasium', 'Busan'],
};

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: c.signal });
      if (r.ok) return await r.json();
      if (r.status === 400 || r.status === 404) return null;
    } catch {}
    finally { clearTimeout(t); }
    await sleep(800 * (i + 1));
  }
  return undefined;
}
async function readJson(f, def) { try { return JSON.parse(await fs.readFile(path.join(OUT, f), 'utf8')); } catch { return def; } }
async function writeJson(f, v) { await fs.writeFile(path.join(OUT, f), JSON.stringify(v) + '\n', 'utf8'); }
const ymd = (d) => d.toISOString().slice(0, 10);
const kstDate = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const teams = {}, venues = {}, venueEn = {}, teamEn = {}, players = {};
const note = (map, k, v) => { map[k] = { ...(map[k] || {}), ...v }; };

function addTeam(src, lg, code, o) {
  const key = `${src}:${lg}:${code}`;
  note(teams, key, { src, lg, code, ...o });
  const en = o.en || KR_TEAM_EN[o.ko];
  if (en) teamEn[`bk:${key}`] = en;
  return key;
}
function addVenue(src, lg, name, city, teamKey, en) {
  if (!name) return undefined;
  const id = `bk_${src}_${slug(en || name) || slug(String(name.length))}`;
  note(venues, id, { name, city: city || undefined, lg, src, indoor: true, teams: [...new Set([...(venues[id]?.teams || []), teamKey].filter(Boolean))] });
  const e = en ? [en, city] : KR_VENUE_EN[name];
  if (e) venueEn[id] = { name: e[0], city: e[1] || city || '' };
  return id;
}
function addPlayer(id, name, team, lg, date) {
  if (!id || !name) return;
  const p = players[id] ||= { name, sport: 'basketball', id, appearances: [], lastSeenDate: date };
  if (!p.appearances.some((a) => a.team === team && a.league === lg)) p.appearances.push({ team, league: lg });
  if (date > p.lastSeenDate) p.lastSeenDate = date;
}

// ---------- 네이버 ----------
function naverStatus(g) {
  if (g.cancel) return 'cancelled';
  if (g.statusCode === 'RESULT') return 'final';
  if (g.statusCode === 'BEFORE') return 'scheduled';
  return 'live';
}
async function fetchNaverSchedule(cfg, from, to) {
  const j = await getJson(`https://api-gw.sports.naver.com/schedule/games?fields=basic,stadium&upperCategoryId=${cfg.up}&categoryId=${cfg.cat}&fromDate=${from}&toDate=${to}&size=500`);
  if (!j) return j;
  const out = [];
  for (const g of j.result?.games || []) {
    const t = Date.parse(g.gameDateTime + '+09:00');
    const h = addTeam('naver', cfg.lg, g.homeTeamCode, { ko: g.homeTeamName, logo: g.homeTeamEmblemUrl, abbr: cfg.lg === 'NBA' ? g.homeTeamCode : undefined });
    const a = addTeam('naver', cfg.lg, g.awayTeamCode, { ko: g.awayTeamName, logo: g.awayTeamEmblemUrl, abbr: cfg.lg === 'NBA' ? g.awayTeamCode : undefined });
    const v = cfg.lg === 'NBA' ? undefined : addVenue('naver', cfg.lg, g.stadium, '', h); // 네이버 NBA stadium 필드는 KBL 구장명이 섞여 있어 무시(ESPN 쪽이 정확)
    out.push({ id: `nv:${g.gameId}`, src: 'naver', lg: cfg.lg, date: g.gameDate, t, st: naverStatus(g), per: g.statusInfo || undefined, h: { k: h, s: g.homeTeamScore }, a: { k: a, s: g.awayTeamScore }, venue: g.stadium || undefined, vid: v, _cfg: cfg });
  }
  return out;
}
async function naverDetail(game) {
  const gid = game.id.slice(3);
  const j = await getJson(`https://api-gw.sports.naver.com/schedule/games/${gid}/record`);
  if (!j) return j;
  const r = j.result?.recordData;
  if (!r) return null;
  const lines = (side) => [1, 2, 3, 4].map((q) => r[`${side}Q${q}Score`]).concat(r[`${side}XScore`] ? [r[`${side}XScore`]] : []);
  const team = (s) => { const x = r[s]; return x && { pts: x.score, reb: x.rebound, ast: x.aS, stl: x.sT, blk: x.bS, to: x.to, pf: x.foulTot, fg: [x.fg, x.fgA], tp: [x.threep, x.threepA], ft: [x.ft, x.ftA] }; };
  const pl = (side) => (r[`${side}PlayerStats`] || []).filter((p) => p.playTimeSec > 0 || p.scoreTot > 0).map((p) => {
    const pid = `nbk:${game._cfg.cat}:${p.playerId}`;
    addPlayer(pid, p.playerName, game[side === 'home' ? 'h' : 'a'].k, game.lg, game.date);
    return { pid, n: p.playerName, no: p.backNum, pos: p.position, min: p.playTimeStr, pts: p.scoreTot, reb: p.reboundTot, ast: p.as, stl: p.st, blk: p.bs, to: p.to, pf: p.foulTot, fg: [p.fg, p.fgA], tp: [p.threeP, p.threePA], ft: [p.ft, p.ftA], gs: p.startFlag ? 1 : 0 };
  });
  return { ls: { h: lines('home'), a: lines('away') }, tm: { h: team('home'), a: team('away') }, pl: { h: pl('home'), a: pl('away') } };
}
async function naverStandings(cfg, seasonCode) {
  const j = await getJson(`https://api-gw.sports.naver.com/statistics/categories/${cfg.cat}/seasons/${seasonCode}/teams`);
  const rows = j?.result?.seasonTeamStats;
  if (!rows?.length) return null;
  return rows.map((x) => ({ k: `naver:${cfg.lg}:${x.teamId}`, rank: x.rank, w: x.wins, l: x.losses, gp: x.matchesPlayed, pct: x.winRate, gb: x.gameDifference, l5: x.lastFiveGames, pf: x.pointsPerGame, pa: x.pointsConcededPerGame }));
}

// ---------- ESPN ----------
function espnStatus(t) {
  if (t?.name === 'STATUS_POSTPONED' || t?.name === 'STATUS_CANCELED') return 'cancelled';
  if (t?.state === 'post') return 'final';
  if (t?.state === 'in') return 'live';
  return 'scheduled';
}
async function fetchEspnSchedule(cfg, from, to) {
  const out = [];
  const events = [];
  let okDays = 0;
  const days = [];
  for (let d = Date.parse(from); d <= Date.parse(to); d += 86400e3) days.push(d);
  for (let i = 0; i < days.length; i += 5) {
    const js = await Promise.all(days.slice(i, i + 5).map((d) => getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/${cfg.slug}/scoreboard?dates=${ymd(new Date(d)).replace(/-/g, '')}&limit=300`)));
    for (const j of js) if (j) { okDays++; events.push(...(j.events || [])); }
  }
  if (okDays === 0 && to >= from) return undefined;
  for (const e of events) {
    const c = e.competitions?.[0];
    if (!c) continue;
    const side = (ha) => c.competitors.find((x) => x.homeAway === ha);
    const H = side('home'), A = side('away');
    if (!H || !A) continue;
    const tk = (x) => addTeam('espn', cfg.lg, x.team.id, { en: x.team.displayName, abbr: x.team.abbreviation, logo: x.team.logo, color: x.team.color ? '#' + x.team.color : undefined });
    const hk = tk(H), ak = tk(A);
    const vn = c.venue?.fullName;
    const vid = addVenue('espn', cfg.lg, vn, c.venue?.address?.city, hk, vn);
    const t0 = Date.parse(e.date);
    out.push({
      id: `espn:${cfg.lg}:${e.id}`, src: 'espn', lg: cfg.lg, date: kstDate(t0), t: t0, st: espnStatus(c.status?.type || e.status?.type), per: c.status?.type?.shortDetail || undefined,
      h: { k: hk, s: num(H.score), ls: (H.linescores || []).map((x) => x.value) }, a: { k: ak, s: num(A.score), ls: (A.linescores || []).map((x) => x.value) },
      venue: vn, vid, att: c.attendance || undefined, tv: (c.broadcasts || []).flatMap((b) => b.names || []).slice(0, 3), _cfg: cfg,
    });
  }
  return out;
}
async function espnDetail(game) {
  const eid = game.id.split(':')[2];
  const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/${game._cfg.slug}/summary?event=${eid}`);
  if (!j) return j;
  const b = j.boxscore;
  if (!b) return null;
  const tm = {}, pl = { h: [], a: [] };
  for (const t of b.teams || []) {
    const side = t.team.id === game.h.k.split(':')[2] ? 'h' : 'a';
    const st = Object.fromEntries((t.statistics || []).map((s) => [s.name, s.displayValue]));
    const pair = (k) => String(st[k] || '').split('-').map(Number);
    tm[side] = { reb: num(st.totalRebounds), ast: num(st.assists), stl: num(st.steals), blk: num(st.blocks), to: num(st.turnovers), pf: num(st.fouls), fg: pair('fieldGoalsMade-fieldGoalsAttempted'), tp: pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted'), ft: pair('freeThrowsMade-freeThrowsAttempted') };
  }
  for (const t of b.players || []) {
    const side = t.team.id === game.h.k.split(':')[2] ? 'h' : 'a';
    const grp = t.statistics?.[0];
    if (!grp) continue;
    const idx = Object.fromEntries((grp.keys || []).map((k, i) => [k, i]));
    const pairOf = (v) => String(v ?? '0-0').split('-').map(Number);
    for (const a of grp.athletes || []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const s = a.stats;
      const pid = `espnbk:${game._cfg.photo}:${a.athlete.id}`;
      addPlayer(pid, a.athlete.displayName, game[side].k, game.lg, game.date);
      pl[side].push({ pid, n: a.athlete.displayName, no: a.athlete.jersey, pos: a.athlete.position?.abbreviation, img: a.athlete.headshot?.href, min: s[idx.minutes], pts: num(s[idx.points]), reb: num(s[idx.rebounds]), ast: num(s[idx.assists]), stl: num(s[idx.steals]), blk: num(s[idx.blocks]), to: num(s[idx.turnovers]), pf: num(s[idx.fouls]), fg: pairOf(s[idx['fieldGoalsMade-fieldGoalsAttempted']]), tp: pairOf(s[idx['threePointFieldGoalsMade-threePointFieldGoalsAttempted']]), ft: pairOf(s[idx['freeThrowsMade-freeThrowsAttempted']]), pm: s[idx.plusMinus], gs: a.starter ? 1 : 0 });
    }
  }
  return { ls: { h: game.h.ls, a: game.a.ls }, tm, pl };
}
async function espnStandings(cfg) {
  const j = await getJson(`https://site.api.espn.com/apis/v2/sports/basketball/${cfg.slug}/standings`);
  const out = [];
  for (const g of j?.children || []) {
    for (const e of g.standings?.entries || []) {
      const st = Object.fromEntries((e.stats || []).map((s) => [s.name, s.displayValue ?? s.value]));
      out.push({ k: `espn:${cfg.lg}:${e.team.id}`, grp: g.name, rank: num(st.playoffSeed) || undefined, w: num(st.wins), l: num(st.losses), pct: num(st.winPercent), gb: st.gamesBehind, strk: st.streak, pf: st.pointsFor, pa: st.pointsAgainst, home: st.Home, road: st.Road });
    }
  }
  return out.length ? out : null;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const now = Date.now();
  const from = ymd(new Date(now - BACK * 86400e3)), to = ymd(new Date(now + AHEAD * 86400e3));
  const old = await readJson('games.json', { games: [] });
  const byId = new Map((old.games || []).map((g) => [g.id, g]));
  Object.assign(teams, await readJson('teams.json', {}));
  Object.assign(venues, await readJson('venues.json', {}));
  Object.assign(venueEn, await readJson('venue-name-en.json', {}));
  Object.assign(teamEn, await readJson('team-name-en.json', {}));
  for (const [id, v] of Object.entries(venues)) {
    v.indoor = true;
    if (v.src !== 'naver') continue;
    v.teams = (v.teams || []).filter((t) => !t.startsWith('naver:NBA:'));
    v.indoor = true;
    if (!v.teams.length) { delete venues[id]; delete venueEn[id]; }
  }
  for (const g of old.games || []) if (g.src === 'naver' && g.lg === 'NBA') { delete g.vid; delete g.venue; }
  for (const p of await readJson('players.json', [])) players[p.id] = p;
  const standings = await readJson('standings.json', {});
  let ok = 0, failed = 0;
  const fresh = [];
  const results = await Promise.all([
    ...NAVER.map((cfg) => fetchNaverSchedule(cfg, from, to).then((r) => [cfg, r])),
    ...ESPN.map((cfg) => fetchEspnSchedule(cfg, from, to).then((r) => [cfg, r])),
  ]);
  for (const [cfg, r] of results) {
    if (r === undefined) { failed++; console.log('[basketball] FAIL', cfg.lg); continue; }
    ok++; fresh.push(...(r || []));
  }
  for (const g of fresh) {
    const prev = byId.get(g.id);
    byId.set(g.id, { ...g, boxed: prev?.boxed });
  }

  const boxFiles = {};
  const box = async (g) => { const f = `box-${g.date.slice(0, 7)}.json`; return (boxFiles[f] ||= (await readJson(f, {}))); };
  let detail = 0;
  const finals = [...byId.values()].filter((g) => g.st === 'final' && !g.boxed && g._cfg).sort((a, b) => b.t - a.t);
  const todo = finals.slice(0, DETAIL_BUDGET);
  for (const g of todo) await box(g);
  detail = todo.length;
  let qi = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (qi < todo.length) {
      const g = todo[qi++];
      const d = g.src === 'naver' ? await naverDetail(g) : await espnDetail(g);
      if (d === undefined) continue;
      if (d) boxFiles[`box-${g.date.slice(0, 7)}.json`][g.id] = d;
      g.boxed = 1;
    }
  }));

  await Promise.all(ESPN.filter((c) => ['NBA', 'WNBA', 'NBL'].includes(c.lg)).map(async (cfg) => {
    const s = await espnStandings(cfg);
    if (s) standings[`espn:${cfg.lg}`] = { updated: now, rows: s };
  }));
  for (const cfg of NAVER) {
    const sample = [...byId.values()].filter((g) => g.src === 'naver' && g.lg === cfg.lg).sort((a, b) => b.t - a.t)[0];
    if (!sample) continue;
    const gj = await getJson(`https://api-gw.sports.naver.com/schedule/games/${sample.id.slice(3)}`);
    const sc = gj?.result?.game?.seasonCode;
    if (!sc) continue;
    let s = null, code = String(sc);
    for (let i = 0; i < 4 && !s; i++) {
      s = await naverStandings(cfg, code);
      await sleep(300);
      if (!s) code = String(Number(code) - 1).padStart(code.length, '0');
    }
    if (s) standings[`naver:${cfg.lg}`] = { updated: now, season: code, rows: s };
  }

  const cutoff = ymd(new Date(now - Math.max(KEEP_DAYS, BACK) * 86400e3));
  const games = [...byId.values()].filter((g) => g.date >= cutoff).sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)).map(({ _cfg, ...g }) => g);
  await writeJson('games.json', { updated: now, games });
  for (const [f, v] of Object.entries(boxFiles)) await writeJson(f, v);
  await writeJson('teams.json', teams);
  await writeJson('venues.json', venues);
  await writeJson('venue-name-en.json', venueEn);
  await writeJson('team-name-en.json', teamEn);
  await writeJson('standings.json', standings);
  await writeJson('players.json', Object.values(players).sort((a, b) => a.id.localeCompare(b.id)));
  console.log(`[basketball] sources ok=${ok} failed=${failed} games=${games.length} detail=${detail} teams=${Object.keys(teams).length} venues=${Object.keys(venues).length} players=${Object.keys(players).length}`);
  if (ok === 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

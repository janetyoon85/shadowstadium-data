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
import zlib from 'node:zlib';
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
  { lg: 'EUROLEAGUE', slug: 'euroleague', photo: 'euroleague' },
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
  const id = `bk_${src}_${(en || /^[\x00-\x7f]+$/.test(name) ? slug(en || name) : '') || 'h' + [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7).toString(36)}`;
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

// ---------- 아시안게임(Bornan API, 야구/축구 크롤러와 동일 벤더) ----------
const AG_KO = { KOR: '대한민국', JPN: '일본', CHN: '중국', TPE: '차이니스 타이베이', HKG: '홍콩', PHI: '필리핀', IRI: '이란', IRQ: '이라크', JOR: '요르단', LBN: '레바논', QAT: '카타르', KSA: '사우디아라비아', UAE: '아랍에미리트', KUW: '쿠웨이트', BRN: '바레인', SYR: '시리아', PLE: '팔레스타인', IND: '인도', PAK: '파키스탄', SRI: '스리랑카', BAN: '방글라데시', NEP: '네팔', THA: '태국', VIE: '베트남', INA: '인도네시아', MAS: '말레이시아', SGP: '싱가포르', CAM: '캄보디아', LAO: '라오스', MYA: '미얀마', MGL: '몽골', KAZ: '카자흐스탄', UZB: '우즈베키스탄', KGZ: '키르기스스탄', TJK: '타지키스탄', TKM: '투르크메니스탄', AFG: '아프가니스탄', MAC: '마카오', PRK: '조선민주주의인민공화국', MDV: '몰디브', BRU: '브루나이', TLS: '동티모르', OMA: '오만', YEM: '예멘', BHU: '부탄' };
const AG_DISCS = [['BKB', 'ASIAD'], ['BK3', 'ASIAD3']];
async function agFetch(p) {
  try {
    const r = await fetch(`https://back.results.asiangames2026.org/s/AG2026/en/${p}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return r.status === 404 ? null : undefined;
    const b = Buffer.from(await r.arrayBuffer());
    return JSON.parse(zlib.inflateSync(Buffer.from(b.toString('utf-8'), 'latin1')).toString('utf-8'));
  } catch { return undefined; }
}
async function fetchAsianGames(fromDate, byId) {
  const out = [];
  let any = false;
  for (const [disc, base] of AG_DISCS) {
    const days = await agFetch(`${disc}/schedule/days`);
    if (days === undefined) return undefined;
    if (!days) continue;
    any = true;
    const today = kstDate(Date.now());
    for (const d of days.map((x) => x.raw).filter((d) => d >= fromDate)) {
      const prior = [...byId.values()].filter((g) => g.src === 'ag' && g.date === d && g.id.startsWith('ag:' + disc));
      if (d < today && prior.length && prior.every((g) => g.st === 'final')) continue;
      const day = await agFetch(`${disc}/schedule/daily/${d}`);
      if (!day) continue;
      for (const g of day) {
        if (!g.Home?.Org || !g.Away?.Org) continue;
        const lg = `${base}_${(g.Event || '').startsWith('W') ? 'W' : 'M'}`;
        const tk = (x) => addTeam('ag', lg, x.Org, { en: x.Name, ko: AG_KO[x.Org], abbr: x.Org });
        const hk = tk(g.Home), ak = tk(g.Away);
        const t0 = Date.parse(g.DateTimeRaw);
        const vid = addVenue('ag', lg, g.VenueDesc, '', hk, g.VenueDesc);
        const status = ['OFFICIAL', 'FINISHED', 'UNOFFICIAL'].includes(g.Status) ? 'final' : ['LIVE', 'RUNNING'].includes(g.Status) ? 'live' : 'scheduled';
        const att = Number((g.Extensions || []).find((x) => x.Code === 'ATTENDANCE')?.Value);
        out.push({
          id: `ag:${disc}:${g.ResCode || g.Key}`, src: 'ag', lg, date: kstDate(t0), t: t0, st: status, per: g.UnitDescS || undefined,
          h: { k: hk, s: status === 'scheduled' ? 0 : num(g.Home.Result) }, a: { k: ak, s: status === 'scheduled' ? 0 : num(g.Away.Result) },
          venue: g.VenueDesc || undefined, vid, att: Number.isFinite(att) && att > 0 ? att : undefined, rd: g.UnitDesc || undefined,
        });
      }
      await sleep(300);
    }
  }
  return any ? out : null;
}

// ---------- 일본 B.League(공식 사이트 일정 JSON — HTML 조각) ----------
const BL_TABS = [[1, 2, 'BLEAGUE1'], [2, 7, 'BLEAGUE2'], [3, 15, 'BLEAGUE3']];
const blAbs = (u) => (u.startsWith('/') ? 'https://www.bleague.jp' + u : u);
function blParse(topics, lg, fixedDate, now) {
  const out = [];
  let date = fixedDate;
  for (const html of topics) {
    const dm = /class="title">\s*(\d{4})\.(\d{2})\.(\d{2})/.exec(html);
    if (dm) date = `${dm[1]}-${dm[2]}-${dm[3]}`;
    for (const li of html.split('<li class="list-item"').slice(1)) {
      const id = /^\s*id="(\d+)"/.exec(li)?.[1];
      const side = (c) => {
        const i0 = li.indexOf(`class="team ${c}">`);
        const m = i0 < 0 ? '' : li.slice(i0, i0 + 400).split('class="point')[0].split('</div>')[0];
        const name = /class="team-name">([^<]*)</.exec(m)?.[1]?.trim();
        const logo = /<img src="([^"]+)"/.exec(m)?.[1];
        const code = /\/([a-z0-9]+)\.png/.exec(logo || '')?.[1];
        return { name, logo: logo && blAbs(logo), code };
      };
      const h = side('home'), a = side('away');
      if (!id || !date || !h.code || !a.code) continue;
      const sc = (c) => new RegExp(`class="number ${c}-score[^"]*"><span>(\\d*)</span>`).exec(li)?.[1];
      const hs = sc('home'), as = sc('away');
      const spans = [...(/class="info-arena">([\s\S]*?)<\/div>/.exec(li)?.[1] || '').matchAll(/<span>([^<]+)<\/span>/g)].map((x) => x[1].trim());
      const time = spans.find((x) => /^\d{1,2}:\d{2}$/.test(x)) || '00:00';
      const [pref, arena] = (spans.find((x) => x.includes('|')) || '').split('|').map((x) => x.trim());
      const t = Date.parse(`${date}T${time.padStart(5, '0')}:00+09:00`);
      const hk = addTeam('bl', lg, h.code, { ja: h.name, logo: h.logo, abbr: h.code.toUpperCase() });
      const ak = addTeam('bl', lg, a.code, { ja: a.name, logo: a.logo, abbr: a.code.toUpperCase() });
      const vid = arena ? addVenue('bl', lg, arena, pref, hk) : undefined;
      const hasScore = !!hs && !!as;
      const st = !hasScore ? 'scheduled' : now - t > 3.5 * 3600e3 ? 'final' : 'live';
      out.push({ id: `bl:${id}`, src: 'bl', lg, date, t, st, h: { k: hk, s: hasScore ? Number(hs) : 0 }, a: { k: ak, s: hasScore ? Number(as) : 0 }, venue: arena || undefined, vid });
    }
  }
  return out;
}
async function blFetch(q) {
  try {
    const r = await fetch(`https://www.bleague.jp/schedule/?data_format=json&${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : undefined;
  } catch { return undefined; }
}
// B.LEAGUE 공식 경기상세 페이지에 종료경기 박스스코어가 _contexts_s3id.data JSON으로 박혀 있음(2026-10-02).
async function blDetail(game) {
  let html;
  try {
    const r = await fetch(`https://www.bleague.jp/game_detail/?ScheduleKey=${game.id.slice(3)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) return undefined;
    html = await r.text();
  } catch { return undefined; }
  const i0 = html.indexOf('_contexts_s3id.data = ');
  if (i0 < 0) return undefined;
  let i = i0 + 22, depth = 0, inStr = false, esc = false, j = i;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) break;
  }
  let o;
  try { o = JSON.parse(html.slice(i, j + 1)); } catch { return undefined; }
  if (!o?.Game?.BoxscoreExistsFlg || !o.HomeBoxscores?.length) return Date.now() - game.t > 3 * 86400e3 ? null : undefined;
  const G = o.Game;
  const tot = (rows) => rows.filter((r) => r.PeriodCategory === 18);
  const team = (rows) => { const x = tot(rows).find((r) => r.Category === 3); return x && { pts: x.Point, reb: x.RB_TOT, ast: x.AS, stl: x.ST, blk: x.BS, to: x.TO, pf: x.FOUL, fg: [x.PT2M + x.PT3M, x.PT2A + x.PT3A], tp: [x.PT3M, x.PT3A], ft: [x.FTM, x.FTA] }; };
  const pl = (rows, side) => tot(rows).filter((r) => r.Category === 1 && r.PlayerID && (r.PlayingFlg === true || parseInt(r.PlayTime) > 0)).map((r) => {
    const pid = `blbk:${r.PlayerID}`;
    const name = r.PlayerNameE || r.PlayerNameJ;
    addPlayer(pid, name, game[side === 'h' ? 'h' : 'a'].k, game.lg, game.date);
    return { pid, n: name, no: r.PlayerNo, min: r.PlayTime, pts: r.Point, reb: r.RB_TOT, ast: r.AS, stl: r.ST, blk: r.BS, to: r.TO, pf: r.FOUL, fg: [r.PT2M + r.PT3M, r.PT2A + r.PT3A], tp: [r.PT3M, r.PT3A], ft: [r.FTM, r.FTA], pm: r.PLUSMINUS != null ? (r.PLUSMINUS > 0 ? '+' : '') + r.PLUSMINUS : undefined, gs: r.StartingFlg ? 1 : 0 };
  });
  const ls = (p) => [1, 2, 3, 4].map((q) => G[`${p}TeamScore0${q}`]).filter((x) => typeof x === 'number');
  return { ls: { h: ls('Home'), a: ls('Away') }, tm: { h: team(o.HomeBoxscores), a: team(o.AwayBoxscores) }, pl: { h: pl(o.HomeBoxscores, 'h'), a: pl(o.AwayBoxscores, 'a') } };
}
async function fetchBleague(now, full) {
  const out = [];
  let any = false;
  for (const [tab, ev, lg] of BL_TABS) {
    if (full) {
      let index = 0;
      for (let n = 0; n < 40; n++) {
        const j = await blFetch(`year=2026&mon=all&day=&event=${ev}&club=&tab=${tab}&ha=&fb=&index=${index}`);
        if (j === undefined) return undefined;
        if (!j) break;
        any = true;
        out.push(...blParse(j.topics || [], lg, null, now));
        if (!j.index) break;
        index = j.index;
        await sleep(300);
      }
    } else {
      for (const off of [-2, -1, 0, 1]) {
        const d = kstDate(now + off * 86400e3);
        const [y, m, dd] = d.split('-');
        const j = await blFetch(`year=${y}&mon=${m}&day=${dd}&event=1&club=&tab=${tab}&ha=&fb=`);
        if (j === undefined) return undefined;
        if (!j) continue;
        any = true;
        out.push(...blParse(j.topics || [], lg, d, now));
        await sleep(300);
      }
    }
  }
  return any ? out : null;
}


// ---------- 하루 1회: 리그 전체 팀 등록(경기 유무와 무관) + 네이버 시즌 전체 일정 ----------
async function syncAllTeams(now) {
  const jobs = ESPN.map(async (cfg) => {
    const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/${cfg.slug}/teams?limit=500`);
    for (const t of j?.sports?.[0]?.leagues?.[0]?.teams || []) {
      const x = t.team;
      if (x?.id) addTeam('espn', cfg.lg, x.id, { en: x.displayName, abbr: x.abbreviation, logo: x.logos?.[0]?.href, color: x.color ? '#' + x.color : undefined });
    }
  });
  await Promise.all(jobs);
  const from = ymd(new Date(now)), to = ymd(new Date(now + 200 * 86400e3));
  const res = await Promise.all(NAVER.filter((c) => c.lg !== 'NBA').map((cfg) => fetchNaverSchedule(cfg, from, to)));
  return res.flatMap((r) => r || []);
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
  const meta = await readJson('meta.json', {});
  const doSync = now - (meta.teamSync || 0) > 24 * 3600e3;
  let syncGames = [];
  if (doSync) { syncGames = await syncAllTeams(now); meta.teamSync = now; }
  const agFrom = ymd(new Date(now - KEEP_DAYS * 86400e3));
  const ag = await fetchAsianGames(agFrom, byId);
  if (ag === undefined) { failed++; console.log('[basketball] FAIL ASIAD'); } else if (ag) { ok++; fresh.push(...ag); }
  const bl = await fetchBleague(now, doSync);
  if (bl === undefined) { failed++; console.log('[basketball] FAIL BLEAGUE'); } else if (bl) { ok++; fresh.push(...bl); }
  fresh.push(...syncGames);
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
  const finals = [...byId.values()].filter((g) => g.st === 'final' && !g.boxed && (g._cfg || g.src === 'bl')).sort((a, b) => b.t - a.t);
  const todo = finals.slice(0, DETAIL_BUDGET);
  for (const g of todo) await box(g);
  detail = todo.length;
  let qi = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (qi < todo.length) {
      const g = todo[qi++];
      const d = g.src === 'naver' ? await naverDetail(g) : g.src === 'bl' ? await blDetail(g) : await espnDetail(g);
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
  const NBA_KO_FALLBACK = { DEN: '덴버', CLE: '클리블랜드' };
  const ABBR = { UTAH: 'UTA', PHX: 'PHO', WSH: 'WAS' };
  const nvNba = Object.values(teams).filter((t) => t.src === 'naver' && t.lg === 'NBA');
  for (const t of Object.values(teams)) {
    if (t.src !== 'espn' || t.lg !== 'NBA' || !t.abbr) continue;
    const nv = nvNba.find((n) => n.code === (ABBR[t.abbr] || t.abbr));
    if (!nv) { if (!t.ko && NBA_KO_FALLBACK[t.abbr]) t.ko = NBA_KO_FALLBACK[t.abbr]; continue; }
    if (!t.ko && nv.ko) t.ko = nv.ko;
    if (!nv.en && t.en) nv.en = t.en;
  }
  await writeJson('meta.json', meta);
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

// 팀 전체 로스터 수집(2026-10-11, "선수단에 선수들이 너무 없다") — 앱의 선수 목록(players.json)은 득점·카드·어시스트 이벤트에 나온 선수뿐이라
// 클럽 선수단이 13명 안팎으로 빈약했다. ESPN 공개 API(site.api.espn.com)의 팀별 로스터(/teams/{id}/roster)로 전체 선수단을 받아
// 앱이 쓰는 한글 팀명으로 저장한다. 앱은 팀 하나를 열 때 샤드 1개(fnv1a32 끝 hex 1자리)만 받는다(team-info 와 동일 패턴).
//
// 팀명 매칭: ESPN 영문 팀명(displayName 등)을 정규화(normalizeTeamName)해 team-name-en.json(한글→영문)·ESPN 팀 매핑(TEAMS 등)의 키와 맞추고,
// 정확 일치가 없으면 한쪽이 다른 쪽을 포함(길이 5 이상)하고 후보가 하나뿐일 때만 채택한다(틀린 팀에 붙이는 것보다 빠지는 편이 낫다).
// 결과: team-rosters/<0-f>.json = { [팀한글명]: [{ id:'espn:<id>', n:'영문 풀네임', pos:'G|D|M|F', no:'등번호', nat:'국적코드' }] }
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAMS, normalizeTeamName } from './espn-soccer-teams.mjs';
import { ASIA_TEAMS } from './espn-asia-soccer-teams.mjs';
import { BATCH2_TEAMS } from './espn-world-soccer-teams.mjs';
import { fnv1a32 } from './topic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'team-rosters');
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const DELAY_MS = Number(process.env.ROSTER_DELAY_MS || 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shardOf = (key) => fnv1a32(key).slice(-1);

// 국내 리그 슬러그 — fetch-schedule.mjs 의 ESPN_LEAGUE_SLUG 에서 {국가코드}.1/.2 형태만 뽑는다(대회·국가대항전 제외).
async function domesticSlugs() {
  const src = await fs.readFile(path.join(__dirname, 'fetch-schedule.mjs'), 'utf8');
  const out = new Map(); // slug -> 리그코드
  for (const m of src.matchAll(/([A-Z0-9]+):\s*'([a-z]{3}\.[12])'/g)) out.set(m[2], m[1]);
  return [...out].map(([slug, code]) => ({ slug, code }));
}
// 리그 코드별로 games.json 에 실제 등장하는 한글 팀명 — 동명 후보(Liverpool 등)를 그 리그 소속으로 좁히는 데 쓴다.
async function leagueTeamNames() {
  const games = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'games.json'), 'utf8'));
  const m = new Map();
  for (const g of games) { if (!m.has(g.league)) m.set(g.league, new Set()); m.get(g.league).add(g.home); m.get(g.league).add(g.away); }
  return m;
}

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404 || res.status === 400) return null;
      if (res.ok) return await res.json();
    } catch { /* 재시도 */ }
    await sleep(500 * (i + 1));
  }
  return undefined;
}

async function buildLookup() {
  const byEn = new Map(); // 정규화 영문 → Set(한글팀명)
  const add = (en, ko) => { const k = normalizeTeamName(en || ''); if (!k || !ko) return; if (!byEn.has(k)) byEn.set(k, new Set()); byEn.get(k).add(ko); };
  const names = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'team-name-en.json'), 'utf8'));
  for (const [ko, en] of Object.entries(names)) if (!ko.startsWith('bk:') && !ko.includes('|')) add(en, ko);
  for (const group of [TEAMS, ASIA_TEAMS, BATCH2_TEAMS]) for (const league of Object.values(group)) for (const [k, v] of Object.entries(league || {})) if (v?.ko) { if (!byEn.has(k)) byEn.set(k, new Set()); byEn.get(k).add(v.ko); }
  return byEn;
}

function matchKo(byEn, team, inLeague) {
  const cands = [team.displayName, team.shortDisplayName, team.name, team.location, team.abbreviation].filter(Boolean).map(normalizeTeamName).filter(Boolean);
  const narrow = (set) => { const arr = [...set]; if (arr.length === 1) return arr[0]; const f = inLeague ? arr.filter((x) => inLeague.has(x)) : []; return f.length === 1 ? f[0] : null; };
  for (const c of cands) { const h = byEn.get(c); if (h) { const r = narrow(h); if (r) return r; } }
  // 부분 일치(길이 5 이상) — 후보가 하나(또는 그 리그 소속으로 하나)일 때만
  const found = new Set();
  for (const c of cands.slice(0, 2)) {
    if (c.length < 5) continue;
    for (const [k, v] of byEn) if (k.length >= 5 && (k.includes(c) || c.includes(k))) v.forEach((x) => found.add(x));
  }
  return found.size ? narrow(found) : null;
}

// MLB 30개 구단(StatsAPI 팀 id → 앱 한글 팀명). 키는 '<팀>|baseball'(축구와 이름이 겹치지 않게). 40인 로스터(부상자 포함).
const MLB_TEAMS = { 109: '애리조나', 144: '애틀랜타', 110: '볼티모어', 111: '보스턴', 112: '시카고컵스', 145: '시카고W', 113: '신시내티', 114: '클리블랜드', 115: '콜로라도', 116: '디트로이트', 117: '휴스턴', 118: '캔자스시티', 108: 'LA에인절스', 119: 'LA다저스', 146: '마이애미', 158: '밀워키', 142: '미네소타', 121: '뉴욕메츠', 147: '뉴욕양키스', 133: '애슬레틱스', 143: '필라델피아', 134: '피츠버그', 135: '샌디에이고', 137: '샌프란시스코', 136: '시애틀', 138: '세인트루이스', 139: '탬파베이', 140: '텍사스', 141: '토론토', 120: '워싱턴' };
async function fetchMlbRosters(rosters) {
  let n = 0;
  for (const [id, ko] of Object.entries(MLB_TEAMS)) {
    const r = await getJson(`https://statsapi.mlb.com/api/v1/teams/${id}/roster?rosterType=40Man`);
    await sleep(DELAY_MS);
    const list = (r?.roster || []).filter((x) => x?.person?.id && x.person.fullName).map((x) => ({
      id: `mlb:${x.person.id}`, n: x.person.fullName,
      ...(x.position?.abbreviation ? { pos: x.position.abbreviation } : {}),
      ...(x.jerseyNumber ? { no: String(x.jerseyNumber) } : {}),
    }));
    if (list.length) { rosters[`${ko}|baseball`] = list; n++; }
  }
  console.log(`[rosters] MLB teams=${n}`);
}
// NBA·WNBA(ESPN 농구) — 앱 농구 팀 키가 'espn:NBA:<ESPN 팀 id>' 라 id 로 바로 연결. 키는 'bk:<팀키>'. 헤드샷 주소(ph)도 함께 저장(농구 로스터는 실제로 열린다).
async function fetchBasketballRosters(rosters) {
  let n = 0;
  for (const [league, slug] of [['NBA', 'nba'], ['WNBA', 'wnba']]) {
    const t = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/${slug}/teams`);
    await sleep(DELAY_MS);
    const teams = t?.sports?.[0]?.leagues?.[0]?.teams?.map((x) => x.team) || [];
    for (const tm of teams) {
      const r = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/${slug}/teams/${tm.id}/roster`);
      await sleep(DELAY_MS);
      const list = (Array.isArray(r?.athletes) ? r.athletes : []).filter((x) => x?.id && x.fullName).map((x) => ({
        id: `espnbk:${slug}:${x.id}`, n: x.fullName,
        ...(x.position?.abbreviation ? { pos: x.position.abbreviation } : {}),
        ...(x.jersey ? { no: String(x.jersey) } : {}),
        ...(x.headshot?.href ? { ph: x.headshot.href } : {}),
      }));
      if (list.length) { rosters[`bk:espn:${league}:${tm.id}`] = list; n++; }
    }
  }
  console.log(`[rosters] basketball teams=${n}`);
}

async function main() {
  const byEn = await buildLookup();
  const slugs = await domesticSlugs();
  const leagueNames = await leagueTeamNames();
  const rosters = {};
  // 기존 샤드를 먼저 읽어 두고(이번 실행에서 못 받은 팀·축구를 건너뛴 부분 실행에서도 보존), 받은 팀만 덮어쓴다.
  try { for (const f of await fs.readdir(OUT_DIR)) if (f.endsWith('.json')) Object.assign(rosters, JSON.parse(await fs.readFile(path.join(OUT_DIR, f), 'utf8'))); } catch { /* 첫 실행 */ }
  const SKIP_SOCCER = !!process.env.ROSTER_SKIP_SOCCER;
  const unmatched = [];
  let teamCount = 0;
  for (const { slug, code } of (SKIP_SOCCER ? [] : slugs)) {
    const t = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams`);
    await sleep(DELAY_MS);
    const teams = t?.sports?.[0]?.leagues?.[0]?.teams?.map((x) => x.team) || [];
    for (const tm of teams) {
      const ko = matchKo(byEn, tm, leagueNames.get(code));
      if (!ko) { unmatched.push(`${slug}:${tm.displayName}`); continue; }
      const r = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${tm.id}/roster`);
      await sleep(DELAY_MS);
      const athletes = Array.isArray(r?.athletes) ? r.athletes : [];
      const list = [];
      for (const a of athletes) {
        const items = Array.isArray(a?.items) ? a.items : [a]; // 일부 리그는 포지션 그룹으로 묶여 옴
        for (const x of items) {
          if (!x?.id || !x?.fullName) continue;
          list.push({
            id: `espn:${x.id}`,
            n: x.fullName,
            ...(x.position?.abbreviation ? { pos: x.position.abbreviation } : {}),
            ...(x.jersey ? { no: String(x.jersey) } : {}),
            ...(x.citizenshipCountry?.abbreviation ? { nat: x.citizenshipCountry.abbreviation } : {}),
          });
        }
      }
      if (!list.length) continue;
      const seen = new Set((rosters[ko] || []).map((p) => p.id));
      rosters[ko] = [...(rosters[ko] || []), ...list.filter((p) => !seen.has(p.id))].slice(0, 70);
      teamCount++;
    }
    console.log(`[rosters] ${slug} teams=${teams.length} total=${Object.keys(rosters).length}`);
  }
  await fetchMlbRosters(rosters);
  await fetchBasketballRosters(rosters);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const shards = Array.from({ length: 16 }, () => ({}));
  for (const [ko, list] of Object.entries(rosters)) shards[parseInt(shardOf(ko), 16)][ko] = list;
  for (let i = 0; i < 16; i++) await fs.writeFile(path.join(OUT_DIR, `${i.toString(16)}.json`), JSON.stringify(shards[i]) + '\n', 'utf8');
  console.log(`[rosters] teams=${Object.keys(rosters).length} players=${Object.values(rosters).reduce((s, l) => s + l.length, 0)} unmatched=${unmatched.length}`);
  if (unmatched.length) console.log('[rosters] unmatched sample: ' + unmatched.slice(0, 40).join(' | '));
}

main().catch((e) => { console.error(e); process.exit(1); });

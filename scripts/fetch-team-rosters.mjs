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

// K리그 29개 클럽 + 국가대표(남자) — ESPN 에 자료가 없어 영문 위키백과 "Current squad"({{Fs player|no=|nat=|pos=|name=[[…]]}} 표)를 파싱한다.
// 위키 제목은 team-info 샤드의 wiki 필드를 재사용. 선수 한글 이름은 위키 링크 → Wikidata 라벨(ko)로 얻고(없으면 영문), 사진은 없다.
// 첫 번째 Fs start~Fs end 블록(현재 선수단)만 쓴다(임대·유스 블록 제외).
const WIKI_UA = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
async function wikiGet(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA }, signal: AbortSignal.timeout(25000) });
      if (res.ok) return await res.json();
    } catch { /* 재시도 */ }
    await sleep(600 * (i + 1));
  }
  return undefined;
}
function parseSquad(wikitext) {
  // 클럽: {{Fs start}}…{{Fs player}}…{{Fs end}} / 국가대표: {{nat fs g start}}…{{nat fs g player}}…{{nat fs end}} — 첫 블록(현재 선수단/소집 명단)만.
  const blocks = [...wikitext.matchAll(/\{\{\s*(?:Fs start|nat fs g start|nat fs start)[^}]*\}\}([\s\S]*?)\{\{\s*(?:Fs end|nat fs end)\s*\}\}/gi)].map((m) => m[1]);
  const pick = blocks.find((b) => (b.match(/\{\{\s*(?:Fs player|nat fs g player|nat fs player)/gi) || []).length >= 8) ?? blocks[0];
  if (!pick) return [];
  const out = [];
  for (const m of pick.matchAll(/\{\{\s*(?:Fs player|nat fs g player|nat fs player)([^\n]*)\}\}/gi)) {
    const body = m[1];
    // 값에 [[링크|표시]] 가 있으면 그 안의 | 를 필드 구분자로 오인하지 않는다.
    const f = (k) => new RegExp('\\|\\s*' + k + '\\s*=\\s*((?:\\[\\[[^\\]]*\\]\\]|[^|}\\[])*)', 'i').exec(body)?.[1]?.trim() ?? '';
    const nameRaw = f('name');
    const link = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(nameRaw);
    const title = link ? link[1].trim() : '';
    const n = (link ? (link[2] || link[1]) : nameRaw).replace(/\s*\([^)]*\)\s*$/, '').replace(/'{2,3}/g, '').trim();
    if (!n) continue;
    const no = f('no').replace(/[^0-9]/g, '');
    const pos = f('pos').trim();
    const nat = f('nat').trim().toUpperCase();
    out.push({ title, n, no, pos, nat });
  }
  return out;
}
async function koLabelsFor(titles) {
  // 영문 위키 제목 → Wikidata Q → ko 라벨
  const qOf = new Map();
  const uniq = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const j = await wikiGet('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item', titles: chunk.join('|') }));
    await sleep(DELAY_MS);
    if (!j?.query) continue;
    const norm = new Map((j.query.normalized || []).map((x) => [x.from, x.to]));
    const redir = new Map((j.query.redirects || []).map((x) => [x.from, x.to]));
    const byTitle = new Map((j.query.pages || []).map((pg) => [pg.title, pg.pageprops?.wikibase_item]));
    for (const t of chunk) { let k = norm.get(t) ?? t; k = redir.get(k) ?? k; const q = byTitle.get(k); if (q) qOf.set(t, q); }
  }
  const labels = new Map();
  const qs = [...new Set(qOf.values())];
  for (let i = 0; i < qs.length; i += 50) {
    const j = await wikiGet('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbgetentities', format: 'json', props: 'labels', languages: 'ko', ids: qs.slice(i, i + 50).join('|') }));
    await sleep(DELAY_MS);
    for (const [q, e] of Object.entries(j?.entities || {})) if (e?.labels?.ko?.value) labels.set(q, e.labels.ko.value);
  }
  return (title) => labels.get(qOf.get(title));
}
async function fetchWikiSquads(rosters) {
  const info = {};
  for (const f of await fs.readdir(path.join(REPO_ROOT, 'team-info'))) if (/^[0-9a-f]\.json$/.test(f)) Object.assign(info, JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'team-info', f), 'utf8')));
  const games = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'games.json'), 'utf8'));
  const NAT = new Set(['WORLDCUP', 'AMATCHFRIENDLY', 'WCQUEFA', 'UNL', 'WCQAFC', 'ASIANCUP', 'AFRICACUP', 'COPAAMERICA', 'UEFAEURO', 'U17WORLDCUP']);
  const targets = new Set();
  for (const g of games) for (const t of [g.home, g.away]) {
    if (!t || (rosters[t] && !String(rosters[t][0]?.id).startsWith('wk:'))) continue; // wk: 로스터는 매번 새로 받는다
    const w = info[t]?.wiki || '';
    if ((g.league === 'K리그1' || g.league === 'K리그2') && w) targets.add(t);
    else if (NAT.has(g.league) && /national (football|soccer) team/i.test(w) && !/여자|\(/.test(t)) targets.add(t);
  }
  let n = 0;
  for (const key of targets) {
    const j = await wikiGet('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'parse', format: 'json', formatversion: '2', redirects: '1', prop: 'wikitext', page: info[key].wiki }));
    await sleep(DELAY_MS);
    const squad = parseSquad(j?.parse?.wikitext || '');
    if (squad.length < 8) continue;
    const ko = await koLabelsFor(squad.map((x) => x.title));
    rosters[key] = squad.slice(0, 45).map((x, i) => ({
      id: `wk:${key}:${x.no || i}`, n: x.n,
      ...(ko(x.title) ? { k: ko(x.title) } : {}),
      ...(x.pos ? { pos: x.pos } : {}), ...(x.no ? { no: x.no } : {}), ...(x.nat ? { nat: x.nat } : {}),
    }));
    n++;
  }
  console.log(`[rosters] wiki squads teams=${n} (targets=${targets.size})`);
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
  await fetchWikiSquads(rosters);
  await fetchBasketballRosters(rosters);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const shards = Array.from({ length: 16 }, () => ({}));
  for (const [ko, list] of Object.entries(rosters)) shards[parseInt(shardOf(ko), 16)][ko] = list;
  for (let i = 0; i < 16; i++) await fs.writeFile(path.join(OUT_DIR, `${i.toString(16)}.json`), JSON.stringify(shards[i]) + '\n', 'utf8');
  console.log(`[rosters] teams=${Object.keys(rosters).length} players=${Object.values(rosters).reduce((s, l) => s + l.length, 0)} unmatched=${unmatched.length}`);
  if (unmatched.length) console.log('[rosters] unmatched sample: ' + unmatched.slice(0, 40).join(' | '));
}

main().catch((e) => { console.error(e); process.exit(1); });

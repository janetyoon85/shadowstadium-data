// 팀 정보 백필(2026-10-02, 사용자: "팀 클릭했을때 팀 정보 … 가능한한 많은 정보") — team-name-en.json의 영문명으로
// 영문 위키 문서를 찾고(클럽/팀 설명 키워드+제목 토큰 검증) Wikidata claims + 위키 본문 절(역사/우승/라이벌/레전드)
// + Commons 사진을 team-info.json에 영구 캐시. 앱 런타임은 이 파일만 읽음(위키 호출 0회 원칙, 단 앱 언어판
// 위키 요약은 팀 상세를 열 때 sitelink 제목으로 1회 조회). null=확정 없음, undefined=일시 실패(재시도).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIKI_UA, WIKI_REQUEST_DELAY_MS } from './venue-photo-wiki.mjs';
import { BAD_FILE_RE, normalizeForMatch } from './venue-photo-commons.mjs';
import { fnv1a32 } from './topic.mjs';
import { parseWinnerLists } from './team-honours-parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'team-info'); // 앱이 팀 하나 열 때 샤드 1개(16분할, fnv1a32 끝 hex 1자리)만 받음.
const shardOf = (key) => fnv1a32(key).slice(-1);
const NAMES = path.join(REPO_ROOT, 'team-name-en.json');
const BUDGET = Number(process.env.TEAM_INFO_BUDGET || 100);
const LANGS = ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-hans', 'zh-hant', 'hi', 'tr', 'nl'];
const WIKIS = ['ko', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh', 'hi', 'tr', 'nl'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEAM_DESC_RE = /\b(club|team|franchise|side|squad|sports organi[sz]ation)\b|national .*(football|soccer|baseball|basketball)/i;
const COUNTRY_DESC_RE = /\b(country|sovereign state|republic|kingdom|territory|island nation|special administrative)\b/i;
const NAME_GENERIC = new Set(['fc', 'cf', 'sc', 'ac', 'fk', 'afc', 'club', 'de', 'la', 'le', 'the', 'of', 'and', 'cd', 'cs', 'ca', 'sk', 'if', 'bk', 'sv', 'vfl', 'vfb', 'tsv', 'us', 'as', 'ss']);

async function get(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': WIKI_UA }, signal: c.signal });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}
const wp = (lang, params) => get(`https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`);
const pause = () => sleep(WIKI_REQUEST_DELAY_MS);

async function labelsFor(ids) {
  const out = {};
  const list = [...ids];
  for (let i = 0; i < list.length; i += 50) {
    const j = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${list.slice(i, i + 50).join('|')}&props=labels&languages=${LANGS.join('|')}&format=json`);
    await pause();
    if (!j) return undefined;
    for (const [k, e] of Object.entries(j.entities || {})) {
      const m = {};
      for (const l of LANGS) if (e?.labels?.[l]?.value && (l === 'en' || e.labels[l].value !== e.labels.en?.value)) m[l] = e.labels[l].value;
      out[k] = m;
    }
  }
  return out;
}

function nameTokens(base) {
  return normalizeForMatch(base.replace(/\(.*?\)/g, ' ')).split(' ').filter((t) => t.length > 2 && !NAME_GENERIC.has(t));
}

function cutSentence(text, max) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' '))).trim();
}

function sectionSlice(text, headRe) {
  const lines = text.split('\n');
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(={2,6}) (.+?) \1$/.exec(lines[i].trim());
    if (!m) continue;
    if (start < 0) {
      if (headRe.test(m[2])) { start = i + 1; level = m[1].length; }
    } else if (m[1].length <= level) {
      return lines.slice(start, i);
    }
  }
  return start < 0 ? null : lines.slice(start);
}
const bodyLines = (ls) => ls.map((l) => l.trim()).filter((l) => l && !/^={2,6} .+ ={2,6}$/.test(l));

function parseHonoursHtml(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/&#\d+;|&\w+;/g, ' ').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim());
    const i = cells.findIndex((c, idx) => idx >= 1 && /^\d{1,3}$/.test(c));
    if (i < 1) continue;
    const comp = cells[i - 1].replace(/(\s+\d{1,2})+$/, '').trim();
    if (!comp || comp.length > 60 || /^(type|competition|titles?)$/i.test(comp)) continue;
    const n = Number(cells[i]);
    if (!n) continue;
    if (/^total/i.test(comp)) continue;
    const yrs = (cells[i + 1] || '').slice(0, 70);
    rows.push([comp, n, /(1[89]|20)\d{2}/.test(yrs) ? yrs : '']);
  }
  return rows;
}

// 선수 기록표(최다출장 등)·상대팀 표가 우승 이력으로 잘못 잡히는 것 방지 — 라벨 대부분이 대회명 단어 없는 사람/팀 이름이면 거부.
const COMP_WORD = /cup|copa|coupe|coppa|taça|liga|league|lig\b|serie|série|división|division|divisi|primera|segunda|tercera|categor|campeon|champion|trophy|title|olympic|games|shield|super|medal|bowl|tournament|ligue|bundesliga|eredivisie|premier|torneo|torneio|play-?off|winners|runners|1st|2nd|3rd|first|second|third|series|pennant|promotion|\d/i;
function looksLikeRecordTable(rows) {
  const nameLike = rows.filter((r) => Array.isArray(r) && typeof r[0] === 'string' && !COMP_WORD.test(r[0]) && /^\S+( \S+){1,3}( \(list\))?$/.test(r[0].trim()));
  return nameLike.length >= Math.max(2, Math.ceil(rows.length / 2));
}

function parseInfoboxTitles(html) {
  const out = [];
  const box = /<table[^>]*class="[^"]*infobox[^"]*"[\s\S]*?<\/table>/.exec(html)?.[0] || '';
  for (const m of box.matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const k = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const v = m[2].replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/&#\d+;|&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (/title|champion|pennant|world series|cup|trophy/i.test(k) && v && v.length < 160) out.push([k, v.slice(0, 120)]);
  }
  return out.slice(0, 8);
}

async function findPage(base) {
  const queries = [base];
  const plain = base.replace(/\(.*?\)/g, '').trim();
  const s = await wp('en', { action: 'query', list: 'search', srsearch: base, srlimit: '6' });
  if (!s) return undefined;
  let titles = (s.query?.search || []).map((r) => r.title);
  await pause();
  const toks = nameTokens(base);
  const isWomen = /women|ladies|\(w\)/i.test(base);
  let sawCountry = false;
  for (const title of titles) {
    if (!isWomen && /women|\bU-?\d\d\b|under-\d\d|reserves|academy|youth|season|\bin \d{4}|\bat the \d{4}/i.test(title)) continue;
    const nt = normalizeForMatch(title);
    if (toks.length && !toks.some((t) => nt.includes(t))) continue;
    const p = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    await pause();
    if (!p) return undefined;
    if (!p.wikibase_item || p.type === 'disambiguation') continue;
    if (COUNTRY_DESC_RE.test(p.description || '') && !TEAM_DESC_RE.test(p.description || '')) { sawCountry = true; continue; }
    if (!TEAM_DESC_RE.test(p.description || '')) continue;
    return { title: p.title, summary: p, plain };
  }
  if (sawCountry) return { country: plain };
  return null;
}

async function loadPage(title, summary) {
  const e = await get(`https://www.wikidata.org/wiki/Special:EntityData/${summary.wikibase_item}.json`);
  await pause();
  if (!e) return undefined;
  const ent = e.entities?.[summary.wikibase_item];
  const cl = ent?.claims || {};
  const val = (c) => c?.mainsnak?.datavalue?.value;
  const cur = (prop, n = 2) => (cl[prop] || []).filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582).map((c) => val(c)?.id).filter(Boolean).slice(0, n);
  const yr = (cl.P571 || []).map((c) => /^[+-]?(\d{4})/.exec(val(c)?.time || '')?.[1]).find(Boolean);
  const nick = {};
  for (const c of cl.P1449 || []) { const v = val(c); if (v?.text && v.language) (nick[v.language] ||= []).push(v.text); }
  const venue = cur('P115'), league = cur('P118'), coach = [];
  const ids = new Set([...venue, ...league, ...coach]);
  const labels = ids.size ? await labelsFor(ids) : {};
  if (!labels) return undefined;
  const L = (arr) => arr.map((q) => labels[q]).filter((m) => m && Object.keys(m).length);
  const sl = {};
  for (const w of WIKIS) { const t = ent?.sitelinks?.[`${w}wiki`]?.title; if (t) sl[w] = t; }

  const info = { wiki: title };
  {
    const al = new Set();
    for (const l of LANGS) { const v = ent?.labels?.[l]?.value; if (v) al.add(v); }
    for (const l of Object.keys(ent?.aliases || {})) if (LANGS.includes(l) || l === 'zh' || l === 'ko' || l === 'ja') for (const a of ent.aliases[l].slice(0, 4)) al.add(a.value);
    for (const v of Object.values(ent?.labels || {})) if (al.size < 30) al.add(v.value);
    info._al = [...al].filter((x) => x && x.length <= 60).slice(0, 36);
  }
  if (yr) info.y = Number(yr);
  if (Object.keys(nick).length) info.nick = Object.fromEntries(Object.entries(nick).map(([k, v]) => [k, [...new Set(v)].slice(0, 4)]));
  if (venue.length) info.venue = L(venue);
  if (league.length) info.league = L(league);
  if (Object.keys(sl).length) info.sl = sl;
  if (summary.extract) info.lead = cutSentence(summary.extract, 520);

  const ex = await wp('en', { action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki', titles: title });
  await pause();
  if (!ex) return undefined;
  const text = Object.values(ex.query?.pages || {})[0]?.extract || '';
  const hist = sectionSlice(text, /^(history|club history|franchise history|team history)$/i);
  if (hist) { const h = cutSentence(bodyLines(hist).join(' '), 620); if (h.length > 80) info.hist = h; }
  const riv = sectionSlice(text, /rival|derby|derbies/i);
  if (riv) { const r = cutSentence(bodyLines(riv).join(' '), 480); if (r.length > 40) info.rival = r; }
  const leg = sectionSlice(text, /notable|legend|famous|former players|hall of fame|players of note|retired numbers|greatest|club icons/i);
  if (leg) {
    const ls = bodyLines(leg);
    if (ls.length) {
      const short = ls.filter((l) => l.length <= 70);
      const lg = short.length >= 3 && short.length >= ls.length * 0.6 ? short.slice(0, 12) : cutSentence(ls.join(' '), 380);
      if (Array.isArray(lg) || lg.length >= 80) info.legends = lg;
    }
  }

  const sec = await wp('en', { action: 'parse', page: title, prop: 'sections' });
  await pause();
  const secs = sec?.parse?.sections || [];
  const hs = secs.find((s) => Number(s.toclevel) <= 2 && /^(honou?rs|trophies|palmar[eè]s)/i.test(s.line.trim()))
    || secs.find((s) => Number(s.toclevel) <= 2 && !/records?|individual/i.test(s.line) && /honou?rs|trophies|achievements|palmar[eè]s|championships|titles/i.test(s.line));
  if (hs) {
    const p = await wp('en', { action: 'parse', page: title, section: hs.index, prop: 'text' });
    await pause();
    const html = (p?.parse?.text?.['*'] || '').replace(/<ol[^>]*class="[^"]*references[^"]*"[\s\S]*?<\/ol>/g, '').replace(/<div[^>]*class="[^"]*reflist[^"]*"[\s\S]*?<\/div>/g, '');
    let rows = parseHonoursHtml(html);
    if (!rows.length) rows = parseWinnerLists(html);
    if (!rows.length) rows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter((x) => x.length > 3 && x.length < 120 && !/^runners?-?up/i.test(x)).slice(0, 8);
    rows = rows.filter((r) => !/^\^|Retrieved|Archived|\bwww\.|https?:|rsssf/i.test(Array.isArray(r) ? r.join(' ') : String(r)));
    if (rows.length && !looksLikeRecordTable(rows)) info.honours = rows.slice(0, 14);
  }
  if (!info.honours) {
    const p = await wp('en', { action: 'parse', page: title, prop: 'text', section: '0' });
    await pause();
    const ib = parseInfoboxTitles(p?.parse?.text?.['*'] || '');
    if (ib.length) info.honours = ib;
  }

  const files = [];
  const img = val((cl.P18 || [])[0]);
  if (typeof img === 'string') files.push(`File:${img}`);
  const cat = val((cl.P373 || [])[0]);
  if (typeof cat === 'string') {
    const cm = await get(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', list: 'categorymembers', cmtitle: `Category:${cat}`, cmtype: 'file', cmlimit: '40' })}`);
    await pause();
    const extra = (cm?.query?.categorymembers || []).map((m) => m.title).filter((t) => /\.jpe?g$/i.test(t) && !/^File:\d{4}[ _.-]\d/.test(t) && !/logo|crest|badge|flag|map|kit|shirt|jersey|ticket|stamp|poster|coat|emblem/i.test(t));
    for (const t of extra) { if (files.length >= 5) break; if (!files.includes(t)) files.push(t); }
  }
  const home = cur('P115', 1)[0];
  if (home && files.length < 3) {
    const he = await get(`https://www.wikidata.org/wiki/Special:EntityData/${home}.json`);
    await pause();
    const himg = (he?.entities?.[home]?.claims?.P18 || []).map(val).find((x) => typeof x === 'string');
    if (himg && !files.includes(`File:${himg}`)) files.push(`File:${himg}`);
  }
  info.pc = 1;
  if (files.length) {
    const VENUE_OK = /stadium|stadion|stadio|estadio|estádio|arena|ballpark|ball_park|\bpark\b|_park|field|ground|dome|coliseum|campo|stade[_ .-]/i, PHOTO_BAD = /match|game|vs|_v_|final|celebrat|protest|fora_|player|goal|fans|ultras|portrait|statue|signed|ball\b|camera|trophy|cup|banner|bus|train|president|coach|manager|cheer|first.?pitch|singer|actor/i;
    const uniq = [...new Set(files)].filter((t) => VENUE_OK.test(t.replace(/ /g, "_")) && !PHOTO_BAD.test(t)).slice(0, 6);
    const ii = await get(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', titles: uniq.join('|'), prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800' })}`);
    await pause();
    const pages = Object.values(ii?.query?.pages || {});
    const photos = uniq.map((t) => pages.find((p) => (p.title || '').replace(/_/g, ' ') === t.replace(/_/g, ' '))).map((p) => p?.imageinfo?.[0]).filter((i) => i && /^image\/(jpeg|png)$/.test(i.mime || '')).map((i) => i.thumburl || i.url).filter(Boolean);
    if (photos.length) info.photos = photos;
  }
  return info;
}

async function fetchInfo(ko, en) {
  const isBk = ko.startsWith('bk:');
  const BKFIX = { 'Islamic Republic of Iran': 'Iran', 'Republic of Korea': 'South Korea', 'Chinese Taipei': 'Taiwan', "People's Republic of China": 'China', 'USA': 'United States', 'Hong Kong, China': 'Hong Kong' };
  const bkNat = isBk && /^bk:[a-z]+:(FIBA|OLYMPICS_[MW]|ASIAD3?_[MW]):/.test(ko);
  const bkW = bkNat && /_W:/.test(ko);
  const f = bkNat ? { country: BKFIX[en] || en } : await findPage(isBk ? (BKFIX[en] || en) : en);
  if (f === undefined) return undefined;
  if (f === null) return null;
  if (f.country) {
    const out = {};
    for (const [suffix, sportKey] of isBk ? [['national basketball team', '']] : [['national football team', ''], ['national baseball team', '|baseball']]) {
      const q = `${f.country} ${suffix}`;
      const s = await wp('en', { action: 'query', list: 'search', srsearch: q, srlimit: '3' });
      await pause();
      const title = (s?.query?.search || []).find((r) => normalizeForMatch(r.title).includes(normalizeForMatch(f.country)) && /national/i.test(r.title) && (bkW ? /women/i.test(r.title) && !/u-?\d\d|under/i.test(r.title) : !/women|u-?\d\d|under/i.test(r.title)) && new RegExp(suffix.split(' ')[1], 'i').test(r.title))?.title;
      if (!title) continue;
      const p = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
      await pause();
      if (!p?.wikibase_item) continue;
      const info = await loadPage(p.title, p);
      if (info) out[ko + sportKey] = info;
    }
    return Object.keys(out).length ? { multi: out } : null;
  }
  return loadPage(f.title, f.summary);
}

const ALIASES_PATH = path.join(REPO_ROOT, 'team-aliases.json');
async function save(cache, meta, aliases) {
  await fs.writeFile(ALIASES_PATH, JSON.stringify(aliases) + '\n', 'utf8');
  await fs.writeFile(path.join(OUT_DIR, '_meta.json'), JSON.stringify(meta) + '\n', 'utf8');
  const shards = Array.from({ length: 16 }, () => ({}));
  for (const [k, v] of Object.entries(cache)) shards[parseInt(shardOf(k), 16)][k] = v;
  for (let i = 0; i < 16; i++) await fs.writeFile(path.join(OUT_DIR, `${i.toString(16)}.json`), JSON.stringify(shards[i]) + '\n', 'utf8');
}

async function main() {
  const names = JSON.parse(await fs.readFile(NAMES, 'utf8'));
  try { Object.assign(names, JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'team-name-en.json'), 'utf8'))); } catch {}
  try {
    const bt = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'teams.json'), 'utf8'));
    let bi = {}; try { bi = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'team-i18n.json'), 'utf8')); } catch {}
    for (const [k, t] of Object.entries(bt)) { const en = t.en || bi[k]?.en; if (en && !names['bk:' + k] && !names['bk:' + k.replace(/^naver:/, 'espn:')]) names['bk:' + k] = en; }
  } catch {}
  const cache = {};
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (let i = 0; i < 16; i++) { try { Object.assign(cache, JSON.parse(await fs.readFile(path.join(OUT_DIR, `${i.toString(16)}.json`), 'utf8'))); } catch {} }
  const only = process.env.TEAM_INFO_ONLY ? process.env.TEAM_INFO_ONLY.split(',') : null;
  let meta = {};
  let aliases = {};
  try { aliases = JSON.parse(await fs.readFile(ALIASES_PATH, 'utf8')); } catch {}
  const takeAl = (k, v) => { if (v && v._al) { aliases[k] = v._al; delete v._al; } };
  try { meta = JSON.parse(await fs.readFile(path.join(OUT_DIR, '_meta.json'), 'utf8')); } catch {}
  const today = Math.floor(Date.now() / 86400000);
  for (const k of Object.keys(cache)) if (!(k in meta)) meta[k] = today;
  const REFRESH_DAYS = Number(process.env.TEAM_INFO_REFRESH_DAYS || 90);
  const fresh = Object.keys(names).filter((k) => !(k in cache) && (!only || only.includes(k)));
  const stale = Object.keys(names).filter((k) => k in cache && (today - (meta[k] ?? today) >= REFRESH_DAYS || (cache[k] && !(k in aliases)) || (cache[k] && !cache[k].pc)) && (!only || only.includes(k))).sort((a, b) => meta[a] - meta[b]);
  const bkFirst = (a, b) => (b.startsWith('bk:') ? 1 : 0) - (a.startsWith('bk:') ? 1 : 0);
  const todo = [...fresh.sort(bkFirst), ...stale];
  console.log(`[team-info] total=${Object.keys(names).length} cached=${Object.keys(cache).length} todo=${todo.length} (stale=${stale.length}) budget=${BUDGET}`);
  let done = 0, found = 0;
  for (const ko of todo) {
    if (done >= BUDGET) break;
    done++;
    const r = await fetchInfo(ko, names[ko]);
    if (r === undefined) continue;
    if (r && r.multi) {
      for (const [k, v] of Object.entries(r.multi)) { takeAl(k, v); cache[k] = v; meta[k] = today; }
      cache[ko] ??= null;
      meta[ko] = today;
      found++;
    } else {
      takeAl(ko, r);
      cache[ko] = r;
      meta[ko] = today;
      if (r) found++;
    }
    if (done % 10 === 0) await save(cache, meta, aliases);
  }
  await save(cache, meta, aliases);
  console.log(`[team-info] processed=${done} found=${found} total_cached=${Object.keys(cache).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// 경기장 정보 백필(2026-10-02, 사용자: "경기장 먹거리/주차/교통 확인안되는거지?" → 위키데이터로 가능한
// 구장 구조화 정보(개장연도/수용인원/소유·운영/설계/표면)부터 시작). venue-name-en.json의 영문명으로
// 위키 문서를 찾고(동명이인 방지: 구장 설명 키워드 검증) wikibase_item → Wikidata claims.
// 결과는 venue-info.json 영구 캐시(앱 런타임 외부 호출 0회 원칙). null=확정 없음, undefined=일시 실패(재시도).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlausibleStadiumDescription, WIKI_UA, WIKI_REQUEST_DELAY_MS } from './venue-photo-wiki.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(REPO_ROOT, 'venue-info.json');
const NAMES = path.join(REPO_ROOT, 'venue-name-en.json');
const BUDGET = Number(process.env.VENUE_INFO_BUDGET || 60);
const LANGS = ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-hans', 'zh-hant', 'hi', 'tr', 'nl'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': WIKI_UA }, signal: c.signal });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

async function labelsFor(ids) {
  const out = {};
  const list = [...ids];
  for (let i = 0; i < list.length; i += 50) {
    const j = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${list.slice(i, i + 50).join('|')}&props=labels&languages=${LANGS.join('|')}&format=json`);
    await sleep(WIKI_REQUEST_DELAY_MS);
    if (!j) return undefined;
    for (const [k, e] of Object.entries(j.entities || {})) {
      const m = {};
      for (const l of LANGS) if (e?.labels?.[l]?.value) m[l] = e.labels[l].value;
      out[k] = m;
    }
  }
  return out;
}

async function fetchInfo(name) {
  const s = await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=5`);
  if (!s) return undefined;
  const results = s.query?.search || [];
  const title = (results.find((r) => r.title?.toLowerCase() === name.toLowerCase()) ?? results[0])?.title;
  if (!title) return null;
  await sleep(WIKI_REQUEST_DELAY_MS);
  const p = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!p) return undefined;
  if (!isPlausibleStadiumDescription(p.description) || !p.wikibase_item) return null;
  await sleep(WIKI_REQUEST_DELAY_MS);
  const e = await get(`https://www.wikidata.org/wiki/Special:EntityData/${p.wikibase_item}.json`);
  if (!e) return undefined;
  const cl = e.entities?.[p.wikibase_item]?.claims || {};
  const val = (c) => c?.mainsnak?.datavalue?.value;
  const qids = (prop, n = 3) => (cl[prop] || []).filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582).map((c) => val(c)?.id).filter(Boolean).slice(0, n);
  const yr = (cl.P571 || []).map((c) => /^[+-]?(\d{4})/.exec(val(c)?.time || '')?.[1]).find(Boolean);
  const caps = (cl.P1083 || []).filter((c) => c.rank !== 'deprecated').map((c) => Number(val(c)?.amount)).filter((n) => n > 0);
  const own = qids('P127'), op = qids('P137'), arch = qids('P84'), surf = qids('P765', 2);
  const ids = new Set([...own, ...op, ...arch, ...surf]);
  const labels = ids.size ? await labelsFor(ids) : {};
  if (!labels) return undefined;
  const L = (arr) => arr.map((q) => labels[q]).filter((m) => m && Object.keys(m).length);
  const info = { wiki: title, y: yr ? Number(yr) : undefined, cap: caps.length ? caps[caps.length - 1] : undefined, own: L(own), op: L(op), arch: L(arch), surf: L(surf) };
  for (const k of ['own', 'op', 'arch', 'surf']) if (!info[k].length) delete info[k];
  return info.y || info.cap || info.own || info.op || info.arch || info.surf ? info : null;
}

async function main() {
  const names = JSON.parse(await fs.readFile(NAMES, 'utf8'));
  try { Object.assign(names, JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'venue-name-en.json'), 'utf8'))); } catch {}
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}
  const todo = Object.keys(names).filter((id) => !(id in cache)).sort((a, b) => (b.startsWith('bk_') ? 1 : 0) - (a.startsWith('bk_') ? 1 : 0));
  console.log(`[venue-info] total=${Object.keys(names).length} cached=${Object.keys(cache).length} todo=${todo.length} budget=${BUDGET}`);
  let done = 0, found = 0;
  for (const id of todo) {
    if (done >= BUDGET) break;
    done++;
    const q = names[id].name;
    const r = await fetchInfo(q);
    await sleep(WIKI_REQUEST_DELAY_MS);
    if (r === undefined) continue;
    cache[id] = r;
    if (r) found++;
    if (done % 15 === 0) await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
  }
  await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
  console.log(`[venue-info] processed=${done} found=${found} total_cached=${Object.keys(cache).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// 농구 선수 위키데이터 보강(2026-10-02) — ESPN/네이버에 사진·국적이 없는 선수(KBL/NBL/FIBA 등)를 Wikidata에서 채움.
// 결과: basketball/player-wd.json {pid: {q, nat?, dob?, img?, en?, labels?{lang}, m} | null}
// 오매칭 방지: 사람(Q5)+직업 농구선수(Q3665646)+생존(P570 없음)+출생 1975년 이후, ESPN 생일이 있으면 정확히 일치,
// 없으면(KBL/NBL) 위 조건을 만족하는 후보가 정확히 1명일 때만 채택(m='dob'|'uniq').
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'basketball');
const OUT = path.join(DIR, 'player-wd.json');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const BUDGET = Number(process.env.BK_WD_BUDGET || 150);
const LANGS = ['ko', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-hans', 'zh-hant', 'hi', 'tr', 'nl'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const COUNTRY_FIX = { 'United States of America': 'USA', 'United States': 'USA', 'Czech Republic': 'Czechia', 'Turkey': 'Türkiye', "Côte d'Ivoire": 'Ivory Coast' };

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return undefined;
    return await res.json();
  } catch { return undefined; }
}
const claimIds = (e, p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

async function lookup(p, info) {
  const isKo = p.id.startsWith('nbk:');
  const lang = isKo ? 'ko' : 'en';
  const names = [...new Set([p.name, p.name.normalize('NFD').replace(/[̀-ͯ]/g, '')])];
  const cand = new Set();
  for (const n of names) {
    const s = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(n)}&language=${lang}&limit=10&format=json`);
    if (s === undefined) return undefined;
    for (const x of s.search || []) cand.add(x.id);
    await sleep(250);
  }
  if (!cand.size) return null;
  const ents = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...cand].join('|')}&props=labels|claims&languages=${['en', ...LANGS].join('|')}&format=json`);
  if (ents === undefined) return undefined;
  const dobWant = info?.dob;
  const hits = [];
  for (const e of Object.values(ents.entities || {})) {
    if (!claimIds(e, 'P31').includes('Q5') || !claimIds(e, 'P106').includes('Q3665646')) continue;
    const born = (e.claims?.P569 || []).map((c) => (c.mainsnak?.datavalue?.value?.time || '').replace(/^\+/, '').slice(0, 10));
    if (dobWant) { if (!born.includes(dobWant)) continue; }
    else if ((e.claims?.P570 || []).length || !born.some((b) => Number(b.slice(0, 4)) >= 1975)) continue;
    hits.push({ e, dob: born[0] });
  }
  if (hits.length !== 1) return null;
  const { e, dob } = hits[0];
  const labels = {};
  for (const l of LANGS) { const v = e.labels?.[l]?.value; if (v) labels[l] = v; }
  const img = (e.claims?.P18 || [])[0]?.mainsnak?.datavalue?.value;
  const cids = claimIds(e, 'P27');
  let nat;
  if (cids.length) {
    const c = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${cids[0]}&props=labels&languages=en&format=json`);
    const nm = c?.entities?.[cids[0]]?.labels?.en?.value;
    if (nm) nat = COUNTRY_FIX[nm] || nm;
  }
  return {
    q: e.id, nat, dob: dob || undefined, en: e.labels?.en?.value || undefined,
    img: img ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img.replace(/ /g, '_'))}?width=400` : undefined,
    labels: Object.keys(labels).length ? labels : undefined, m: dobWant ? 'dob' : 'uniq',
  };
}

async function main() {
  const players = await readJson(path.join(DIR, 'players.json'), []);
  const info = await readJson(path.join(DIR, 'player-info.json'), {});
  const photos = await readJson(path.join(ROOT, 'player-photos.json'), {});
  const cache = await readJson(OUT, {});
  const need = (p) => !photos[p.id] || !info[p.id]?.nat || p.id.startsWith('nbk:');
  const only = process.env.BK_WD_ONLY;
  const todo = players.filter((p) => p.name && (!only || p.id.startsWith(only)) && !(p.id in cache) && need(p))
    .sort((a, b) => (b.lastSeenDate || '').localeCompare(a.lastSeenDate || ''));
  console.log(`[bk-wd] cached=${Object.keys(cache).length} todo=${todo.length} budget=${BUDGET}`);
  let used = 0, got = 0;
  for (const p of todo) {
    if (used >= BUDGET) break;
    used++;
    const r = await lookup(p, info[p.id]);
    await sleep(250);
    if (r === undefined) continue;
    cache[p.id] = r;
    if (r) got++;
    if (used % 25 === 0) await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
  }
  await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
  console.log(`[bk-wd] used=${used} got=${got} remaining=${todo.length - used}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

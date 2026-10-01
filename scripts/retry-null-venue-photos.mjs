// 일회성: 사진 null인 구장을 이름 변형(괄호 안 이름, Estadio/Stadium 접두·접미)으로 재검색. 결과는 별도 파일에 저장.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlausibleStadiumDescription, WIKI_UA } from './venue-photo-wiki.mjs';
import { fetchVenuePhotoFromCommons, normalizeForMatch, distinctiveTokens } from './venue-photo-commons.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = JSON.parse(await fs.readFile(path.join(root, 'venue-photos.json'), 'utf-8'));
const en = JSON.parse(await fs.readFile(path.join(root, 'venue-name-en.json'), 'utf-8'));
const outPath = path.join(process.env.TEMP || '.', 'venue-retry-out.json');
let out = {};
try { out = JSON.parse(await fs.readFile(outPath, 'utf-8')); } catch {}
async function wikiPhoto(v) {
  try {
    const sr = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(v) + '&format=json&srlimit=5', { headers: { 'User-Agent': WIKI_UA }, signal: AbortSignal.timeout(10000) });
    if (!sr.ok) return null;
    const toks = distinctiveTokens(v);
    if (!toks.length) return null;
    const hit = ((await sr.json()).query?.search || []).find((r) => { const t = normalizeForMatch(r.title); return toks.every((k) => t.includes(k)); });
    if (!hit) return null;
    await sleep(1300);
    const pr = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(hit.title.replace(/ /g, '_')), { headers: { 'User-Agent': WIKI_UA }, signal: AbortSignal.timeout(10000) });
    if (!pr.ok) return null;
    const pj = await pr.json();
    if (!isPlausibleStadiumDescription(pj.description)) return null;
    const c = pj.thumbnail?.source || null;
    if (c && /.svg|dimen|diagram|layout|seating|logo|locator|schematic|flag_of|coat_of_arms/i.test(decodeURIComponent(c.split('/').pop() || ''))) return null;
    return c;
  } catch { return null; }
}
const KW = /stadium|stadion|stade|stadio|estadio|arena|ballpark|coliseum|park|field|ground|bowl/i;
function variants(name) {
  const set = new Set();
  const paren = /\(([^)]+)\)/.exec(name)?.[1];
  const base = name.replace(/\s*\([^)]*\)/g, '').trim();
  for (const n of [name, base, paren].filter(Boolean)) {
    set.add(n);
    if (!KW.test(n)) { set.add('Estadio ' + n); set.add(n + ' Stadium'); }
  }
  return [...set].slice(0, 5);
}
const ids = Object.keys(cache).filter((k) => !(cache[k] && cache[k].length) && en[k]?.name && !(k in out));
console.log('targets', ids.length);
let found = 0, i = 0;
for (const id of ids) {
  i++;
  let photo = null;
  for (const v of variants(en[id].name)) {
    const w = await wikiPhoto(v); await sleep(1300);
    if (typeof w === 'string') { photo = w; break; }
    const c = await fetchVenuePhotoFromCommons(v, en[id].city); await sleep(1300);
    if (typeof c === 'string') { photo = c; break; }
  }
  out[id] = photo;
  if (photo) { found++; console.log('FOUND', id, '|', en[id].name, '|', decodeURIComponent(photo.split('?')[0].split('/').slice(-2).join('/'))); }
  if (i % 10 === 0) await fs.writeFile(outPath, JSON.stringify(out));
}
await fs.writeFile(outPath, JSON.stringify(out));
console.log('done', ids.length, 'found', found);

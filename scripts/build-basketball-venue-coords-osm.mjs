// Wikidata로 못 찾은 농구 구장을 OSM Nominatim으로 보완(이름이 결과명에 포함될 때만 채택). venue-coords.json에 병합.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'basketball');
const rj = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const venues = await rj(path.join(DIR, 'venues.json'), {}); const ven = await rj(path.join(DIR, 'venue-name-en.json'), {}); const out = await rj(path.join(DIR, 'venue-coords.json'), {});
const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const nom = async (q) => { try { const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=3&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'ShadeSideCrawler/1.0 (janetyoon85@gmail.com)' } }); return r.ok ? await r.json() : []; } catch { return []; } };
let added = 0;
for (const [id, v] of Object.entries(venues)) {
  if (out[id]) continue;
  const isBl = v.src === 'bl';
  const qs = isBl ? [`${v.name} ${v.city || ''}`.trim()] : [v.name, ven[id]?.name && `${ven[id].name} ${ven[id].city || ''}`].filter(Boolean);
  const key = norm(v.name).replace(/\d/g, '');
  let hit = null;
  for (const q of qs) {
    const r = await nom(q); await new Promise((x) => setTimeout(x, 1100));
    hit = r.find((x) => (!isBl || key.length >= 2) && norm(x.display_name).includes(isBl ? key : norm(q.split(' ')[0])) );
    if (hit) break;
  }
  if (hit) { out[id] = { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5), q: 'osm' }; added++; console.log(id, v.name, '->', hit.display_name.slice(0, 70)); }
}
await fs.writeFile(path.join(DIR, 'venue-coords.json'), JSON.stringify(out, null, 1));
console.log('added', added, 'total', Object.keys(out).length, '/', Object.keys(venues).length);

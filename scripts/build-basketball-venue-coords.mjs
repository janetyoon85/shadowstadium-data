// 농구 구장 좌표(Wikidata P625) → basketball/venue-coords.json {vid:{lat,lon,q}}. 길찾기 버튼용. 이름 정확/부분 일치할 때만 채택.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'basketball');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const rj = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const gj = async (u) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch {} await new Promise((r) => setTimeout(r, 800)); } };
const venues = await rj(path.join(DIR, 'venues.json'), {});
const teams = await rj(path.join(DIR, 'teams.json'), {});
const ven = await rj(path.join(DIR, 'venue-name-en.json'), {});
const ti = await rj(path.join(DIR, 'team-i18n.json'), {});
const enMap = await rj(path.join(DIR, 'team-name-en.json'), {});
const out = await rj(path.join(DIR, 'venue-coords.json'), {});
const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const coord = (c) => { const v = c?.P625?.[0]?.mainsnak?.datavalue?.value; return v ? { lat: +v.latitude.toFixed(5), lon: +v.longitude.toFixed(5) } : null; };
async function ents(ids, props = 'claims|labels|aliases') { return (await gj(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=${props}&languages=en|ja|ko&format=json`))?.entities || {}; }
const names = (e) => [e.labels?.en?.value, e.labels?.ja?.value, e.labels?.ko?.value, ...['en', 'ja', 'ko'].flatMap((l) => (e.aliases?.[l] || []).map((a) => a.value))].filter(Boolean);
async function search(q, lang) {
  const s = await gj(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=${lang}&limit=6&format=json`);
  const ids = (s?.search || []).map((x) => x.id); if (!ids.length) return null;
  const e = await ents(ids);
  for (const id of ids) {
    const c = coord(e[id]?.claims); if (!c) continue;
    const nn = names(e[id]).map(norm); const w = norm(q);
    if (nn.some((n) => n === w || (w.length >= 5 && (n.includes(w) || w.includes(n))))) return { ...c, q: id };
  }
  return null;
}
const teamHome = async (tk) => {
  const name = teams[tk]?.en || ti[tk]?.en || enMap['bk:' + tk]; if (!name) return [];
  const s = await gj(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=5&format=json`);
  const ids = (s?.search || []).map((x) => x.id); if (!ids.length) return [];
  const e = await ents(ids, 'claims');
  for (const id of ids) { const c = e[id]?.claims; if (c?.P641?.some((x) => x.mainsnak?.datavalue?.value?.id === 'Q5372') && c?.P115) return c.P115.map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean); }
  return [];
};
let added = 0;
for (const [id, v] of Object.entries(venues)) {
  if (out[id]) continue;
  let hit = null;
  const en = ven[id]?.name;
  if (en) hit = await search(en, 'en');
  if (!hit && v.name && !/^bk_bl_/.test(id)) hit = await search(v.name, /[가-힣]/.test(v.name) ? 'ko' : 'en');
  if (!hit && v.src === 'bl') {
    const short = norm(v.name).replace(/\d/g, '');
    for (const tk of v.teams || []) {
      for (const q of await teamHome(tk)) {
        const e = (await ents([q]))[q]; const c = coord(e?.claims);
        if (c && short.length >= 2 && names(e).some((n) => norm(n).includes(short) || short.includes(norm(n)))) { hit = { ...c, q }; break; }
      }
      if (hit) break;
    }
  }
  if (hit) { out[id] = hit; added++; console.log(id, v.name, '->', hit.lat, hit.lon); }
}
await fs.writeFile(path.join(DIR, 'venue-coords.json'), JSON.stringify(out, null, 1));
console.log('added', added, 'total', Object.keys(out).length, '/', Object.keys(venues).length);

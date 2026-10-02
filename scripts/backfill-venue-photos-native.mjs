// 사진 없는 경기장 보강(2026-10-02): 영문 위키 검색이 실패한 구장을 현지어(ko/ja) 위키 이름검색 + 좌표(geosearch)로 재탐색.
// 규칙은 기존과 동일 — 구장 관련 키워드가 없거나 이미지가 없으면 폐기(틀린 사진보다 없는 게 낫다). venue-photos.json에 [url] 형태로 저장.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rj = async (f, d) => { try { return JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMIT = Number(process.env.LIMIT || 400);
const KW = /(stadium|arena|ballpark|gymnasium|sports (hall|center|centre|complex)|multi-purpose|baseball|football|soccer|basketball|경기장|체육관|야구장|운동장|축구장|스타디움|구장|アリーナ|体育館|スタジアム|球場|競技場|運動場|陸上|総合|ドーム|ホール)/i;
const has = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

async function api(lang, params) {
  const u = `https://${lang}.wikipedia.org/w/api.php?format=json&origin=*&` + new URLSearchParams(params);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (r.status === 429) { await sleep(5000); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(1500); }
  }
  return null;
}
const PROPS = { prop: 'pageimages|description|extracts', piprop: 'thumbnail', pithumbsize: '960', exintro: '1', explaintext: '1', exchars: '300' };
const okPage = (p) => p?.thumbnail?.source && KW.test((p.description || '') + ' ' + (p.extract || '').slice(0, 200) + ' ' + (p.title || ''));
const norm = (s) => (s || '').replace(/[\s·・\-()（）\[\]]/g, '').toLowerCase();
const core = (s) => norm(s).replace(/(종합운동장|운동장|경기장|체육관|야구장|축구장|스타디움|アリーナ|体育館|スタジアム|球場|競技場|stadium|arena)/gi, '');

async function byName(lang, name) {
  const j = await api(lang, { action: 'query', generator: 'search', gsrsearch: name, gsrlimit: '4', ...PROPS });
  const pages = Object.values(j?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const c = core(name);
  for (const p of pages) {
    const t = core(p.title);
    if (c.length >= 2 && (t.includes(c) || c.includes(t)) && okPage(p)) return p.thumbnail.source;
  }
  return null;
}
async function byGeo(lang, lat, lon) {
  const j = await api(lang, { action: 'query', generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: '250', ggslimit: '5', ...PROPS });
  const pages = Object.values(j?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) if (okPage(p)) return p.thumbnail.source;
  return null;
}

const P = await rj('venue-photos.json', {});
const meta = await rj('venues-meta.json', []);
const bv = await rj('basketball/venues.json', {});
const xy = await rj('basketball/venue-coords.json', {});
const en = await rj('venue-name-en.json', {});
const bven = await rj('basketball/venue-name-en.json', {});
const todo = [];
for (const m of Array.isArray(meta) ? meta : Object.values(meta)) if (!has(P[m.id])) todo.push({ id: m.id, name: m.name, en: en[m.id]?.[0] || en[m.id]?.name });
for (const [id, v] of Object.entries(bv)) if (!has(P[id])) todo.push({ id, name: v.name, en: bven[id]?.name, xy: xy[id], lg: v.lg });
console.log('대상', todo.length);
let found = 0, n = 0;
for (const v of todo.slice(0, LIMIT)) {
  n++;
  const lang = /[가-힣]/.test(v.name) ? 'ko' : /[぀-ヿ一-鿿]/.test(v.name) ? 'ja' : null;
  let url = null;
  if (lang) { url = await byName(lang, v.name); await sleep(900); }
  if (!url && v.xy) {
    for (const lg of lang ? [lang, 'en'] : ['en']) { url = await byGeo(lg, v.xy.lat, v.xy.lon); await sleep(900); if (url) break; }
  }
  if (!url && v.en) { url = await byName('en', v.en.replace(/,.*$/, '')); await sleep(900); }
  if (url) { P[v.id] = [url]; found++; console.log('OK', v.id, v.name, url.slice(-50)); await fs.writeFile(path.join(ROOT, 'venue-photos.json'), JSON.stringify(P, null, 2)); }
}
console.log(`처리 ${n} 발견 ${found}`);

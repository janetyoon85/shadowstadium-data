// 농구 구장 도시/지역명 다국어 → basketball/venue-city-i18n.json {vid:{ko,ja,es,...}} (2026-10-23, 사용자: "지역명도 다국어 적용해야지 야구 축구랑 같아").
// 구장의 영문(또는 일본어) 도시 문자열을 Wikidata 에서 찾아 18개 언어 라벨을 가져온다. 동명이인(예: Portland, Perth)은 구장 좌표에서 가장 가까운 후보(80km 이내)로 고르고,
// 좌표가 없으면 라벨이 검색어와 같고 설명이 도시류인 후보만 쓴다. 못 찾은 도시는 비워 둔다(앱은 영문 도시로 폴백).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'basketball');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const rj = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gj = async (u) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch { /* 재시도 */ } await sleep(1500); } return null; };
const WD = ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh', 'zh-hans', 'zh-cn', 'zh-hant', 'zh-tw', 'zh-hk', 'hi', 'tr', 'nl'];
const SCRIPT = { ko: /[가-힣]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/, th: /[฀-๿]/, hi: /[ऀ-ॿ]/ };
// 설명이 "도시/행정구역"으로 시작하는 후보만(설명 어딘가에 city 가 들어 있는 대학·역·미술관은 제외: "private university in New York City").
const isPlaceDesc = (d) => { const t = (d || '').trim(); return /^(the\s+)?((most populous|largest|capital|major|principal|second[- ]largest|consolidated|incorporated|unincorporated)\s+)?(city|town|village|borough|municipality|prefecture|capital|metropolis|state|county|census|special|metropolitan|ward|island|independent|megacity|human settlement|commune)/i.test(t) || /(都市|都道府県|府|県|市|区|町|州|首都)$/.test(t); };
// 같은 이름이 여럿이고 좌표도 없는 도시 — 사람이 확인한 Wikidata 항목으로 고정.
const OVERRIDES = { 'New York': 'Q60', 'College Park': 'Q668676', Inglewood: 'Q621549', Asan: 'Q42114' };
const km = (a, b) => { const R = 6371, rad = Math.PI / 180, dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

export function pickLabels(L) {
  const v = (k) => L?.[k]?.value;
  const r = {};
  for (const l of ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'hi', 'tr', 'nl']) { const x = v(l); if (x && (!SCRIPT[l] || SCRIPT[l].test(x))) r[l] = x; }
  const hs = v('zh-hans') || v('zh-cn') || v('zh'); if (hs) r['zh-Hans'] = hs;
  const ht = v('zh-hant') || v('zh-tw') || v('zh-hk') || v('zh'); if (ht) r['zh-Hant'] = ht;
  return r;
}

async function main() {
  const vn = await rj(path.join(DIR, 'venue-name-en.json'), {});
  const vs = await rj(path.join(DIR, 'venues.json'), {});
  const coords = await rj(path.join(DIR, 'venue-coords.json'), {});
  const out = await rj(path.join(DIR, 'venue-city-i18n.json'), {});
  // 도시 문자열 → 그 도시에 속한 구장들
  const byCity = new Map();
  const cityOf = (id) => vn[id]?.city || vs[id]?.city;
  for (const id of new Set([...Object.keys(vn), ...Object.keys(vs)])) { const c = cityOf(id); if (c) (byCity.get(c) ?? byCity.set(c, []).get(c)).push(id); }
  const cache = {};
  let n = 0;
  for (const [city, ids] of byCity) {
    if (ids.every((id) => out[id])) continue;
    n++;
    const lang = /[ぁ-んァ-ヶ一-龥]/.test(city) ? 'ja' : 'en';
    const s = await gj(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(city)}&language=${lang}&uselang=${lang}&type=item&limit=50&format=json`);
    await sleep(300);
    const cands = (s?.search || []).map((x) => x.id);
    if (!cands.length) { console.log('NO CANDIDATE', city); continue; }
    const e = (await gj(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${cands.join('|')}&props=claims|labels|descriptions&languages=${WD.join('|')}&format=json`))?.entities || {};
    await sleep(300);
    const vc = ids.map((id) => coords[id]).filter((c) => c?.lat != null);
    // 후보는 "라벨이 검색어와 같고 설명이 도시/행정구역류"인 것만 — 근처에 있는 건물·대학·미술관·역이 가까워서 뽑히는 일을 막는다(예: New York → 뉴욕 역사 협회, Seoul → 서울아산병원).
    // 라벨 일치가 없으면(New York → "New York City") 검색어로 시작하는 라벨 + 도시류 설명까지 넓힌다.
    const label = (ent) => (ent?.labels?.[lang]?.value || ent?.labels?.en?.value || '').toLowerCase();
    const placeLike = (ent) => isPlaceDesc(ent?.descriptions?.en?.value) || isPlaceDesc(ent?.descriptions?.ja?.value);
    const q0 = city.toLowerCase();
    const exact = cands.filter((q) => label(e[q]) === q0 && placeLike(e[q]));
    const loose = cands.filter((q) => (label(e[q]).startsWith(q0) || q0.startsWith(label(e[q]))) && label(e[q]) && placeLike(e[q]));
    // 80km 안 후보가 여럿이면 라벨(언어 수)이 가장 많은 쪽 = 보통 진짜 도시(예: Adelaide 시 vs City of Adelaide) — 그다음 가까운 쪽. 정확 일치 후보가 없거나 모두 멀면(New York=주 vs 뉴욕시) 느슨한 후보로 넓힌다.
    const within = (pool) => pool.map((q) => {
      const p = e[q].claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      const d = vc.length && p ? Math.min(...vc.map((c) => km(c, { lat: p.latitude, lon: p.longitude }))) : Infinity;
      return { q, d, n: Object.keys(e[q].labels || {}).length };
    }).filter((x) => x.d <= 80).sort((x, y) => y.n - x.n || x.d - y.d);
    let pool = exact;
    let best = OVERRIDES[city] && e[OVERRIDES[city]] ? OVERRIDES[city] : (within(exact)[0]?.q ?? within(loose)[0]?.q ?? null);
    if (!best) pool = exact.length ? exact : loose;
    if (!best && !vc.length) best = pool[0] || null; // 좌표가 없으면 같은 이름의 첫 도시류 후보
    if (!best) { console.log('UNRESOLVED', city, vc.length ? '(좌표 80km 안에 후보 없음)' : '(좌표 없음, 후보 불일치)'); continue; }
    cache[city] = pickLabels(e[best].labels);
    for (const id of ids) out[id] = cache[city];
    console.log(city, '→', best, cache[city].ko || '', '|', cache[city].ja || '');
  }
  await fs.writeFile(path.join(DIR, 'venue-city-i18n.json'), JSON.stringify(out) + '\n', 'utf8');
  console.log(`[city-i18n] cities=${n} venues=${Object.keys(out).length}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

// 농구 구장명 다국어 → basketball/venue-i18n.json {vid:{ko,ja,es,...}}. venue-coords.json의 Wikidata Q(이름 일치로 검증됨) 라벨만 사용.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'basketball');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const rj = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const gj = async (u) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch {} await new Promise((r) => setTimeout(r, 800)); } };
const coords = await rj(path.join(DIR, 'venue-coords.json'), {});
const out = await rj(path.join(DIR, 'venue-i18n.json'), {});
const WD = ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh', 'zh-hans', 'zh-cn', 'zh-hant', 'zh-tw', 'zh-hk', 'hi', 'tr', 'nl'];
const script = { ko: /[가-힣]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/, th: /[฀-๿]/, hi: /[ऀ-ॿ]/ };
const qs = [...new Set(Object.values(coords).map((c) => c.q).filter(Boolean))];
const labels = {};
for (let i = 0; i < qs.length; i += 40) {
  const e = (await gj(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qs.slice(i, i + 40).join('|')}&props=labels&languages=${WD.join('|')}&format=json`))?.entities || {};
  for (const [q, v] of Object.entries(e)) labels[q] = v.labels || {};
}
for (const [vid, c] of Object.entries(coords)) {
  const L = labels[c.q]; if (!L) continue;
  const v = (k) => L[k]?.value;
  const r = {};
  for (const l of ['ko', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'hi', 'tr', 'nl']) { const x = v(l); if (x && (!script[l] || script[l].test(x))) r[l] = x; }
  const hs = v('zh-hans') || v('zh-cn') || v('zh'); if (hs) r['zh-Hans'] = hs;
  const ht = v('zh-hant') || v('zh-tw') || v('zh-hk') || v('zh'); if (ht) r['zh-Hant'] = ht;
  if (Object.keys(r).length) out[vid] = r;
}
await fs.writeFile(path.join(DIR, 'venue-i18n.json'), JSON.stringify(out));
console.log('venue-i18n', Object.keys(out).length, 'ko', Object.values(out).filter((x) => x.ko).length);

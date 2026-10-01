// 일회성: Commons 출처로 캐시된 구장 사진을 강화된 파일명 필터로 재검증, 탈락분은 null로(재조회 안 함).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlausibleCommonsFile } from './venue-photo-commons.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = JSON.parse(await fs.readFile(path.join(root, 'venue-photos.json'), 'utf-8'));
const en = JSON.parse(await fs.readFile(path.join(root, 'venue-name-en.json'), 'utf-8'));
const dry = process.argv.includes('--dry');
let n = 0;
for (const [id, v] of Object.entries(cache)) {
  if (!Array.isArray(v) || v.length !== 1 || !/utm_source=commons\.wikimedia\.org/.test(v[0]) || !en[id]?.name) continue;
  const m = /\/(?:\d+px-|\d+px-)?([^/?]+?)(?:\?|$)/.exec(v[0]);
  const parts = v[0].split('?')[0].split('/');
  let file = decodeURIComponent(parts[parts.length - 1]).replace(/^\d+px-/, '');
  if (/^\d+px-/.test(decodeURIComponent(parts[parts.length - 1])) === false && parts.includes('thumb')) file = decodeURIComponent(parts[parts.length - 2]);
  file = file.replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
  if (!isPlausibleCommonsFile(file, en[id].name)) { console.log('DROP', id, '|', en[id].name, '|', file); n++; if (!dry) cache[id] = null; }
}
console.log('dropped', n);
if (!dry) await fs.writeFile(path.join(root, 'venue-photos.json'), JSON.stringify(cache, null, 2) + '\n', 'utf-8');

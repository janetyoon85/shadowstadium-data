// 농구 구장 국가 백필 — basketball/venue-coords.json 좌표로 venue-country.json 에 없는 'bk_*' 구장의 ISO 국가코드를 채운다(Nominatim 역지오코딩, 초당 1건).
// 앱 구장 정보 카드의 "위치" 줄(국기 + 나라 · 도시)이 이 파일을 읽는다(2026-10-26 유로리그 구장에 국기가 없던 문제).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reverseCountry, reverseGbPart } from './backfill-venue-country.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'venue-country.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coords = JSON.parse(await fs.readFile(path.join(ROOT, 'basketball', 'venue-coords.json'), 'utf8'));
const cache = JSON.parse(await fs.readFile(OUT, 'utf8').catch(() => '{}'));
const todo = Object.entries(coords).filter(([id, c]) => id.startsWith('bk_') && !(id in cache) && (c.lat || c.lon));
const budget = Number(process.env.COUNTRY_BUDGET || 60);
let done = 0, fail = 0;
for (const [id, c] of todo.slice(0, budget)) {
  let cc = await reverseCountry(c.lat, c.lon);
  await sleep(1200);
  if (cc === 'gb') { const part = await reverseGbPart(c.lat, c.lon); await sleep(1200); if (part) cc = part; }
  done++;
  if (cc) cache[id] = cc; else fail++;
}
if (done) await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
console.log(`[bk-venue-country] todo=${todo.length} done=${done} fail=${fail}`);

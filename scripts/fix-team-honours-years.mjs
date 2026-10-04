// 1회성: 우승 이력이 연도 없는 문자열로만 저장된 팀을 영문 위키 Honours 절에서 다시 읽어 [대회, 횟수, 연도]로 교체.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIKI_UA } from './venue-photo-wiki.mjs';
import { parseWinnerLists } from './team-honours-parse.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'team-info');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params) {
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`, { headers: { 'User-Agent': WIKI_UA }, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : undefined;
  } catch { return undefined; }
}
let fixed = 0, tried = 0;
for (let i = 0; i < 16; i++) {
  const f = path.join(DIR, `${i.toString(16)}.json`);
  const j = JSON.parse(await fs.readFile(f, 'utf8'));
  let ch = false;
  for (const [k, v] of Object.entries(j)) {
    if (!v?.wiki || !Array.isArray(v.honours) || !v.honours.length) continue;
    if (!v.honours.every((h) => typeof h === 'string' || (Array.isArray(h) && h.length === 2))) continue;
    tried++;
    const sec = await api({ action: 'parse', page: v.wiki, prop: 'sections' }); await sleep(250);
    const hs = (sec?.parse?.sections || []).find((s) => Number(s.toclevel) <= 2 && /honou?rs|trophies|achievements|palmar[eè]s|championships|titles/i.test(s.line));
    if (!hs) continue;
    const p = await api({ action: 'parse', page: v.wiki, section: hs.index, prop: 'text' }); await sleep(250);
    const rows = parseWinnerLists(p?.parse?.text?.['*'] || '');
    if (rows.length) { v.honours = rows.slice(0, 14); fixed++; ch = true; console.log('fixed', k, JSON.stringify(rows[0])); }
  }
  if (ch) await fs.writeFile(f, JSON.stringify(j) + '\n', 'utf8');
}
console.log(`tried=${tried} fixed=${fixed}`);

// 팀 소개 우승 이력 대회별 트로피 사진(Commons) 백필 — trophy-photos.json: 대회명(영문) -> 파일URL | null(시도했으나 없음)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'trophy-photos.json');
const UA = 'ShadeSide/1.0 (janetyoon85@gmail.com)';
const BUDGET = Number(process.env.TROPHY_BUDGET || 80);
const MIN_TEAMS = Number(process.env.TROPHY_MIN_TEAMS || 2);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['the', 'de', 'of', 'del', 'la', 'el', 'and', 'des', 'du']);
const BAD = /logo|flag|map|stadium|estadio|match|\bvs\b|celebrat|player|squad|crest|badge|banner|stamp|medal|poster|ticket|\bfans?\b|\bgoal\b|lineup|team photo|icon|silueta|silhouette|vice|museum|exposed|expuestos/i;
const GENERIC = /^(primera|segunda|tercera)( division| división)?( [a-c])?$|^serie [a-d]$|^liga$|^league( cup)?$|^super ?cup$|^cup$|^torneo (apertura|clausura)$|^copa$|^liga [12]$|^ligue [12]$|^supercopa$|^premier league$|^first division$|^second division$|^national league$|^league championships?$|^champions$|^liga nacional$|^(apertura|clausura)$/i;
const GOOD = /trophy|cup|trofeo|coupe|copa|pokal|shield|troph[ée]e|taça|bowl|trophäe|coppa|beker/i;

async function loadNames() {
  const cnt = {};
  for (let i = 0; i < 16; i++) {
    let j; try { j = JSON.parse(await fs.readFile(path.join(ROOT, 'team-info', `${i.toString(16)}.json`), 'utf8')); } catch { continue; }
    for (const v of Object.values(j)) for (const h of v?.honours || []) {
      const n = typeof h === 'string' ? h.replace(/\s*[×x]\s*\d+.*$/, '') : h[0];
      if (n) cnt[n] = (cnt[n] || 0) + 1;
    }
  }
  return Object.entries(cnt)
    .filter(([n, c]) => c >= MIN_TEAMS && n.length > 3 && !/^(—|Championships|Conference|Division)|Appearances|Conference|regular season|Playoff|:$/i.test(n))
    .sort((a, b) => b[1] - a[1]).map(([n]) => n);
}
async function find(name) {
  if (GENERIC.test(name.trim())) return null;
  const toks = norm(name).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
  if (!toks.length) return null;
  const u = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=10&format=json&srsearch=${encodeURIComponent(`"${name}" trophy`)}`;
  const res = await fetch(u, { headers: { 'User-Agent': UA } });
  if (res.status === 429) throw new Error('429');
  const r = await res.json();
  const cands = (r.query?.search || []).map((x) => x.title.replace(/^File:/, '')).filter((t) => /\.(jpe?g|png|webp)$/i.test(t) && !BAD.test(t));
  const ok = cands.filter((t) => { const nt = norm(t); return toks.every((k) => nt.includes(k)); });
  const pick = ok.find((t) => GOOD.test(t)) || null;
  return pick ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(pick.replace(/ /g, '_'))}?width=200` : null;
}
let cache = {}; try { cache = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}
const todo = (await loadNames()).filter((n) => !(n in cache)).slice(0, BUDGET);
console.log(`[trophy] todo=${todo.length} cached=${Object.keys(cache).length}`);
let found = 0;
for (const n of todo) {
  try { const url = await find(n); cache[n] = url; if (url) found++; } catch (e) { console.log('[trophy] stop', e.message); break; }
  await new Promise((r) => setTimeout(r, 3000));
  if (Object.keys(cache).length % 10 === 0) await fs.writeFile(OUT, JSON.stringify(cache, null, 1) + '\n');
}
await fs.writeFile(OUT, JSON.stringify(cache, null, 1) + '\n');
console.log(`[trophy] found=${found} total=${Object.keys(cache).length}`);

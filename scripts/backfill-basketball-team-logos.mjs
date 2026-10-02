// 로고 없는 농구팀(ESPN 유로리그 등)을 위키데이터 P154(로고) → Commons 썸네일로 채움. 일회성/수동 실행 가능.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const f = path.join(root, 'basketball', 'teams.json');
const teams = JSON.parse(fs.readFileSync(f, 'utf8'));
const UA = { 'User-Agent': 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => (await fetch(u, { headers: UA })).json();
const LGS = new Set(['EUROLEAGUE']);
let n = 0;
for (const [k, t] of Object.entries(teams)) {
  if (t.logo || !LGS.has(t.lg) || !t.en) continue;
  try {
    const cands = [];
    for (const q of [t.en, t.en + ' basketball', t.en.split(' ').slice(0, 2).join(' ') + ' basketball']) {
      cands.push(...((await J('https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=7&search=' + encodeURIComponent(q))).search || []));
      await sleep(300);
    }
    for (const c of cands) {
      if (!/basketball/i.test(c.description || '')) continue;
      const e = await J('https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=' + c.id);
      const pick = (cl) => ['P154', 'P8972'].map((p) => cl?.[p]?.[0]?.mainsnak?.datavalue?.value).find(Boolean);
      let file = pick(e.claims);
      for (const rel of ['P361', 'P749', 'P1830']) {
        if (file) break;
        const pid = e.claims?.[rel]?.[0]?.mainsnak?.datavalue?.value?.id;
        if (pid) { file = pick((await J('https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=' + pid)).claims); await sleep(300); }
      }
      if (file) { t.logo = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file.replace(/ /g, '_')) + '?width=200'; n++; console.log(t.en, '->', c.id, file); break; }
    }
  } catch (e) { console.log('ERR', t.en, e.message); }
  await sleep(500);
}
fs.writeFileSync(f, JSON.stringify(teams));
console.log('logos', n);

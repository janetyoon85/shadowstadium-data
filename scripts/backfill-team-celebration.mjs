// 팀별 "우승 세리머니/컵 든 선수들" Commons 사진 → team-celebration.json (teamKey → url[])
import fs from 'fs';
const UA = { 'User-Agent': 'ShadeSideBot/1.0 (https://github.com/janetyoon85/shadowstadium-data)' };
const OUT = 'team-celebration.json';
const PASS2 = process.env.CEL_PASS === '2';
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const BUDGET = Number(process.env.CEL_BUDGET || 1300);
const GOOD = PASS2 ? /celebrat|lift|champion|winner|parade|squad|team|players|with[_ ]|holding|raising|podium|ceremony|trophy|cup|title|victory|final|promotion|promoted|win/i : /celebrat|lift|champion|winner|parade|squad|team|with[_ ]|holding|raising|podium|ceremony|trophy|cup|title|victory|final/i;
const QUERIES = PASS2 ? ['champions parade', 'players trophy', 'team squad'] : ['celebrate OR celebrating OR lifting OR champions OR winners OR trophy'];
const BAD = /logo|crest|badge|flag|map|kit|shirt|jersey|ticket|stamp|poster|coat|emblem|stadium|stadion|arena|museum|statue|icon|silhouette|\.svg|vs[_ .]|_v_|match|protest|ultras|banner|graffiti|bus|train|plane|cheerlead/i;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['fc', 'f.c.', 'cf', 'sc', 'afc', 'ac', 'as', 'club', 'de', 'the', 'football', 'baseball', 'basketball', 'team', 'bc', 'b.c.', 'calcio', 'real', 'sk', 'fk', 'cd', 'ca', 'cs', 'sv', 'ssc', 'us', 'ud', 'sd', 'rc', 'og', 'ogc']);
const keys = [];
for (const f of fs.readdirSync('team-info')) {
  if (!/^[0-9a-f]+\.json$/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync('team-info/' + f, 'utf8'));
  for (const [k, v] of Object.entries(j)) if (v && v.wiki && v.honours?.length && (PASS2 ? out[k] === null : !(k in out))) keys.push([k, v.wiki]);
}
console.log('[cel] todo=' + keys.length);
let done = 0, found = 0;
for (const [k, wiki] of keys.slice(0, BUDGET)) {
  const base = wiki.replace(/\s*\(.*\)$/, '');
  const toks = norm(base).split(/[\s.-]+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (!toks.length) { out[k] = null; continue; }
  try {
    const pics = [];
    for (const q of QUERIES) {
    if (pics.length >= 4) break;
    const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${base} ${q}`, gsrnamespace: '6', gsrlimit: '25', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800' });
    const r = await (await fetch(u, { headers: UA })).json();
    await new Promise((s2) => setTimeout(s2, 3000));
    for (const p of Object.values(r.query?.pages || {})) {
      const t = (p.title || '').replace(/^File:/, '');
      const ii = p.imageinfo?.[0];
      if (!ii || !/^image\/jpeg$/.test(ii.mime || '')) continue;
      if (BAD.test(t) || !GOOD.test(t)) continue;
      const nt = norm(t);
      if (!toks.every((x) => nt.includes(x))) continue;
      const pu = ii.thumburl || ii.url; if (!pics.includes(pu)) pics.push(pu);
    }
    }
    out[k] = pics.length ? pics.slice(0, 4) : null;
    if (pics.length) found++;
  } catch (e) { console.log('[cel] err', k, e.message); }
  done++;
  if (done % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(out)); console.log(`[cel] ${done} found=${found}`); }
  await new Promise((s) => setTimeout(s, 3000));
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`[cel] done=${done} found=${found}`);

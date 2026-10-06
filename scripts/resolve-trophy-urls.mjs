import fs from 'fs';
const f = 'trophy-photos.json';
const c = JSON.parse(fs.readFileSync(f, 'utf8'));
const pre = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const todo = Object.entries(c).filter(([, v]) => v && v.startsWith(pre));
for (let i = 0; i < todo.length; i += 40) {
  const chunk = todo.slice(i, i + 40);
  const titles = chunk.map(([, v]) => 'File:' + decodeURIComponent(v.slice(pre.length).split('?')[0]).replace(/_/g, ' '));
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', titles: titles.join('|'), prop: 'imageinfo', iiprop: 'url', iiurlwidth: '200' });
  const r = await (await fetch(u, { headers: { 'User-Agent': 'ShadeSideBot/1.0 (janetyoon85@gmail.com)' } })).json();
  const by = {};
  for (const p of Object.values(r.query?.pages || {})) by[p.title] = p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url;
  const norm = {}; for (const t of r.query?.normalized || []) norm[t.from] = t.to;
  chunk.forEach(([k], j) => { const t = titles[j]; c[k] = by[norm[t] || t] || null; });
  await new Promise((s) => setTimeout(s, 3000));
}
fs.writeFileSync(f, JSON.stringify(c));
console.log(Object.values(c).filter(Boolean).length, Object.values(c).filter((v) => v && v.startsWith(pre)).length);

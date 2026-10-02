// 330px 썸네일(앱에서 흐리게 보임) → 960px로 교체. 960px URL이 실제 200일 때만 교체.
import fs from 'node:fs/promises';
const f = new URL('../venue-photos.json', import.meta.url);
const p = JSON.parse(await fs.readFile(f, 'utf8'));
let up = 0, fail = 0;
for (const [k, arr] of Object.entries(p)) {
  if (!Array.isArray(arr)) continue;
  for (let i = 0; i < arr.length; i++) {
    const u = arr[i];
    if (typeof u !== 'string' || !/\/330px-/.test(u)) continue;
    const n = u.replace('/330px-', '/960px-');
    let ok = false;
    for (let t = 0; t < 2 && !ok; t++) {
      try { const r = await fetch(n, { method: 'HEAD', headers: { 'User-Agent': 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)' }, signal: AbortSignal.timeout(15000) }); if (r.status === 429) { await new Promise((x) => setTimeout(x, 5000)); continue; } ok = r.ok; break; } catch { break; }
    }
    if (ok) { arr[i] = n; up++; } else fail++;
    await new Promise((x) => setTimeout(x, 250));
  }
}
await fs.writeFile(f, JSON.stringify(p));
console.log('upgraded', up, 'kept', fail);

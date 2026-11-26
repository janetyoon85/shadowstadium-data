// 일회성 조사(2026-11-26): 네이버 야구 relay 에 투구별 좌표·구속·궤적 등 "실제 측정값"이 있는지 필드 단위로 확인한다.
// 결과는 probe/out/*.json (필드 경로·형식·채워진 비율·예시)로 저장한다. 값 자체를 퍼 가지 않고 구조만 요약한다.
import fs from 'node:fs';
import path from 'node:path';
const OUT = 'probe/out';
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (compatible; shadowstadium-probe/1.0)';
const get = async (url) => {
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://m.sports.naver.com/' }, signal: AbortSignal.timeout(25000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, bytes: t.length }; }
  catch (e) { return { status: 0, err: String(e?.message || e).slice(0, 120) }; }
};
// 구조 요약: 키 경로 → { n: 등장 횟수, types, ex: 예시 }
function shape(obj, maxPaths = 400) {
  const m = new Map();
  const walk = (v, p, depth) => {
    if (m.size > maxPaths || depth > 7) return;
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    const e = m.get(p) || { n: 0, types: new Set(), ex: undefined };
    e.n++; e.types.add(t); if (e.ex === undefined && t !== 'object' && t !== 'array') e.ex = typeof v === 'string' ? v.slice(0, 40) : v;
    m.set(p, e);
    if (Array.isArray(v)) { for (const x of v.slice(0, 400)) walk(x, p + '[]', depth + 1); }
    else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, p + '.' + k, depth + 1); }
  };
  walk(obj, '$', 0);
  return Object.fromEntries([...m].map(([k, e]) => [k, { n: e.n, t: [...e.types].join('|'), ex: e.ex }]));
}
const g = JSON.parse(fs.readFileSync('games.json', 'utf8')); const gs = Array.isArray(g) ? g : g.games;
const latest = (lg, n) => gs.filter((x) => x.league === lg && x.status === 'completed').sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, n).map((x) => x.gameId);
const targets = [...latest('KBO', 2), ...latest('NPB', 1), '77771108KTSS02026'];
const summary = [];
for (const id of [...new Set(targets)]) {
  const row = { id };
  for (const ep of ['relay', 'record', 'preview']) {
    const r = await get(`https://api-gw.sports.naver.com/schedule/games/${id}/${ep}`);
    row[ep] = { status: r.status, bytes: r.bytes, err: r.err };
    if (r.json) fs.writeFileSync(path.join(OUT, `${id}-${ep}-shape.json`), JSON.stringify(shape(r.json), null, 1));
    if (ep === 'relay' && r.json) {
      // 이닝별 relay 도 있는지(textRelayData 가 이닝 단위인 경우) — 마지막 이닝 하나만 더 본다
      const rd = r.json.result?.textRelayData || r.json.textRelayData || {};
      row.relayInfo = { keys: Object.keys(rd), textRelays: (rd.textRelays || []).length, inningTotal: rd.inningScore ? Object.keys(rd.inningScore).length : null };
      const first = (rd.textRelays || [])[0];
      if (first) fs.writeFileSync(path.join(OUT, `${id}-relay-first.json`), JSON.stringify(first, null, 1).slice(0, 6000));
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  summary.push(row);
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), summary }, null, 1));
console.log(JSON.stringify(summary).slice(0, 1500));

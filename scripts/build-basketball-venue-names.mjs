// B.League 등 약칭 경기장명 → 홈팀 Wikidata P115(홈구장)으로 영문 정식명 추정, 약칭이 일본어 라벨/별칭과 부분일치할 때만 채택(오매칭 방지).
// 결과는 basketball/venue-name-en.json 에 추가(기존 사진/구장정보 백필 파이프라인이 그대로 사용).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'basketball');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const rj = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const gj = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : undefined; } catch { return undefined; } };
const venues = await rj(path.join(DIR, 'venues.json'), {});
const teams = await rj(path.join(DIR, 'teams.json'), {});
const out = await rj(path.join(DIR, 'venue-name-en.json'), {});
const enMap = await rj(path.join(DIR, 'team-name-en.json'), {}); const ti = await rj(path.join(DIR, 'team-i18n.json'), {});
const norm = (s) => s.replace(/[0-9０-９\s]/g, '').toLowerCase();
const teamQ = {};
async function homeVenues(tk) {
  const tm = teams[tk]; if (!tm) return [];
  const name = tm.en || ti[tk]?.en || enMap['bk:' + tk]; if (!name) return [];
  if (!(tk in teamQ)) {
    const s = await gj(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=5&format=json`);
    const cand = (s?.search || []).map((x) => x.id);
    let found = null;
    if (cand.length) {
      const e = await gj(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${cand.join('|')}&props=claims&format=json`);
      for (const id of cand) { const c = e?.entities?.[id]?.claims; if (c?.P641?.some((x) => x.mainsnak?.datavalue?.value?.id === 'Q5372') && c?.P115) { found = c.P115.map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean); break; } }
    }
    teamQ[tk] = found;
  }
  return teamQ[tk] || [];
}
const vq = {};
async function venueLabels(q) {
  if (!vq[q]) {
    const e = await gj(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=labels|aliases&languages=en|ja&format=json`);
    const en = e?.entities?.[q];
    vq[q] = { en: en?.labels?.en?.value, ja: [en?.labels?.ja?.value, ...(en?.aliases?.ja || []).map((a) => a.value)].filter(Boolean) };
  }
  return vq[q];
}
let added = 0;
for (const [id, v] of Object.entries(venues)) {
  if (out[id] || !v.teams?.length || !/[ぁ-ヶ一-龥]/.test(v.name || '')) continue;
  const short = norm(v.name);
  if (short.length < 2) continue;
  let hit = null;
  for (const tk of v.teams) {
    for (const q of await homeVenues(tk)) {
      const l = await venueLabels(q);
      if (l.en && l.ja.some((j) => norm(j).includes(short) || short.includes(norm(j)))) { hit = l.en; break; }
    }
    if (hit) break;
  }
  if (hit) { out[id] = { name: hit, ...(v.city ? {} : {}) }; added++; console.log(v.name, '->', hit); }
}
await fs.writeFile(path.join(DIR, 'venue-name-en.json'), JSON.stringify(out, null, 1));
console.log('added', added);

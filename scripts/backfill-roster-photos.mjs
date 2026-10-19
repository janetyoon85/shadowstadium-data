// ESPN 축구 선수단(team-rosters)에 사진(ph)이 없는 선수를 TheSportsDB 이름 검색으로 채운다.
// 차단 방지가 최우선: 요청 간격 2.5s(무료 키 분당 30건 한도의 80%), 한 번 실행당 예산(ROSTER_PHOTO_BUDGET), 429·연속 실패 시 즉시 중단.
// 이름이 정확히 같고 종목이 Soccer 인 후보가 딱 하나일 때만 채택(동명이인 오매칭보다 빈 칸이 낫다). 시도한 선수는 90일간 재시도 안 함.
//
// 결과 저장: roster-photos.json(id→사진 URL, 이 작업의 정본) + roster-photos-tried.json + team-rosters 샤드(앱이 읽는 곳, 정본에서 매번 재적용).
// 푸시 충돌 복구(2026-10-12 — 30분·700건 결과가 마지막 충돌로 통째로 버려졌음): 충돌 시 워크플로우가 origin 으로 리셋한 뒤
// ROSTER_PHOTO_MERGE_DIR 에 보관해 둔 이번 실행의 정본 두 파일을 합치고(사진=합집합, 시도=최신값) 샤드에 재적용한다. 이 모드는 네트워크 호출이 없다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIR = path.join(REPO_ROOT, 'team-rosters');
const TRIED = path.join(REPO_ROOT, 'roster-photos-tried.json');
const PHOTOS = path.join(REPO_ROOT, 'roster-photos.json');
const MERGE_DIR = process.env.ROSTER_PHOTO_MERGE_DIR || '';
const BUDGET = MERGE_DIR ? 0 : Number(process.env.ROSTER_PHOTO_BUDGET || 700);
const DELAY_MS = Number(process.env.ROSTER_PHOTO_DELAY_MS || 2500);
const RETRY_AFTER_MS = 90 * 86400000;
const UA = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const readJson = async (f, dflt) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return dflt; } };

export function mergeMaps(base, ours) {
  const out = { ...base };
  for (const [k, v] of Object.entries(ours || {})) if (out[k] === undefined) out[k] = v;
  return out;
}
export function mergeTried(base, ours) {
  const out = { ...base };
  for (const [k, v] of Object.entries(ours || {})) out[k] = Math.max(out[k] || 0, v || 0);
  return out;
}

async function main() {
  const shards = [];
  for (let i = 0; i < 16; i++) {
    const f = path.join(DIR, `${i.toString(16)}.json`);
    shards.push({ f, data: await readJson(f, {}) });
  }
  let tried = await readJson(TRIED, {});
  let photos = await readJson(PHOTOS, {});
  const byId = new Map();
  for (const sh of shards) for (const list of Object.values(sh.data)) for (const p of list) byId.set(p.id, p);

  if (MERGE_DIR) {
    photos = mergeMaps(photos, await readJson(path.join(MERGE_DIR, 'roster-photos.json'), {}));
    tried = mergeTried(tried, await readJson(path.join(MERGE_DIR, 'roster-photos-tried.json'), {}));
    console.log(`[photos] merge mode photos=${Object.keys(photos).length} tried=${Object.keys(tried).length}`);
  }
  // 샤드에 이미 있는 사진도 정본에 올려 두고(처음 한 번), 정본의 사진은 샤드에 재적용(멱등).
  for (const p of byId.values()) if (p.ph && String(p.id).startsWith('espn:') && photos[p.id] === undefined) photos[p.id] = p.ph;
  const apply = () => { let n = 0; for (const [id, url] of Object.entries(photos)) { const p = byId.get(id); if (p && !p.ph) { p.ph = url; n++; } } return n; };
  console.log(`[photos] applied=${apply()}`);

  const now = Date.now();
  const cands = [];
  if (BUDGET > 0) {
    for (const sh of shards) for (const list of Object.values(sh.data)) {
      const todo = list.filter((p) => String(p.id).startsWith('espn:') && !p.ph && !(tried[p.id] && now - tried[p.id] < RETRY_AFTER_MS));
      todo.sort((a, b) => (a.no ? 0 : 1) - (b.no ? 0 : 1));
      cands.push(...todo);
    }
  }
  console.log(`[photos] candidates=${cands.length} budget=${BUDGET}`);
  let done = 0, found = 0, fails = 0, stop = '';
  for (const c of cands) {
    if (done >= BUDGET) break;
    let res;
    try {
      res = await fetch('https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=' + encodeURIComponent(c.n), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    } catch { fails++; if (fails >= 5) { stop = '연속 네트워크 실패'; break; } await sleep(DELAY_MS * 2); continue; }
    if (res.status === 429 || res.status === 403) { stop = `HTTP ${res.status} — 차단 방지를 위해 즉시 중단`; break; }
    if (!res.ok) { fails++; if (fails >= 5) { stop = `연속 HTTP ${res.status}`; break; } await sleep(DELAY_MS * 2); continue; }
    fails = 0;
    done++;
    tried[c.id] = now;
    let j; try { j = await res.json(); } catch { j = null; }
    const nn = norm(c.n);
    const hits = (j?.player || []).filter((x) => x.strSport === 'Soccer' && norm(x.strPlayer) === nn);
    const url = hits.length === 1 ? (hits[0].strCutout || hits[0].strThumb) : '';
    if (url && /^https:\/\//.test(url)) { const u = url.replace(/\/small$/, '') + '/small'; photos[c.id] = u; c.ph = u; found++; }
    if (done % 50 === 0) { await save(shards, tried, photos); console.log(`[photos] ${done}/${BUDGET} found=${found}`); }
    await sleep(DELAY_MS);
  }
  await save(shards, tried, photos);
  console.log(`[photos] done=${done} found=${found}${stop ? ' STOP: ' + stop : ''}`);
}
async function save(shards, tried, photos) {
  for (const sh of shards) await fs.writeFile(sh.f, JSON.stringify(sh.data) + '\n', 'utf8');
  await fs.writeFile(TRIED, JSON.stringify(tried) + '\n', 'utf8');
  await fs.writeFile(PHOTOS, JSON.stringify(photos) + '\n', 'utf8');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

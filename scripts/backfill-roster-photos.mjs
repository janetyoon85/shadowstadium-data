// ESPN 축구 선수단(team-rosters)에 사진(ph)이 없는 선수를 TheSportsDB 이름 검색으로 채운다.
// 차단 방지가 최우선: 요청 간격 2.5s(무료 키 분당 30건 한도의 80%), 한 번 실행당 예산(ROSTER_PHOTO_BUDGET), 429·연속 실패 시 즉시 중단.
// 이름이 정확히 같고 종목이 Soccer 인 후보가 딱 하나일 때만 채택(동명이인 오매칭보다 빈 칸이 낫다). 시도한 선수는 90일간 재시도 안 함.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIR = path.join(REPO_ROOT, 'team-rosters');
const TRIED = path.join(REPO_ROOT, 'roster-photos-tried.json');
const BUDGET = Number(process.env.ROSTER_PHOTO_BUDGET || 700);
const DELAY_MS = Number(process.env.ROSTER_PHOTO_DELAY_MS || 2500);
const RETRY_AFTER_MS = 90 * 86400000;
const UA = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  const shards = [];
  for (let i = 0; i < 16; i++) {
    const f = path.join(DIR, `${i.toString(16)}.json`);
    try { shards.push({ f, data: JSON.parse(await fs.readFile(f, 'utf8')) }); } catch { shards.push({ f, data: {} }); }
  }
  let tried = {};
  try { tried = JSON.parse(await fs.readFile(TRIED, 'utf8')); } catch { /* 첫 실행 */ }
  const now = Date.now();
  // 후보: 사진 없는 ESPN 축구 선수. 팀 순서(=리그 수집 순서)대로, 팀 안에서는 등번호 있는 주전급 먼저.
  const cands = [];
  for (const sh of shards) for (const list of Object.values(sh.data)) {
    const todo = list.filter((p) => String(p.id).startsWith('espn:') && !p.ph && !(tried[p.id] && now - tried[p.id] < RETRY_AFTER_MS));
    todo.sort((a, b) => (a.no ? 0 : 1) - (b.no ? 0 : 1));
    cands.push(...todo);
  }
  console.log(`[photos] candidates=${cands.length} budget=${BUDGET}`);
  let done = 0, found = 0, fails = 0, stop = '';
  const byId = new Map();
  for (const sh of shards) for (const list of Object.values(sh.data)) for (const p of list) byId.set(p.id, p);
  for (const c of cands) {
    if (done >= BUDGET) break;
    let res;
    try {
      res = await fetch('https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=' + encodeURIComponent(c.n), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
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
    if (url && /^https:\/\//.test(url)) { byId.get(c.id).ph = url.replace(/\/small$/, '') + '/small'; found++; }
    if (done % 50 === 0) { await save(shards, tried); console.log(`[photos] ${done}/${BUDGET} found=${found}`); }
    await sleep(DELAY_MS);
  }
  await save(shards, tried);
  console.log(`[photos] done=${done} found=${found}${stop ? ' STOP: ' + stop : ''}`);
}
async function save(shards, tried) {
  for (const sh of shards) await fs.writeFile(sh.f, JSON.stringify(sh.data) + '\n', 'utf8');
  await fs.writeFile(TRIED, JSON.stringify(tried) + '\n', 'utf8');
}
main().catch((e) => { console.error(e); process.exit(1); });

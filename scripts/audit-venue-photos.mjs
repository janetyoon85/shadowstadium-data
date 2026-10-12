// 구장 사진이 "그 구장" 사진인지 천천히 재검증한다(2026-10-12 사가 아레나에 SAGA Stadium 사진이 붙은 사고 이후).
// 사진 파일의 위키미디어 커먼즈 분류·설명·사용처(그 파일을 쓰는 위키 문서 제목)를 구장 이름과 대조한다.
// 차단 방지가 최우선: 직렬 요청 + 요청 간격 3s + 명확한 User-Agent(연락처 포함) + 실행당 요청 상한 +
// 429/5xx/네트워크 오류가 한 번이라도 나오면 즉시 중단(다음 실행에서 이어감, 재시도 폭주 없음).
// 판정: wrong(확실히 다른 곳 — 자동으로 "사진 없음" 처리) / suspect(이름이 전혀 안 겹침 — 운영 알림으로 사람이 확인) / ok.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { venueTitleKindConflict } from './venue-photo-wiki.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const AUDIT_PATH = path.join(REPO_ROOT, 'venue-photo-audit.json');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data; janetyoon85@gmail.com)';
const DELAY_MS = Number(process.env.VENUE_AUDIT_DELAY_MS || 3000);
const MAX_REQUESTS = Number(process.env.VENUE_AUDIT_MAX_REQUESTS || 20); // 실행당 API 요청 상한(요청 1회 = 구장 15곳)
const BATCH = 15;
const RECHECK_MS = 120 * 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
const GENERIC = new Set('stadium stadion stade estadio arena field park center centre ballpark dome sports sport municipal national city memorial complex the de del la los las von der van das and for football soccer baseball club fc cf stad gymnasium hall'.split(' '));
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function commonsFileTitle(url) {
  let m = /Special:FilePath\/([^?]+)/.exec(url); if (m) return dec(m[1]).replace(/_/g, ' ');
  m = /\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//.exec(url); if (m) return dec(m[1]).replace(/_/g, ' ');
  m = /\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/.exec(url); if (m) return dec(m[1]).replace(/_/g, ' ');
  return null;
}

const distinctive = (name, city) => strip(`${name} ${city || ''}`).split(/\s+/).filter((t) => t.length >= 4 && !GENERIC.has(t));

// 순수 판정 함수(테스트 대상). evidence = 파일 제목·분류 이름들·설명·사용처 문서 제목들.
export function judgeVenuePhoto({ name, city, file, cats = [], desc = '', usage = [], indoorSport = false }) {
  if (/\.svg$|\bmap\b|locator|location map|\blogo\b|\bflag\b/i.test(file || '')) return { verdict: 'wrong', reason: 'not-a-photo' };
  const strings = [file, ...cats.map((c) => c.replace(/^Category:/, '')), ...usage].filter(Boolean);
  const toks = distinctive(name, city);
  const shares = (s) => toks.length === 0 || toks.some((t) => strip(s).includes(t));
  const related = strings.filter(shares);
  // 같은 이름 단서를 공유하는 문서·분류 중에 구장 유형(실내 Arena ↔ 실외 Stadium)이 반대인 것만 있고 같은 유형은 없으면 다른 시설이다(SAGA Arena ↔ SAGA Stadium).
  const conflicting = related.filter((s) => venueTitleKindConflict(name, s));
  const compatible = related.filter((s) => !venueTitleKindConflict(name, s));
  // 농구 구장(실내)만 확정 오류로 본다. 축구·야구는 'Arena'라는 이름의 야외 경기장이 흔해(Tarczynski Arena=Stadion Wroclaw 등) 같은 건물이어도 제목에 Stadium 이 나오므로 의심으로만 남긴다.
  if (conflicting.length > 0 && compatible.length === 0) return indoorSport ? { verdict: 'wrong', reason: `kind-conflict:${conflicting[0]}` } : { verdict: 'suspect', reason: `kind-conflict:${conflicting[0]}` };
  if (related.length === 0) {
    const d = strip(desc);
    if (toks.some((t) => d.includes(t))) return { verdict: 'ok', reason: 'desc' };
    return { verdict: 'suspect', reason: 'no-name-overlap' };
  }
  return { verdict: 'ok', reason: 'name-overlap' };
}

async function main() {
  const vp = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'venue-photos.json'), 'utf8'));
  const names = { ...JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'venue-name-en.json'), 'utf8')), ...JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'venue-name-en.json'), 'utf8')) };
  let audit = {};
  try { audit = JSON.parse(await fs.readFile(AUDIT_PATH, 'utf8')); } catch { /* 첫 실행 */ }
  const now = Date.now();
  const todo = [];
  for (const [id, urls] of Object.entries(vp)) {
    const u = Array.isArray(urls) ? urls[0] : urls;
    if (!u || !names[id]?.name) continue;
    const file = commonsFileTitle(u);
    if (!file) continue;
    const prev = audit[id];
    if (prev && prev.file === file && now - prev.at < RECHECK_MS) continue; // 같은 사진을 최근에 검증함
    todo.push({ id, file, name: names[id].name, city: names[id].city || '' });
  }
  todo.sort((a, b) => (a.id.startsWith('bk_') === b.id.startsWith('bk_') ? 0 : a.id.startsWith('bk_') ? -1 : 1)); // 농구장 먼저
  console.log(`[venue-audit] todo=${todo.length} maxRequests=${MAX_REQUESTS}`);

  let requests = 0, checked = 0, stop = '';
  const wrong = [];
  for (let i = 0; i < todo.length && requests < MAX_REQUESTS; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', maxlag: '5',
      prop: 'categories|imageinfo|globalusage', cllimit: 'max', gulimit: 'max', iiprop: 'extmetadata', iiextmetadatafilter: 'ImageDescription',
      titles: chunk.map((c) => 'File:' + c.file).join('|'),
    });
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }); } catch { stop = '네트워크 오류 — 즉시 중단'; break; }
    requests++;
    if (!res.ok) { stop = `HTTP ${res.status}${res.headers.get('retry-after') ? ` (retry-after ${res.headers.get('retry-after')}s)` : ''} — 즉시 중단`; break; }
    let j; try { j = await res.json(); } catch { stop = '응답이 JSON 이 아님(제한 응답 의심) — 즉시 중단'; break; }
    if (j.error) { stop = `API error ${j.error.code} — 즉시 중단`; break; }
    const norm = new Map((j.query?.normalized || []).map((n) => [n.to, n.from]));
    const byTitle = new Map();
    for (const p of j.query?.pages || []) byTitle.set(p.title.replace(/^File:/, ''), p);
    for (const c of chunk) {
      const p = byTitle.get(c.file) || byTitle.get([...norm.entries()].find(([, from]) => from === 'File:' + c.file)?.[0]?.replace(/^File:/, '') || '');
      if (!p || p.missing) { audit[c.id] = { file: c.file, at: now, verdict: 'unknown', reason: 'file-not-found' }; continue; }
      const cats = (p.categories || []).map((x) => x.title);
      const usage = (p.globalusage || []).map((x) => x.title);
      const desc = (p.imageinfo?.[0]?.extmetadata?.ImageDescription?.value || '').replace(/<[^>]+>/g, ' ');
      const r = judgeVenuePhoto({ name: c.name, city: c.city, file: c.file, cats, desc, usage, indoorSport: c.id.startsWith('bk_') });
      audit[c.id] = { file: c.file, at: now, verdict: r.verdict, reason: r.reason };
      checked++;
      if (r.verdict === 'wrong') wrong.push(c.id);
    }
    await sleep(DELAY_MS);
  }
  await fs.writeFile(AUDIT_PATH, JSON.stringify(audit, null, 1) + '\n', 'utf8');

  // 확실히 틀린 것만 자동으로 "사진 없음"(null) 처리 + 자동 재검색 차단(commons-tried).
  if (wrong.length > 0) {
    const tried = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'venue-photos-commons-tried.json'), 'utf8').catch(() => '{}'));
    for (const id of wrong) { vp[id] = null; tried[id] = true; }
    await fs.writeFile(path.join(REPO_ROOT, 'venue-photos.json'), JSON.stringify(vp, null, 2) + '\n', 'utf8');
    await fs.writeFile(path.join(REPO_ROOT, 'venue-photos-commons-tried.json'), JSON.stringify(tried, null, 2) + '\n', 'utf8');
    console.log(`[venue-audit] wrong → 사진 없음 처리: ${wrong.join(', ')}`);
  }
  console.log(`[venue-audit] requests=${requests} checked=${checked}${stop ? ' STOP: ' + stop : ''}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

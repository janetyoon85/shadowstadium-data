// 일회성 재검증(2026-09-30, "에너자이저 파크에 엉뚱한 사진" 리포트로 isPlausibleStadiumDescription
// 강화 — park/field/venue 등은 스포츠 맥락 단어와 같이 있어야 인정하도록 변경) 적용 이전에 이미
// 캐시된 위키 소스 사진들 중 새 기준으로는 탈락할 항목을 찾아서 지움(재조회 대상으로 되돌림).
// venue-photos.json엔 어느 문서에서 왔는지 저장 안 해서, venue-name-en.json의 원래 검색어로
// 다시 검색+요약 조회해 현재 설명을 새 기준으로 재검증. 지우기만 하고 재조회는 안 함(그건
// 기존 backfill-venue-photos.mjs가 다음 실행에서 자연히 처리).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlausibleStadiumDescription, WIKI_UA, WIKI_REQUEST_DELAY_MS } from './venue-photo-wiki.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cache = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'venue-photos.json'), 'utf-8'));
  const venueNameEn = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'venue-name-en.json'), 'utf-8'));

  const targets = Object.keys(cache).filter((k) => {
    const v = cache[k];
    return Array.isArray(v) && v.length === 1 && (v[0].includes('wikimedia.org') || v[0].includes('wikipedia.org')) && venueNameEn[k]?.name;
  });
  console.log(`[audit] 재검증 대상 ${targets.length}건`);

  let checked = 0;
  let cleared = 0;
  let failed = 0;
  for (const id of targets) {
    const name = venueNameEn[id].name;
    try {
      const sres = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`, { headers: { 'User-Agent': WIKI_UA } });
      if (!sres.ok) { failed++; continue; }
      const sj = await sres.json();
      const title = sj.query?.search?.[0]?.title;
      if (!title) { failed++; continue; }
      await sleep(WIKI_REQUEST_DELAY_MS);
      const pres = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: { 'User-Agent': WIKI_UA } });
      if (!pres.ok) { failed++; continue; }
      const pj = await pres.json();
      checked++;
      if (!isPlausibleStadiumDescription(pj.description)) {
        console.log(`[audit] CLEAR ${id} (${name}) -> "${title}": "${pj.description}"`);
        delete cache[id];
        cleared++;
      }
    } catch (e) {
      failed++;
      console.warn(`[audit] error ${id}: ${e.message}`);
    }
    await sleep(WIKI_REQUEST_DELAY_MS);
    // 오래 걸리는 일회성 스크립트라(600여건, 20분+) 중간에 죽어도 그때까지 지운 것만이라도
    // 남게 주기적으로 저장(체크포인트).
    if ((checked + failed) % 50 === 0) {
      await fs.writeFile(path.join(REPO_ROOT, 'venue-photos.json'), JSON.stringify(cache, null, 2) + '\n', 'utf-8');
      console.log(`[audit] progress checked=${checked} cleared=${cleared} failed=${failed}`);
    }
  }

  await fs.writeFile(path.join(REPO_ROOT, 'venue-photos.json'), JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[audit] DONE checked=${checked} cleared=${cleared} failed=${failed}`);
}

main().catch((e) => {
  console.error('[audit] FATAL:', e);
  process.exit(1);
});

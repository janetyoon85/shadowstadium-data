// 구장 위치(국가) 백필(2026-10-22, 사용자: "구장정보에 구장위치 추가해서 국기랑 나라 표기") — 좌표(lat/lon)로 OpenStreetMap Nominatim 역지오코딩(zoom=3, 국가 단위)을 해서
// venue-country.json({ 구장ID: ISO 3166-1 alpha-2 소문자 }) 영구 캐시를 만든다. 앱은 이 파일만 읽는다(런타임 외부 호출 0회).
// 입력: 구장 좌표 JSON([[id, lat, lon], …]) — 앱 VENUES 에서 뽑는다(VENUE_COORDS 환경변수 경로). 좌표가 0 인 자리표시·중국(법적 제한) 구장은 건드리지 않고 아래 FIXED 로 고정한다.
// 이용 정책: Nominatim 은 초당 1건 이하·식별 가능한 User-Agent 를 요구한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'venue-country.json');
const UA = 'ShadeSideCrawler/1.0 (janetyoon85@gmail.com)';
const DELAY_MS = 1200;
// 좌표를 두지 않는 구장(중국은 법적 제한으로 좌표 미보관, 경기장 미정 자리표시)의 국가
export const FIXED = { china_venue_tbc: 'cn', argentina_venue_tbc: 'ar', ecuador_venue_tbc: 'ec', peru_venue_tbc: 'pe' };
// 중국 구장은 법적 제한으로 좌표를 보관하지 않는다(lat/lon 0) — 나라만 고정.
for (const id of 'beijing_guoan_workers,phoenix_mountain_sports_park_chengdu,chongqing_longxing_stadium,tianhe_stadium_guangzhou,dalian_suoyuwan_football_stadium,hanghai_stadium_zhengzhou,tiexi_stadium_shenyang,qingdao_youth_football_stadium,qingdao_westcoast_university_stadium,jinan_olympic_sports_center,shanghai_port_pudong,shanghai_stadium,shenzhen_stadium_xinpengcheng,teda_football_stadium_tianjin,wuhan_sports_center_stadium,yuxi_plateau_sports_center,huanglong_sports_center_hangzhou,xiamen_egret_stadium,tongliang_long_stadium,shenzhen_universiade_sports_centre_stadium,tianjin_olympic_center_stadium,shenyang_olympic_sports_center_stadium,hangzhou_olympic_sports_center_stadium,bao_an_stadium,shenzhen_youth_football_training_base_center_stadium,longhua_cultural_and_sports_center_stadium,shenzhen_youth_football_training_base_pitch_1,suzhou_taihu_football_center,suzhou_sports_center_stadium'.split(',')) FIXED[id] = 'cn';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function reverseCountry(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=3&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      if (!res.ok) return undefined;
      const j = await res.json();
      const cc = j?.address?.country_code;
      return typeof cc === 'string' && /^[a-z]{2}$/.test(cc) ? cc : null;
    } catch { await sleep(3000); }
  }
  return undefined;
}

// 영국(gb)은 구성국(잉글랜드·스코틀랜드·웨일스·북아일랜드)으로 나눠 적는다 — Nominatim zoom=5 의 address.state 로 판별.
const GB_PARTS = { England: 'gb-eng', Scotland: 'gb-sct', Wales: 'gb-wls', 'Northern Ireland': 'gb-nir' };
export async function reverseGbPart(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      if (!res.ok) return undefined;
      const a = (await res.json())?.address || {};
      return GB_PARTS[a.state] ?? null;
    } catch { await sleep(3000); }
  }
  return undefined;
}

async function main() {
  const coords = JSON.parse(await fs.readFile(process.env.VENUE_COORDS, 'utf8'));
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}
  Object.assign(cache, FIXED);
  const todo = coords.filter(([id, lat, lon]) => !(id in cache) && (lat || lon));
  const budget = Number(process.env.COUNTRY_BUDGET || 100000);
  console.log(`[venue-country] total=${coords.length} cached=${Object.keys(cache).length} todo=${todo.length}`);
  let done = 0, fail = 0;
  for (const [id, lat, lon] of todo) {
    if (done >= budget) break;
    const cc = await reverseCountry(lat, lon);
    done++;
    if (cc === undefined) { fail++; } else if (cc) cache[id] = cc;
    if (done % 50 === 0) { await fs.writeFile(OUT, JSON.stringify(cache, null, 0) + '\n', 'utf8'); console.log(`[venue-country] ${done}/${todo.length} fail=${fail}`); }
    await sleep(DELAY_MS);
  }
  // 영국 구성국 세분화(gb → gb-eng 등). 못 알아내면 gb 로 둔다.
  const byId = new Map(coords.map(([id, la, lo]) => [id, [la, lo]]));
  let refined = 0;
  for (const [id, cc] of Object.entries(cache)) {
    if (cc !== 'gb' || !byId.has(id)) continue;
    const part = await reverseGbPart(...byId.get(id));
    await sleep(DELAY_MS);
    if (part) { cache[id] = part; refined++; }
    if (refined % 30 === 0) await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
  }
  await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
  console.log(`[venue-country] done=${done} fail=${fail} gbRefined=${refined} cached=${Object.keys(cache).length}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

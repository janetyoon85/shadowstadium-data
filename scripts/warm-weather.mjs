// 캐시 워밍 — 그날 경기 구장의 /api/kma edge 캐시(s-maxage 30분)를 미리 데움.
// fcm-reminders.yml 15분 cron에 piggyback (별도 워크플로 없음).
//
// 동작:
//   · KST 13:00–22:30 윈도우 밖이거나 오늘 경기 없으면 no-op (exit 0)
//     (야간경기 18:30 시작 → ~22:00 종료. 경기 중 앱 여는 사용자의 cold MISS 방지차 종료까지 커버.)
//   · 구장 격자는 프록시의 /api/venues(단일 출처 web api/_venues.js)에서 가져옴
//     → 신규 구장은 web 레포 한 곳만 갱신하면 워밍도 자동 추종
//   · 각 구장 GET /api/kma?nx=&ny= — MISS면 KMA upstream 2콜(단기+초단기)로 캐시 갱신,
//     HIT면 0콜. 15분 틱 × 캐시 30분 → upstream은 실질 30분당 1회/구장.
//   · kma-mid는 6h 캐시라 워밍 불필요(스킵).
//
// 쿼터: 최악(13구장 동시 경기) 13구장 × MISS(캐시 30분당 1회) ≈ 9.5h/0.5h ≈ 19회/구장 × 3콜(단기+초단기예보+초단기실황)
//        ≈ 740콜/일 < 한도 10,000의 8%. (윈도우 9.5h·13:00–22:30 기준.)
// 실패는 경고만 — 리마인더 발송을 막지 않도록 항상 exit 0 (워크플로에서도 continue-on-error).
//
// 테스트: WARM_FORCE=1 node scripts/warm-weather.mjs  (윈도우 무시, 오늘 경기 기준)

import fs from 'node:fs';

const SITE_URL = 'https://shadowstadium.vercel.app';
const WINDOW_START = 13 * 60;       // KST 13:00
const WINDOW_END = 22 * 60 + 30;    // KST 22:30 (야간경기 종료까지 커버 — 경기 중 cold MISS 방지)
const FORCE = process.env.WARM_FORCE === '1';

// KST 현재 시각 (UTC+9 보정 Date 에 getUTC* 로 KST 값 read — 프록시와 동일 관례)
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const kstMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
const today = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;

if (!FORCE && (kstMin < WINDOW_START || kstMin > WINDOW_END)) {
  console.log(`[warm] KST ${Math.floor(kstMin / 60)}:${String(kstMin % 60).padStart(2, '0')} — 윈도우(13:00–22:30) 밖, no-op`);
  process.exit(0);
}

function loadGames() {
  const a = JSON.parse(fs.readFileSync('games_2026.json', 'utf8'));
  let m = [];
  try { m = JSON.parse(fs.readFileSync('manual_games.json', 'utf8')); } catch {}
  return [...a, ...m];
}

const venueIds = [...new Set(loadGames().filter((g) => g.date === today).map((g) => g.venueId))];
if (!venueIds.length) {
  console.log(`[warm] ${today} 경기 없음 — no-op`);
  process.exit(0);
}

let table = {};
try {
  const r = await fetch(`${SITE_URL}/api/venues`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  table = (await r.json()).venues;
} catch (e) {
  console.error(`[warm] /api/venues 실패 — 워밍 스킵: ${e}`);
  process.exit(0);
}

console.log(`[warm] ${today} 경기 구장 ${venueIds.length}개: ${venueIds.join(', ')}`);
for (const id of venueIds) {
  const v = table[id];
  if (!v) { console.error(`[warm] ⚠️ ${id}: /api/venues 에 없음 — web _venues.js 갱신 필요`); continue; }
  try {
    const t0 = Date.now();
    const r = await fetch(`${SITE_URL}/api/kma?nx=${v.nx}&ny=${v.ny}`);
    console.log(`[warm] ${id} (${v.nx},${v.ny}) → ${r.status} ${r.headers.get('x-vercel-cache') ?? '-'} ${Date.now() - t0}ms`);
  } catch (e) {
    console.error(`[warm] ${id} 실패: ${e}`);
  }
}

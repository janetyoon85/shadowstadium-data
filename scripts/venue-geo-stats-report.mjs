// 구장 보호 P-1 그림자 측정 요약(RTDB venue_geo_stats/<uid>)을 읽어 합산 지표를 출력/알림한다.
// 실행: node scripts/venue-geo-stats-report.mjs [--discord]   (FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL, DISCORD_WEBHOOK_URL)
// 통과 기준(P-2 진행 조건): 평균 지연 ≤ 1000ms, 실패율 ≤ 2%, 불일치 0.
import admin from './firebase-admin-compat.mjs';
import { alertWebhook } from './alert-throttle.mjs';

export function summarize(docs) {
  const t = { devices: 0, n: 0, ok: 0, mismatch: 0, err: 0, msSum: 0, msMax: 0, errKinds: {}, versions: {}, os: {} };
  for (const d of docs) {
    if (!d || typeof d.n !== 'number') continue;
    t.devices++; t.n += d.n; t.ok += d.ok || 0; t.mismatch += d.mismatch || 0; t.err += d.err || 0; t.msSum += d.msSum || 0; t.msMax = Math.max(t.msMax, d.msMax || 0);
    for (const [k, v] of Object.entries(d.errKinds || {})) t.errKinds[k] = (t.errKinds[k] || 0) + v;
    if (d.ver) t.versions[d.ver] = (t.versions[d.ver] || 0) + 1;
    if (d.os) t.os[d.os] = (t.os[d.os] || 0) + 1;
  }
  const avgMs = t.n ? Math.round(t.msSum / t.n) : 0;
  const errRate = t.n ? t.err / t.n : 0;
  const pass = t.n >= 50 && t.devices >= 3 && avgMs <= 1000 && errRate <= 0.02 && t.mismatch === 0;
  return { ...t, avgMs, errRate, pass };
}

export function format(s) {
  const pct = (x) => (x * 100).toFixed(2) + '%';
  return [`구장 보호 P-1 측정: 기기 ${s.devices}대 · 조회 ${s.n}건`,
    `일치 ${s.ok} · 불일치 ${s.mismatch} · 오류 ${s.err} (${pct(s.errRate)}) ${Object.keys(s.errKinds).length ? JSON.stringify(s.errKinds) : ''}`,
    `평균 지연 ${s.avgMs}ms · 최대 ${s.msMax}ms · OS ${JSON.stringify(s.os)} · 버전 ${JSON.stringify(s.versions)}`,
    `P-2 진행 기준(≥50건·≥3대·평균≤1s·오류≤2%·불일치0): ${s.pass ? '✅ 통과' : '⏳ 미충족'}`].join('\n');
}

async function main() {
  const url = process.env.FIREBASE_DATABASE_URL;
  if (!url) throw new Error('FIREBASE_DATABASE_URL 없음');
  const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: url });
  const { getDatabase } = await import('firebase-admin/database');
  const db = getDatabase(app);
  const snap = await db.ref('venue_geo_stats').once('value');
  const docs = Object.values(snap.val() || {}).filter((d) => d && d.test !== true);
  const s = summarize(docs);
  const text = format(s);
  console.log(text);
  const hook = alertWebhook();
  if (process.argv.includes('--discord') && hook) {
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, content: '📊 ' + text }) });
  }
  await db.goOffline();
  process.exit(0);
}
if (process.argv[1] && process.argv[1].endsWith('venue-geo-stats-report.mjs')) await main();

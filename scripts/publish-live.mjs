// 라이브 점수만 Firebase Realtime Database 로 직접 게시한다(2026-10-27). 앱이 GitHub raw(저장소보다 1~1.5분 늦음, CDN 캐시)를 거치지 않고 몇 KB 짜리 라이브 데이터를 바로 읽게 하기 위함.
// 대상: 진행 중이거나 최근(6시간)에 끝났거나 곧(90분 안) 시작하는 경기만 — 앱의 농구 목록 위에 덮어쓰는(overlay) 최소 필드(st, per, 점수, 쿼터별 점수).
// 실행: node scripts/publish-live.mjs basketball [--dry]   (FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from './firebase-admin-compat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = {
  basketball: { file: 'basketball/games.json', pick: (j) => (Array.isArray(j) ? j : j.games || []) },
};

export function selectLive(games, nowMs) {
  const out = {};
  for (const g of games) {
    if (!g || !g.id || !g.h || !g.a) continue;
    const live = g.st === 'live';
    const recentFinal = g.st === 'final' && nowMs - g.t < 6 * 3600e3 && nowMs - g.t > 0;
    const soon = g.st === 'scheduled' && g.t - nowMs < 90 * 60e3 && g.t - nowMs > -3 * 3600e3;
    if (!(live || recentFinal || soon)) continue;
    // Firebase 키에는 . $ # [ ] / 를 쓸 수 없어 id 의 구분자를 바꿔 저장한다(앱이 같은 규칙으로 되돌림: '~' → ':').
    const key = String(g.id).replace(/[.$#[\]/:]/g, '~');
    out[key] = { id: g.id, st: g.st, per: g.per || '', h: { s: g.h.s, ls: g.h.ls || null }, a: { s: g.a.s, ls: g.a.ls || null } };
  }
  return out;
}

async function main() {
  const sport = process.argv[2];
  const dry = process.argv.includes('--dry');
  const src = SOURCES[sport];
  if (!src) throw new Error('알 수 없는 종목: ' + sport);
  const games = src.pick(JSON.parse(fs.readFileSync(path.join(ROOT, src.file), 'utf8')));
  const payload = { ts: Date.now(), games: selectLive(games, Date.now()) };
  const n = Object.keys(payload.games).length;
  if (dry) {
    console.log(`[publish-live] ${sport} 게시 대상 ${n}경기, 크기 ${JSON.stringify(payload).length}B`);
    return;
  }
  const url = process.env.FIREBASE_DATABASE_URL;
  if (!url) {
    console.log('[publish-live] FIREBASE_DATABASE_URL 없음 — 건너뜀');
    return;
  }
  const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: url });
  const { getDatabase } = await import('firebase-admin/database');
  const db = getDatabase(app);
  await db.ref('live/' + sport).set(payload);
  console.log(`[publish-live] ${sport} ${n}경기 게시 완료 (${JSON.stringify(payload).length}B)`);
  // 데이터베이스 연결을 닫지 않으면 프로세스가 끝나지 않아 워크플로우가 시간 제한까지 매달린다(2026-10-27 시험에서 발견).
  db.goOffline();
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();

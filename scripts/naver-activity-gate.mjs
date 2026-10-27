// 네이버 전체 시즌 수집(요청 97건)을 "활동이 있을 때만" 돌리는 게이트(2026-10-27, 요청량 절감 P1 추가).
// 진행·임박 경기가 하나라도 있으면(킥오프 -5시간 ~ +45분, 종료·취소·연기 제외) 통과, 없으면 30분에 한 번(분 % 30 == 0)만 통과한다.
// FORCE(수동 전체 실행·테스트)·읽기 실패는 항상 통과(안전 쪽). 결과는 GITHUB_OUTPUT 의 skip=true|false 로 낸다.
// 실행: node scripts/naver-activity-gate.mjs     (환경변수 FORCE=1, IDLE_EVERY_MIN=30)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const startMs = (g) => (g.date && g.time ? Date.parse(`${g.date}T${g.time}:00+09:00`) : NaN);

export function decide({ games, nowMs, minute, force = false, idleEveryMin = 30 }) {
  if (force) return { skip: false, reason: '강제 실행' };
  let active = 0;
  for (const g of games || []) {
    if (!g || g.status === 'completed' || g.status === 'cancelled' || g.status === 'postponed') continue;
    const t = startMs(g);
    if (Number.isFinite(t) && t - nowMs < 45 * 60e3 && nowMs - t < 5 * 3600e3) active++;
  }
  if (active > 0) return { skip: false, reason: `진행·임박 경기 ${active}건` };
  if (idleEveryMin <= 1 || minute % idleEveryMin === 0) return { skip: false, reason: `활동 없음 — ${idleEveryMin}분 주기 점검` };
  return { skip: true, reason: `활동 없음 — 다음 점검까지 건너뜀(분=${minute}, ${idleEveryMin}분 주기)` };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let r;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'games.json'), 'utf8'));
    const games = Array.isArray(j) ? j : j.games || [];
    const now = new Date();
    r = decide({ games, nowMs: now.getTime(), minute: now.getUTCMinutes(), force: process.env.FORCE === '1', idleEveryMin: Number(process.env.IDLE_EVERY_MIN) || 30 });
  } catch (e) {
    r = { skip: false, reason: `games.json 읽기 실패(${String(e.message).slice(0, 40)}) — 안전하게 실행` };
  }
  console.log(`[activity-gate] ${r.skip ? '건너뜀' : '실행'} — ${r.reason}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${r.skip}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

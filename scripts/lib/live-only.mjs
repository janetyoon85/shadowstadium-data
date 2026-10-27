// 라이브 전용 모드 공통(NAS 상시 폴러, 2026-10-27): LIVE_ONLY=1 일 때 크롤러가 "진행 중이거나 곧 시작한 경기가 있는 리그"만 어제~내일 범위로 조회하고,
// 저장·알림·병합 없이 라이브 스냅샷(live-snapshot-<이름>.json)만 남긴 뒤 끝낸다. 평소(GitHub 워크플로우) 실행에는 영향이 없다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { selectLiveGames, selectEventGames, gamesActive } from './live-select.mjs';

export const LIVE_ONLY = process.env.LIVE_ONLY === '1';

// games.json(로컬 클론)에서 지금 활성(시작 45분 전 ~ 5시간 뒤)인 경기가 있는 리그 코드 집합.
export async function activeLeagues(repoRoot) {
  const set = new Set();
  try {
    const j = JSON.parse(await fs.readFile(path.join(repoRoot, 'games.json'), 'utf-8'));
    const all = Array.isArray(j) ? j : j.games || [];
    const now = Date.now();
    for (const g of all) if (g && g.league && !set.has(g.league) && gamesActive([g], now)) set.add(g.league);
  } catch { /* games.json 이 없으면 빈 집합 — 아무것도 조회하지 않음 */ }
  return set;
}

// games: 크롤러가 만든 경기 객체들(games.json 항목과 같은 모양). 라이브 필드만 골라 스냅샷 파일로 남긴다.
export async function writeLiveSnapshot(repoRoot, name, games, startMs) {
  const snap = selectLiveGames(games, Date.now());
  const events = selectEventGames(games, Date.now()); // 알림 감지용(비공개 events/games 로만 게시)
  await fs.writeFile(path.join(repoRoot, `live-snapshot-${name}.json`), JSON.stringify({ ts: startMs, games: snap, events }) + '\n', 'utf-8');
  console.log(`[live-only] ${name}: ${Object.keys(snap).length}경기 스냅샷`);
}

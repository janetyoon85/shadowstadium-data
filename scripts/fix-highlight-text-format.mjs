// 1회성 정리 스크립트(2026-09-28) — MLB/NPB 하이라이트 텍스트 포맷 변경(fetch-schedule.mjs
// parseBaseballHighlightsFromBoxscore 수정)을 이미 완료(final:true)된 과거 경기에도 소급 적용.
//
// 이전: "{선수} {N}호"(홈런, 사실은 이 경기 홈런수인데 시즌누적처럼 보여 오해 유발) /
//       "{선수} {N}개"(도루, N=1이어도 항상 개수 표기).
// 이후: N===1이면 개수 생략(이름만), N>=2일 때만 "{선수} {N}개".
//
// saves.json(캐시)과 games.json(직렬화된 실제 표시 데이터) 양쪽 다 고쳐야 화면에 반영됨.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const SAVES_FILE = path.join(REPO_ROOT, 'saves.json');

function fixText(how, text) {
  if (how !== '홈런' && how !== '도루') return text;
  // 기존 포맷: "{이름} {N}호" 또는 "{이름} {N}개" (이름 자체에 공백이 있을 수 있어 마지막 토큰만 검사)
  const m = text.match(/^(.+) (\d+)(호|개)$/);
  if (!m) return text; // 이미 새 포맷이거나(이름만) 다른 포맷(KBO 자유텍스트 등) — 손대지 않음.
  const [, name, countStr] = m;
  const count = Number(countStr);
  return count === 1 ? name : `${name} ${count}개`;
}

function fixHighlights(highlights) {
  if (!highlights) return { changed: false };
  let changed = false;
  for (const side of ['home', 'away']) {
    const list = highlights[side];
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      if (!h || typeof h.text !== 'string') continue;
      const fixed = fixText(h.how, h.text);
      if (fixed !== h.text) {
        h.text = fixed;
        changed = true;
      }
    }
  }
  return { changed };
}

async function main() {
  const games = JSON.parse(await fs.readFile(GAMES_FILE, 'utf-8'));
  const saves = JSON.parse(await fs.readFile(SAVES_FILE, 'utf-8'));

  let gamesChanged = 0;
  for (const g of games) {
    if (fixHighlights(g.highlights).changed) gamesChanged++;
  }

  let savesChanged = 0;
  for (const entry of Object.values(saves)) {
    if (entry && typeof entry === 'object' && entry.highlights) {
      if (fixHighlights(entry.highlights).changed) savesChanged++;
    } else if (entry && typeof entry === 'object' && (entry.home || entry.away)) {
      // saves.json의 캐시 엔트리 자체가 {home,away,final} 형태(하이라이트 전용)인 경우도 있음.
      if (fixHighlights(entry).changed) savesChanged++;
    }
  }

  await fs.writeFile(GAMES_FILE, JSON.stringify(games, null, 2) + '\n', 'utf-8');
  await fs.writeFile(SAVES_FILE, JSON.stringify(saves, null, 2) + '\n', 'utf-8');
  console.log(`[fix-highlight-text-format] games changed=${gamesChanged} saves entries changed=${savesChanged}`);
}

main().catch((err) => {
  console.error('[fix-highlight-text-format] FATAL:', err);
  process.exit(1);
});

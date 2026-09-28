// 1회성 백필(2026-09-28, v2) — 즐겨찾기 선수 알림 2차(야구)용 `player` 구조화 필드를
// parseBaseballHighlights/FromBoxscore에 추가했는데, 이미 완료(final)돼 캐시가 잠긴 과거
// 경기는 이 필드 없이 저장돼 있음 — 이미 저장된 text에 같은 파싱 규칙을 다시 적용해서
// 소급 채움(네트워크 재조회 없음, 순수 텍스트 재파싱).
//
// v2: v1은 "이강민2(6 7회)"처럼 홈런 외 반복 이벤트(실책/도루/폭투 등)에 붙는 "호 없는
// 순수 숫자" 카운트를 못 걷어내서 통째로 이름처럼 저장하는 버그가 있었음(2026-09-28 실사용
// 리포트, 선수 검색에 "이강민2(6 7회)"가 그대로 뜸) — fetch-schedule.mjs의 playerTokenRe
// 수정(숫자 뒤 "호" 선택적)과 동일한 정규식으로 맞추고, 이미 잘못 채워진 값도 덮어씀(v1은
// player 있으면 건너뛰어서 잘못된 값이 안 고쳐졌음).
//
// text 포맷 두 가지:
//  - KBO(etcRecords): "이름(디테일)" 또는 "이름33호(디테일)" 또는 "이름2(디테일)" — 텍스트
//    전체가 이 한 토큰과 정확히 일치할 때만 이름 추출(여러 토큰이 섞인 파싱 실패 폴백
//    텍스트는 안전하게 미부착 — 추측하지 않는다는 기존 원칙 유지).
//  - MLB/NPB(boxscore): "이름" 또는 "이름 N개" — 뒤의 " N개"만 제거.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const SAVES_FILE = path.join(REPO_ROOT, 'saves.json');

function extractPlayer(text) {
  if (!text) return null;
  const kboFull = text.match(/^([가-힣A-Za-z]+)(?:\d+호?)?\(([^)]*)\)$/);
  if (kboFull) return kboFull[1];
  if (text.includes('(')) return null; // 여러 토큰이 섞인 파싱-실패 폴백 텍스트 — 추측 안 함.
  const stripped = text.replace(/ \d+개$/, '').trim();
  return stripped || null;
}

function fixHighlights(highlights) {
  if (!highlights) return false;
  let changed = false;
  for (const side of ['home', 'away']) {
    const list = highlights[side];
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      if (!h) continue;
      const player = extractPlayer(h.text);
      if (player) {
        if (h.player !== player) {
          h.player = player;
          changed = true;
        }
      } else if (h.player) {
        delete h.player; // v1이 잘못 채워둔 값 제거.
        changed = true;
      }
    }
  }
  return changed;
}

async function main() {
  const games = JSON.parse(await fs.readFile(GAMES_FILE, 'utf-8'));
  const saves = JSON.parse(await fs.readFile(SAVES_FILE, 'utf-8'));

  let gamesChanged = 0;
  for (const g of games) {
    if (fixHighlights(g.highlights)) gamesChanged++;
  }

  let savesChanged = 0;
  for (const entry of Object.values(saves)) {
    if (entry && typeof entry === 'object' && entry.highlights) {
      if (fixHighlights(entry.highlights)) savesChanged++;
    }
  }

  await fs.writeFile(GAMES_FILE, JSON.stringify(games, null, 2) + '\n', 'utf-8');
  await fs.writeFile(SAVES_FILE, JSON.stringify(saves, null, 2) + '\n', 'utf-8');
  console.log(`[backfill-baseball-player-field] games changed=${gamesChanged} saves entries changed=${savesChanged}`);
}

main().catch((err) => {
  console.error('[backfill-baseball-player-field] FATAL:', err);
  process.exit(1);
});

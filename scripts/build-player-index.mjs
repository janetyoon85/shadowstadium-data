// 즐겨찾기 선수 알림 기능(2026-09-28)의 검색 인덱스 빌더.
//
// 앱은 games.json 만 fetch하고, games.json 은 여러 크롤러(fetch-schedule.mjs +
// fetch-espn-asia/world-soccer-leagues.mjs + fetch-espn-olympic-football.mjs)가 각자
// 자기 리그의 scorers 필드를 채워 넣는 구조라, 어느 한 크롤러의 인메모리 상태만 봐서는
// 전체 선수를 못 봄 — 그래서 이 스크립트는 fetch-schedule.mjs 실행 "뒤에" 별도 스텝으로
// 커밋된 games.json 전체를 다시 읽어서 players.json 을 만든다.
//
// 1차: 축구(scorers[].n=골, scorers[].a=어시, cards[].n=카드). 2차(2026-09-28): 야구
// (highlights[].player=홈런/도루 등, parseBaseballHighlights/FromBoxscore가 파싱 중 추출).
//
// 매칭(notify-player-events.mjs)은 이름 문자열 단독이라 여기서 만드는 appearances는
// 순전히 검색/동명이인 구분용 UI 메타데이터일 뿐, 매칭 범위에는 영향 없음.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPlayerName } from './player-name-canon.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const PLAYERS_FILE = path.join(REPO_ROOT, 'players.json');

const MAX_APPEARANCES_PER_PLAYER = 10;

function pushAppearance(entry, appearance) {
  // 최근 것을 앞에 유지, 같은 {team,league} 중복이면 자리만 앞으로 옮기고 lastSeenDate 최신화.
  const idx = entry.appearances.findIndex((a) => a.team === appearance.team && a.league === appearance.league);
  if (idx >= 0) {
    if (appearance.nat) entry.appearances[idx].nat = appearance.nat;
    entry.appearances.splice(idx, 1);
  }
  entry.appearances.unshift(appearance);
  if (entry.appearances.length > MAX_APPEARANCES_PER_PLAYER) entry.appearances.length = MAX_APPEARANCES_PER_PLAYER;
}

function upsertPlayer(map, name, sport, date, appearance) {
  const key = name.trim();
  if (!key) return;
  let entry = map.get(key);
  if (!entry) {
    entry = { name: key, sport, appearances: [], lastSeenDate: date };
    map.set(key, entry);
  }
  if (!entry.lastSeenDate || date > entry.lastSeenDate) entry.lastSeenDate = date;
  pushAppearance(entry, appearance);
}

async function main() {
  const raw = await fs.readFile(GAMES_FILE, 'utf-8');
  const games = JSON.parse(raw);
  const map = new Map();

  // pushAppearance는 unshift로 "가장 최근 처리된 것 = appearances[0]"을 가정하므로, games.json에
  // 저장된 순서(크롤러가 리그별로 append한 순서라 날짜순이 아님)가 아니라 날짜 오름차순으로
  // 정렬한 뒤 순회해야 appearances[0]이 실제 최신 소속으로 나옴 — 안 그러면 파일 순서상 우연히
  // 뒤에 있는 대회(예: 국가대표 친선전)가 실제로는 더 과거인데도 앞에 뜨는 버그가 생김
  // (2026-09-28 실사용 리포트: 손흥민 appearances[0]이 소속클럽이 아니라 국가대표로 뜸).
  const sortedGames = [...games].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  for (const g of sortedGames) {
    if (!g.scorers && !g.cards && !g.highlights) continue;
    const sides = [
      { key: 'home', team: g.home },
      { key: 'away', team: g.away },
    ];
    if (g.scorers) {
      for (const { key, team } of sides) {
        const list = g.scorers[key];
        if (!Array.isArray(list)) continue;
        for (const s of list) {
          // 득점자(s.n)는 네이버 원문(한글), 어시스트(s.a)는 ESPN 원문(영문)이라 같은 선수인데
          // 문자열이 갈라지는 문제 발견(2026-09-28, "손흥민"으로 즐겨찾기해도 어시스트인 "Son
          // Heung-Min"은 안 잡히던 버그) — canonicalPlayerName으로 알려진 한국 선수는 한글 키로
          // 합쳐서 인덱싱(모르는 이름은 그대로 통과, 지어내지 않음).
          if (s.n) upsertPlayer(map, canonicalPlayerName(s.n), 'soccer', g.date, { team, league: g.league, nat: s.nat });
          // 어시스트 선수는 실제로는 상대 팀이 아니라 같은 팀 소속 — team은 골 넣은 쪽과 동일.
          if (s.a) upsertPlayer(map, canonicalPlayerName(s.a), 'soccer', g.date, { team, league: g.league, nat: s.aNat });
        }
      }
    }
    // 카드(경고/퇴장) 받은 선수 — 골/어시 없이 카드만 받은 선수도 즐겨찾기·검색 가능하게
    // 인덱스에 포함(2026-09-28, "카드 정보 추가됐을 때도 알람" 요청 대응). nat 정보 없음(카드
    // 데이터엔 국적 조회 로직이 안 붙어있음).
    if (g.cards) {
      for (const { key, team } of sides) {
        const list = g.cards[key];
        if (!Array.isArray(list)) continue;
        for (const c of list) {
          if (c.n) upsertPlayer(map, canonicalPlayerName(c.n), 'soccer', g.date, { team, league: g.league });
        }
      }
    }
    // 야구 하이라이트(홈런/도루 등) — 2차(2026-09-28). 전부 네이버 원문(한글)이라 축구와 달리
    // canonicalPlayerName(ESPN 영문 매칭용) 적용 불필요·의미 없음.
    if (g.highlights) {
      for (const { key, team } of sides) {
        const list = g.highlights[key];
        if (!Array.isArray(list)) continue;
        for (const h of list) {
          if (h.player) upsertPlayer(map, h.player, 'baseball', g.date, { team, league: g.league });
        }
      }
    }
  }

  const players = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  await fs.writeFile(PLAYERS_FILE, JSON.stringify(players, null, 2) + '\n', 'utf-8');
  console.log(`[build-player-index] players=${players.length}`);
}

main().catch((err) => {
  console.error('[build-player-index] FATAL:', err);
  process.exit(1);
});

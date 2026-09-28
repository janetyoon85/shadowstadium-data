// 즐겨찾기 선수 알림 기능(2026-09-28)의 검색 인덱스 빌더.
//
// 앱은 games.json 만 fetch하고, games.json 은 여러 크롤러(fetch-schedule.mjs +
// fetch-espn-asia/world-soccer-leagues.mjs + fetch-espn-olympic-football.mjs)가 각자
// 자기 리그의 scorers 필드를 채워 넣는 구조라, 어느 한 크롤러의 인메모리 상태만 봐서는
// 전체 선수를 못 봄 — 그래서 이 스크립트는 fetch-schedule.mjs 실행 "뒤에" 별도 스텝으로
// 커밋된 games.json 전체를 다시 읽어서 players.json 을 만든다.
//
// 1차: 축구(scorers[].n=골, scorers[].a=어시, cards[].n=카드). 2차(2026-09-28): 야구 타자
// (highlights[].player=홈런/도루 등, parseBaseballHighlights/FromBoxscore가 파싱 중 추출).
// 3차(2026-09-29): 야구 투수(winPitcher/losePitcher/savePitcher/holds) — 타자 이벤트가 없는
// 투수 전업 선수(다르빗슈 유 등)는 그동안 인덱스에 전혀 안 잡히던 갭이었음.
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
    // 버그 수정(2026-09-28, 사용자 리포트로 발견: "데이비스" 검색에서 있던 국적이 사라짐) —
    // 예전엔 기존 항목에 nat을 병합해놓고 바로 버린 뒤 "새" appearance 객체만 남겨서, 같은
    // {team,league} 조합의 나중 골/카드(국적 조회가 아직 안 된 경기)가 처리될 때마다 이전에
    // 이미 확인해둔 국적이 조용히 사라졌음(국적은 백필 예산제라 같은 팀+리그 안에서도 어떤
    // 경기는 nat이 있고 어떤 경기는 아직 없을 수 있음 — 흔한 케이스). 새 appearance에 nat이
    // 없고 기존 항목에 있으면 새 쪽으로 이어받아 보존.
    const existing = entry.appearances[idx];
    if (!appearance.nat && existing.nat) appearance.nat = existing.nat;
    entry.appearances.splice(idx, 1);
  }
  entry.appearances.unshift(appearance);
  if (entry.appearances.length > MAX_APPEARANCES_PER_PLAYER) entry.appearances.length = MAX_APPEARANCES_PER_PLAYER;
}

// 동명이인 완전 분리(2026-09-28, 사용자 요청: "고유id로해야겠네") — pid("espn:12345"/
// "naver:20220242")가 있으면 그걸로 키를 잡아서 실존 인물 단위로 정확히 묶고, 없으면(아직
// ID를 못 붙인 소스) 예전처럼 이름으로만 묶음(동명이인 섞임 위험 그대로 남음 — 근본 한계).
// entry.id는 App.tsx의 즐겨찾기 저장 키 겸 FCM 토픽 계산 입력값으로 그대로 씀 — pid가 있으면
// pid 문자열 자체(이미 "espn:"/"naver:"로 네임스페이스됨), 없으면 이름 그대로(기존 동작과
// 100% 동일 — 기존에 이름으로 즐겨찾기해둔 유저의 구독이 깨지지 않도록 하위호환 유지).
function upsertPlayer(map, name, sport, date, appearance, pid) {
  const key = name.trim();
  if (!key) return;
  // sport까지 포함한 복합 키(2026-09-28) — 예전엔 이름만으로 키를 잡아서 스포츠가 다른 완전
  // 다른 사람(예: 축구 "데이비스"와 MLB 피츠버그 소속 "데이비스")까지 한 항목에 섞였음
  // (사용자 리포트로 발견: 자책골 넣은 웨일스 축구선수 검색에 야구선수 데이터가 붙어있었음).
  const id = pid || key;
  const mapKey = `${sport}:${pid ? `pid:${pid}` : `name:${key}`}`;
  let entry = map.get(mapKey);
  if (!entry) {
    entry = { name: key, sport, id, appearances: [], lastSeenDate: date };
    map.set(mapKey, entry);
  }
  // 같은 실존 인물(pid 기준)이라도 표기가 갈릴 수 있어(한글 원문 vs 영문 원문) 최신 등장의
  // 이름으로 갱신 — appearances와 동일하게 "최근 것 우선" 원칙.
  if (!entry.lastSeenDate || date >= entry.lastSeenDate) entry.name = key;
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
    if (!g.scorers && !g.cards && !g.highlights && !g.winPitcher && !g.losePitcher && !g.savePitcher && !g.holds) continue;
    const sides = [
      { key: 'home', team: g.home },
      { key: 'away', team: g.away },
    ];
    if (g.scorers) {
      for (const { key, team } of sides) {
        const list = g.scorers[key];
        if (!Array.isArray(list)) continue;
        const oppTeam = key === 'home' ? g.away : g.home;
        for (const s of list) {
          // 득점자(s.n)는 네이버 원문(한글), 어시스트(s.a)는 ESPN 원문(영문)이라 같은 선수인데
          // 문자열이 갈라지는 문제 발견(2026-09-28, "손흥민"으로 즐겨찾기해도 어시스트인 "Son
          // Heung-Min"은 안 잡히던 버그) — canonicalPlayerName으로 알려진 한국 선수는 한글 키로
          // 합쳐서 인덱싱(모르는 이름은 그대로 통과, 지어내지 않음).
          // 자책골(s.og)은 크롤러 관례상 "득점 수혜팀"(team) 목록에 실리지만 실제 득점(자책)한
          // 선수는 상대팀(oppTeam) 소속 — App.tsx ScorerLine과 동일 반전 적용(사용자 리포트,
          // 2026-09-28: "즐겨찾기 선수 할때도 그 국적 따라가야함" — 팀 폴백용 team이 틀리면
          // 즐겨찾기/검색의 국기도 같이 틀어짐).
          if (s.n) upsertPlayer(map, canonicalPlayerName(s.n), 'soccer', g.date, { team: s.og ? oppTeam : team, league: g.league, nat: s.nat }, s.pid);
          // 어시스트 선수는 실제로는 상대 팀이 아니라 같은 팀 소속 — team은 골 넣은 쪽과 동일
          // (자책골엔 애초에 어시스트가 안 붙음, s.og면 s.a 자체가 없음). 어시스트는 득점자와
          // 다른 사람이라 pid도 별도(s.apid) — s.pid를 잘못 재사용하면 두 사람이 하나로 묶임.
          if (s.a) upsertPlayer(map, canonicalPlayerName(s.a), 'soccer', g.date, { team, league: g.league, nat: s.aNat }, s.apid);
        }
      }
    }
    // 카드(경고/퇴장) 받은 선수 — 골/어시 없이 카드만 받은 선수도 즐겨찾기·검색 가능하게
    // 인덱스에 포함(2026-09-28, "카드 정보 추가됐을 때도 알람" 요청 대응). c.nat: ESPN 연동
    // 리그는 2026-09-29부터 직접 조회됨(K리그는 여전히 없음).
    if (g.cards) {
      for (const { key, team } of sides) {
        const list = g.cards[key];
        if (!Array.isArray(list)) continue;
        for (const c of list) {
          if (c.n) upsertPlayer(map, canonicalPlayerName(c.n), 'soccer', g.date, { team, league: g.league, nat: c.nat }, c.pid);
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
          // h.nat: MLB만 채워짐(2026-09-28, mlb-nationality.mjs) — 있으면 같이 실어서 선수
          // 검색/즐겨찾기 국기 표시(App.tsx playerNatDisplay)에도 재사용. h.pid(mlb:personId,
          // 2026-09-29)는 동명이인 구분+선수 정보 카드용, 축구 pid와 동일 역할.
          if (h.player) upsertPlayer(map, h.player, 'baseball', g.date, { team, league: g.league, nat: h.nat }, h.pid);
        }
      }
    }
    // 투수(승/패/세이브/홀드) — 타자 하이라이트만 있고 투수는 인덱스에 아예 없던 갭(2026-09-29,
    // 사용자 리포트: "다르빗슈유는 왜검색이안되는거야?" — 타자 이벤트(홈런 등)가 없는 투수 전업
    // 선수는 그동안 즐겨찾기 검색에 절대 안 걸렸음). 승/패 투수는 네이버 스케줄 API 원본부터
    // 홈/원정 구분이 없는 문자열이라(win/losePitcherName) team을 알 수 없어 ''(미상)로 인덱싱 —
    // 국기·이름 검색엔 지장 없고, 소속팀 표시만 생략됨. 홀드는 이미 팀별로 갈라져 있어(g.holds.
    // {home,away}) 정확한 team 부착 가능.
    if (g.winPitcher) upsertPlayer(map, g.winPitcher, 'baseball', g.date, { team: '', league: g.league, nat: g.winPitcherNat }, g.winPitcherPid);
    if (g.losePitcher) upsertPlayer(map, g.losePitcher, 'baseball', g.date, { team: '', league: g.league, nat: g.losePitcherNat }, g.losePitcherPid);
    if (g.savePitcher) upsertPlayer(map, g.savePitcher, 'baseball', g.date, { team: '', league: g.league, nat: g.savePitcherNat }, g.savePitcherPid);
    if (g.holds) {
      for (const { key, team } of sides) {
        const list = g.holds[key];
        if (!Array.isArray(list)) continue;
        for (const hp of list) {
          if (hp.n) upsertPlayer(map, hp.n, 'baseball', g.date, { team, league: g.league, nat: hp.nat }, hp.pid);
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

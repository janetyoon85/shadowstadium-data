// 야구 하이라이트(홈런/도루/2루타/3루타/실책/병살타/결승타 등) 파싱 — 순수 함수만 모아서
// fetch-schedule.mjs에서 분리(2026-09-28, 테스트 자동화 도입). 부작용(네트워크/파일 IO) 없음
// — fetch-schedule.mjs는 이 모듈을 import해서 그대로 쓰고, 테스트는 fetch-schedule.mjs의
// main() 자동실행(전체 크롤링)을 트리거하지 않고 이 파일만 독립적으로 불러와 검증 가능.

// /record 응답 selection: 어떤 선수가 어느 팀 소속인지. etcRecords는 team 필드가 없어 양팀
// 선수가 한 문자열에 섞여 나오므로(예: "박민우(1회) 한재환(3회)"가 실제론 서로 다른 팀 선수),
// battersBoxscore/pitchersBoxscore(홈/원정 로스터)에서 이름 집합을 만들어 매칭.
export function classifyHighlightSide(name, homeNames, awayNames) {
  if (homeNames.has(name)) return 'home';
  if (awayNames.has(name)) return 'away';
  return null;
}

// MLB/NPB는 /record 응답 스키마 자체가 KBO와 달라 etcRecords(인닝별 하이라이트 로그)가 없고
// homeBatter/awayBatter(선수별 박스스코어 집계, hr/sb 숫자만)만 내려옴 — 홈런/도루 집계로
// 대체 생성.
export function parseBaseballHighlightsFromBoxscore(rd) {
  const build = (arr) => {
    const out = [];
    for (const p of arr || []) {
      const name = (p?.name || '').trim();
      if (!name) continue;
      // "N호"는 한국 야구 관례상 시즌 누적 홈런 개수를 뜻하는데, 이 필드(p.hr)는 이 경기
      // 한 경기의 홈런 개수라 대부분 1이 찍혀 "다 1호"로 보이는 오해를 낳음(2026-09-28) —
      // Naver 이 엔드포인트엔 타자 시즌누적 홈런수 필드 자체가 없어 진짜 "N호"는 구현 불가.
      // 1개일 땐 개수 생략, 2개+(한 경기 멀티 홈런)일 때만 표기. "홈런"/"도루" 단어는
      // HighlightColumn이 how 필드로 이미 앞에 붙여 렌더링하므로(App.tsx) text에 중복 기재 안 함.
      // birth/backnum/playerId는 최종 games.json엔 안 나가는 임시 필드 — MLB 국적 enrichment
      // (mlb-nationality.mjs)가 fetch-schedule.mjs에서 이 값으로 MLB 공식 API 선수와 매칭(생년월일
      // 대조)한 뒤 nat 필드로 바꿔치기하고 지움. KBO/NPB는 enrichment 대상이 아니라 그대로
      // 버려짐(games.json 스키마에 영향 없음, 2026-09-28).
      const meta = {};
      if (p.birth) meta.birth = p.birth;
      if (p.backnum) meta.backnum = p.backnum;
      // NPB 선수 정보 카드용(2026-09-29, "가져올수있는정보 최대한많이 가져와야지") — Naver의
      // playerId가 야후재팬 스포츠 선수ID와 그대로 일치함(실측 확인). MLB는 이 필드를 안 씀
      // (statsapi.mlb.com 공식 personId와 별개 체계라 birth 대조 매칭을 따로 함) — 호출부
      // (fetch-schedule.mjs)가 리그별로 걸러서 NPB만 pid로 승격시킴.
      if (p.playerId) meta.playerId = String(p.playerId);
      if (p.hr > 0) out.push({ how: '홈런', text: p.hr === 1 ? name : `${name} ${p.hr}개`, player: name, ...meta });
      if (p.sb > 0) out.push({ how: '도루', text: p.sb === 1 ? name : `${name} ${p.sb}개`, player: name, ...meta });
    }
    return out;
  };
  const home = build(rd?.homeBatter);
  const away = build(rd?.awayBatter);
  // 무득점/무도루라도 반드시 { home:[], away:[] } 객체로 돌려줘야 함 — undefined를 돌려주면
  // "아직 새 포맷으로 재조회 안 된 옛 캐시"와 구분이 안 돼 매 실행마다 영원히 재조회하는 버그.
  return { home, away };
}

// "강백호33호(4회2점 구창모)"처럼 시즌 홈런 개수(숫자+호)가 이름에 바로 붙는 표기도 있고,
// 홈런 외 반복 이벤트(실책/도루/폭투/병살타/2루타/3루타/주루사/도루자/포일 등)는 "호" 없이
// 그냥 "이강민2(6 7회)"처럼 횟수 숫자만 붙는 표기도 있음(2026-09-28 발견 — 이 숫자를 안
// 걷어내던 게 선수 검색에 "이강민2(6 7회)"가 통째로 이름처럼 뜨던 버그의 원인). 이름 자체는
// 한글/영문만(숫자 제외)으로 잡고 그 뒤 숫자(+호는 있어도/없어도)는 통째로 매치에 포함만 시킴.
export const PLAYER_TOKEN_RE = /([가-힣A-Za-z]+)(?:\d+호?)?\(([^)]*)\)/g;

export function parseBaseballHighlights(rd) {
  const etcRecords = rd?.etcRecords;
  if (!Array.isArray(etcRecords)) return parseBaseballHighlightsFromBoxscore(rd);
  // 이름→KBO 공식 playerCode/pcode 맵(2026-09-29, 선수 정보 카드용 — "가져올수있는정보
  // 최대한많이 가져와야지") — battersBoxscore는 playerCode, pitchersBoxscore는 pcode 필드명이
  // 서로 다름(실측 확인) — koreabaseball.com의 pcode 파라미터와 정확히 같은 값(실측 검증됨).
  const codeByName = new Map();
  for (const p of [...(rd?.battersBoxscore?.home || []), ...(rd?.battersBoxscore?.away || [])]) {
    if (p?.name && p?.playerCode) codeByName.set(p.name.trim(), String(p.playerCode));
  }
  for (const p of [...(rd?.pitchersBoxscore?.home || []), ...(rd?.pitchersBoxscore?.away || [])]) {
    if (p?.name && p?.pcode) codeByName.set(p.name.trim(), String(p.pcode));
  }
  const homeNames = new Set([
    ...(rd?.battersBoxscore?.home || []).map((p) => p?.name).filter(Boolean),
    ...(rd?.pitchersBoxscore?.home || []).map((p) => p?.name).filter(Boolean),
  ]);
  const awayNames = new Set([
    ...(rd?.battersBoxscore?.away || []).map((p) => p?.name).filter(Boolean),
    ...(rd?.pitchersBoxscore?.away || []).map((p) => p?.name).filter(Boolean),
  ]);
  const home = [];
  const away = [];
  const playerTokenRe = new RegExp(PLAYER_TOKEN_RE.source, 'g');
  for (const e of etcRecords) {
    if (!e || !e.how || e.how === '심판') continue;
    const result = (e.result || '').trim();
    if (!result) continue;
    playerTokenRe.lastIndex = 0;
    let m;
    let matched = false;
    while ((m = playerTokenRe.exec(result))) {
      matched = true;
      const side = classifyHighlightSide(m[1], homeNames, awayNames);
      // 즐겨찾기 선수 알림 2차(야구, 2026-09-28) — 이름은 이미 파싱 중 추출되니 구조화된
      // 필드로도 남김(기존 text 자유문자열은 그대로 유지, 표시 코드 변경 없음).
      const entry = { how: e.how, text: m[0], player: m[1] };
      const code = codeByName.get(m[1]);
      if (code) entry.playerCode = code;
      if (side === 'home') home.push(entry);
      else away.push(entry); // 로스터 매칭 실패(외국인 표기차 등)도 정보 유실 방지로 away 폴백.
    }
    if (!matched) away.push({ how: e.how, text: result }); // 파싱 실패 — 원문 그대로 폴백.
  }
  return { home, away };
}

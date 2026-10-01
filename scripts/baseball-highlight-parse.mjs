// 야구 하이라이트(홈런/도루/2루타/3루타/실책/병살타/결승타 등) 파싱 — 순수 함수만 모아서
// fetch-schedule.mjs에서 분리(2026-09-28, 테스트 자동화 도입). 부작용(네트워크/파일 IO) 없음
// — fetch-schedule.mjs는 이 모듈을 import해서 그대로 쓰고, 테스트는 fetch-schedule.mjs의
// main() 자동실행(전체 크롤링)을 트리거하지 않고 이 파일만 독립적으로 불러와 검증 가능.

// 승/패/세/홀드 투수 + 선수코드 추출(2026-09-30, "타마무라" 리포트로 발견) — 예전엔 승/패/세
// 투수의 pid를 pitcherCodeByName(이름→코드 맵)으로 역매칭했는데, 네이버 schedule API(승/패/세
// 투수명)와 record API(boxscore 이름)가 같은 일본 선수를 서로 다른 한글 표기로 음역하는 경우가
// 있어(실측: "타마무라" vs "다마무라", "타카하시" vs "다카하시" — 탁음/청음 표기 불일치) 이름
// 매칭 자체가 실패하는 경우가 실측 15건 확인됨. 대신 이 배열엔 wls(승패세홀 코드)가 선수
// 코드(pCode/playerId)와 함께 이미 붙어있어 이름 매칭 없이 바로 뽑을 수 있음 — 훨씬 신뢰도
// 높은 방법. KBO(pitchingResult, wls='W'/'L'/'S')와 MLB/NPB(homePitcher/awayPitcher, wls=
// '승'/'패'/'세')는 스키마가 달라 분기 처리.
export function extractPitcherDecisions(rd) {
  let save = null;
  let winPitcherCode = null;
  let losePitcherCode = null;
  let savePitcherCode = null;
  if (Array.isArray(rd?.pitchingResult)) {
    const sv = rd.pitchingResult.find((p) => p && p.wls === 'S');
    save = sv ? (sv.name || '').trim() || null : null;
    const w = rd.pitchingResult.find((p) => p && p.wls === 'W');
    const l = rd.pitchingResult.find((p) => p && p.wls === 'L');
    if (w?.pCode) winPitcherCode = String(w.pCode);
    if (l?.pCode) losePitcherCode = String(l.pCode);
    if (sv?.pCode) savePitcherCode = String(sv.pCode);
  } else {
    for (const key of ['homePitcher', 'awayPitcher']) {
      const arr = rd?.[key];
      if (!Array.isArray(arr)) continue;
      const sv = arr.find((p) => p && p.wls === '세');
      if (sv) {
        save = (sv.name || '').trim() || null;
        if (sv.playerId) savePitcherCode = String(sv.playerId);
        break;
      }
    }
    for (const key of ['homePitcher', 'awayPitcher']) {
      const arr = rd?.[key];
      if (!Array.isArray(arr)) continue;
      const w = arr.find((p) => p && p.wls === '승');
      const l = arr.find((p) => p && p.wls === '패');
      if (w?.playerId && !winPitcherCode) winPitcherCode = String(w.playerId);
      if (l?.playerId && !losePitcherCode) losePitcherCode = String(l.playerId);
    }
  }

  // 홀드 투수(2026-09-29) — 팀별 분리가 필요해서(경기당 여러 명 가능) KBO는
  // pitchersBoxscore.{home,away}(팀분리 있음, wls '홀')를, MLB/NPB는 homePitcher/awayPitcher
  // (원래도 팀분리, wls '홀')를 씀. KBO의 pitchingResult는 팀분리가 없어 홀드용으론 부적합.
  const holdHome = [];
  const holdAway = [];
  // 투수 이름→코드 맵(2026-09-29, 선수 정보 카드용) — 위 직접추출로 대부분 안 쓰이게 됐지만
  // 홀드 투수 pid 조회 등 이름 기반 조회가 필요한 나머지 호출부를 위해 계속 유지.
  const pitcherCodeByName = {};
  if (rd?.pitchersBoxscore) {
    for (const p of rd.pitchersBoxscore.home || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdHome.push(n); }
    for (const p of rd.pitchersBoxscore.away || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdAway.push(n); }
    for (const p of [...(rd.pitchersBoxscore.home || []), ...(rd.pitchersBoxscore.away || [])]) {
      if (p?.name && p?.pcode) pitcherCodeByName[p.name.trim()] = String(p.pcode);
    }
  } else {
    for (const p of rd?.homePitcher || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdHome.push(n); }
    for (const p of rd?.awayPitcher || []) if (p && p.wls === '홀') { const n = (p.name || '').trim(); if (n) holdAway.push(n); }
    for (const p of [...(rd?.homePitcher || []), ...(rd?.awayPitcher || [])]) {
      if (p?.name && p?.playerId) pitcherCodeByName[p.name.trim()] = String(p.playerId);
    }
  }

  return { save, winPitcherCode, losePitcherCode, savePitcherCode, holdHome, holdAway, pitcherCodeByName };
}

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

// KBO 경기중(live) 하이라이트 — /record의 etcRecords는 경기가 거의 끝나야 한꺼번에 채워지는
// 것으로 실측 확인(2026-09-29, 사용자 리포트 "지금 경기중인 야구경기에 이벤트 하나도 안붙음"으로
// 발견) — 진행중엔 대신 /relay(문자중계)의 타석별 결과(textOptions[].type 13/23="이름 : 결과",
// 14/24=주자 진루/실책/폭투)를 파싱. 이 창은 "현재 하프이닝 전체"만 담고(고정 개수 롤링 윈도우가
// 아님, 실측 확인) 하프이닝이 바뀌면 이전 것은 복구 불가 — 그래서 여러 번 poll한 결과를 seqno
// 기준으로 누적해야 함(이 함수 자체는 한 번의 응답만 파싱하는 순수함수, 누적은 호출부 책임).
// 선수 로스터 정보가 없어 pid는 못 붙임(경기 종료 후 etcRecords 기반 parseBaseballHighlights가
// pid까지 채운 최종본으로 자연히 교체됨).
const RELAY_HOW_PATTERNS = [
  [/홈런/, '홈런'],
  [/3루타/, '3루타'],
  [/2루타/, '2루타'],
  [/병살타|병살/, '병살타'],
  [/실책/, '실책'],
  [/폭투/, '폭투'],
  [/도루/, '도루'],
];

function classifyRelayHow(desc) {
  for (const [re, how] of RELAY_HOW_PATTERNS) {
    if (re.test(desc)) return how;
  }
  return null;
}

// MLB/NPB 경기중(live) 하이라이트(2026-09-30, "mlb도 경기중에이벤트발생하면 추가해줘야지
// 모든야구경기 다마찬가지임" — KBO만 /relay 실시간화가 돼있고 MLB/NPB는 여전히 etcRecords
// 기반이라 경기 막판까지 하이라이트가 하나도 안 붙던 동일 공백이 남아있었음, 실측(7회말 3:2
// 진행중 MLB경기 하이라이트 0건)으로 확인). MLB/NPB의 /relay 응답은 KBO와 스키마가 달라
// textOptions 중첩 없이 title(타석 헤더)+text(<br/>로 이어붙인 투구/결과 로그)가 평면으로 내려오고,
// 각 항목에 homeOrAway 필드가 직접 있어(실측 확인) KBO처럼 하프이닝 헤더 타이틀을 팀명으로
// 매칭할 필요가 없음(그 방식의 "타이틀 매칭 전엔 유실" 함정 자체가 없음). 단, 주자 진루 로그는
// "2루주자 이름 3루까지 진루"처럼 콜론(:) 없이 내려오는 경우가 있어(실측 확인) 이름 경계가
// 모호함 — 콜론 있는 "이름 : 설명" 줄만 파싱하고 콜론 없는 줄은 오귀속 방지로 그냥 건너뜀
// (KBO와 동일 철학: 오귀속보단 유실이 안전).
export function parseMlbNpbRelayHighlights(textRelayData) {
  const relays = [...(textRelayData?.textRelays || [])].sort((a, b) => a.no - b.no);
  const home = [];
  const away = [];
  let maxSeqno = 0;
  for (const r of relays) {
    if (typeof r.no === 'number') maxSeqno = Math.max(maxSeqno, r.no);
    if (Number(r.titleStyle) !== 8) continue;
    const lines = (r.text || '').split('<br/>').map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const m = /^(?:\d루주자\s+)?(.+?)\s*:\s*(.+)$/.exec(line);
      if (!m) continue;
      const [, name, desc] = m;
      const how = classifyRelayHow(desc);
      if (!how) continue;
      const entry = { how, text: `${name.trim()} ${desc.trim()}`, player: name.trim(), seqno: r.no };
      if (String(r.homeOrAway) === '1') home.push(entry);
      else if (String(r.homeOrAway) === '0') away.push(entry);
    }
  }
  return { home, away, maxSeqno };
}

export function parseKboRelayHighlights(textRelayData, homeTeamName, awayTeamName) {
  const relays = [...(textRelayData?.textRelays || [])].sort((a, b) => a.no - b.no);
  const home = [];
  const away = [];
  let seenSeqnos = [];
  let maxSeqno = 0;
  let battingSide = null; // 'home' | 'away' — 하프이닝 시작 타이틀("9회초 한화 공격")로 판정.
  for (const r of relays) {
    // 실측 확인(2026-09-29): titleStyle은 문자열("0","8" 등)로 내려옴 — 숫자 엄격비교(=== 0)로
    // 짜서 한 번도 안 걸리던 버그가 있었음(하프이닝 시작을 못 잡아 battingSide가 계속 null로
    // 남아 실제 이벤트가 전부 유실됐음). 문자열/숫자 둘 다 안전하게 매치되도록 Number()로 비교.
    if (Number(r.titleStyle) === 0 && r.title) {
      if (homeTeamName && r.title.includes(homeTeamName)) battingSide = 'home';
      else if (awayTeamName && r.title.includes(awayTeamName)) battingSide = 'away';
    }
    for (const opt of r.textOptions || []) {
      if (typeof opt.seqno === 'number') maxSeqno = Math.max(maxSeqno, opt.seqno);
      if (![13, 14, 23, 24].includes(Number(opt.type))) continue;
      const text = (opt.text || '').trim();
      const m = /^(?:\d루주자\s+)?(.+?)\s*:\s*(.+)$/.exec(text);
      if (!m) continue;
      const [, name, desc] = m;
      const how = classifyRelayHow(desc);
      if (!how) continue;
      const entry = { how, text: `${name.trim()} ${desc.trim()}`, player: name.trim(), seqno: opt.seqno };
      seenSeqnos.push(opt.seqno);
      if (battingSide === 'home') home.push(entry);
      else if (battingSide === 'away') away.push(entry);
      // battingSide 미확정(첫 하프이닝 타이틀을 못 찾은 경우)이면 어느 쪽에도 안 넣음 —
      // 오귀속보단 유실이 안전(누적 로직이라 다음 poll에서 하프이닝 타이틀 포함하면 잡힘).
    }
  }
  return { home, away, maxSeqno, seenSeqnos };
}

// 라이브 현재 투수/타자/카운트(2026-10-01, "던지고있는 투수정보도") — /relay 응답에서 추출. 기록 전용(앱 표시는 추후).
// KBO: currentGameState의 pcode를 lineup에서 이름으로 역조회. MLB/NPB: baseInfo.ballCount 등에 이름이 직접 있음.
export function parseLiveState(league, trd, isTopHalf) {
  try {
    if (league === 'KBO') {
      const cg = trd?.currentGameState;
      if (!cg) return null;
      const nameOf = (code) => {
        for (const s of ['homeLineup', 'awayLineup']) for (const r of ['pitcher', 'batter']) for (const p of trd[s]?.[r] || []) if (String(p.pcode) === String(code)) return p.name;
        return undefined;
      };
      const out = {};
      const p = nameOf(cg.pitcher), b = nameOf(cg.batter);
      if (p) out.pitcher = p;
      if (b) out.batter = b;
      const n = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
      if (n(cg.ball) !== undefined) out.ball = n(cg.ball);
      if (n(cg.strike) !== undefined) out.strike = n(cg.strike);
      if (n(cg.out) !== undefined) out.out = n(cg.out);
      const bases = [1, 2, 3].filter((i) => cg[`base${i}`] && cg[`base${i}`] !== '0');
      out.bases = bases;
      const pc = [...(trd.homeLineup?.pitcher || []), ...(trd.awayLineup?.pitcher || [])].find((x) => String(x.pcode) === String(cg.pitcher))?.ballCount;
      if (typeof pc === 'number' && pc > 0) out.pitchCount = pc;
      return out.pitcher || out.batter ? out : null;
    }
    const bi = trd?.baseInfo;
    if (!bi) return null;
    const bc = bi.ballCount || {};
    // 초=원정 공격 → 투수는 홈 투수, 말=홈 공격 → 투수는 원정 투수.
    const side = isTopHalf === true ? 'home' : isTopHalf === false ? 'away' : null;
    const out = {};
    if (side && bi[`${side}Pitcher`]) out.pitcher = bi[`${side}Pitcher`];
    if (bc.batter) out.batter = bc.batter;
    if (typeof bc.b === 'number') out.ball = bc.b;
    if (typeof bc.s === 'number') out.strike = bc.s;
    if (typeof bc.o === 'number') out.out = bc.o;
    out.bases = [1, 2, 3].filter((i) => bc[`base${i}`]);
    const pc = side ? Number(bi[`${side}PitcherPitchBallCount`]) : NaN;
    if (pc > 0) out.pitchCount = pc;
    return out.pitcher || out.batter ? out : null;
  } catch {
    return null;
  }
}

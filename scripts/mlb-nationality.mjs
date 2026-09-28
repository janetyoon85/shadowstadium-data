// MLB 선수 국적 조회(2026-09-28) — 축구는 ESPN citizenship을 쓰지만 야구는 하이라이트 파서가
// 순수 네이버 한글 텍스트만 다뤄서 국적 정보 자체가 없음. MLB만 공식 무료 API(statsapi.mlb.com,
// 키 불필요)로 채움 — KBO/NPB는 이런 API가 없어(조사 완료, 2026-09-28) 스코프 제외.
//
// 매칭 방식: 네이버 한글명 → 영문명 변환(로마자 표기 불확실) 대신, "팀+생년월일"로 매칭.
// 네이버 박스스코어(homeBatter/awayBatter)에 이미 생년월일(birth, YYYYMMDD)이 실려오고(실측
// 확인됨 — 오타니/저지/벨린저 등 실제 생년월일과 정확히 일치), MLB 공식 로스터 API도 개별
// people 엔드포인트에서 생년월일을 주므로, 같은 팀 로스터 내에서 생년월일이 같은 선수를 찾으면
// 사실상 유일하게 식별됨(이름 표기 차이·로마자 변환 오류에 영향받지 않음 — ESPN 매칭과 동일하게
// "확실한 매칭만, 추측 안 함" 원칙).
//
// 팀 로스터+선수 생년월일은 프로세스 실행마다 새로 조회(트레이드로 로스터가 바뀔 수 있어 캐싱
// 안 함 — ESPN 로스터 캐시와 동일 패턴, 팀당 2회 호출뿐이라 비용 낮음).

// games.json에 실제 쓰이는 MLB 팀 한글명 → MLB 공식 teamId. "내셔널"/"아메리칸"(올스타전
// 임시팀)은 고정 로스터가 없어 매칭 대상 아님(포함 안 함 — 조회 시 undefined 처리).
export const MLB_TEAM_ID = {
  'LA다저스': 119, 'LA에인절스': 108, '뉴욕메츠': 121, '뉴욕양키스': 147, '디트로이트': 116,
  '마이애미': 146, '미네소타': 142, '밀워키': 158, '보스턴': 111, '볼티모어': 110,
  '샌디에이고': 135, '샌프란시스코': 137, '세인트루이스': 138, '시애틀': 136, '시카고W': 145,
  '시카고컵스': 112, '신시내티': 113, '애리조나': 109, '애슬레틱스': 133, '애틀랜타': 144,
  '워싱턴': 120, '캔자스시티': 118, '콜로라도': 115, '클리블랜드': 114, '탬파베이': 139,
  '텍사스': 140, '토론토': 141, '피츠버그': 134, '필라델피아': 143, '휴스턴': 117,
};

const teamBirthMapCache = new Map(); // teamId -> Promise<Map(YYYYMMDD -> birthCountry)>

async function loadTeamBirthMap(teamId) {
  if (teamBirthMapCache.has(teamId)) return teamBirthMapCache.get(teamId);
  const promise = (async () => {
    const map = new Map();
    try {
      const rosterRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=fullSeason`);
      if (!rosterRes.ok) return map;
      const rosterJson = await rosterRes.json();
      const personIds = (rosterJson.roster || []).map((r) => r?.person?.id).filter(Boolean);
      if (personIds.length === 0) return map;
      const peopleRes = await fetch(`https://statsapi.mlb.com/api/v1/people?personIds=${personIds.join(',')}`);
      if (!peopleRes.ok) return map;
      const peopleJson = await peopleRes.json();
      for (const p of peopleJson.people || []) {
        if (!p.birthDate || !p.birthCountry) continue;
        map.set(p.birthDate.replace(/-/g, ''), p.birthCountry);
      }
    } catch {
      // 네트워크 실패 — 빈 맵으로 두고 생략(스케줄 수집 자체를 막지 않음, ESPN 패턴과 동일).
    }
    return map;
  })();
  teamBirthMapCache.set(teamId, promise);
  return promise;
}

export async function getMlbNationality(koreanTeamName, birthYYYYMMDD) {
  if (!birthYYYYMMDD) return undefined;
  const teamId = MLB_TEAM_ID[koreanTeamName];
  if (!teamId) return undefined;
  const map = await loadTeamBirthMap(teamId);
  return map.get(birthYYYYMMDD);
}

// 선발투수 승/패/세이브 국적(2026-09-29) — 네이버 스케줄 API는 win/losePitcherName만 주고 생년월일이
// 없어(투수 record 배열에도 birth 필드 자체가 없음, KBO/K리그 조사와 동일한 데드엔드) 위
// "팀+생년월일" 매칭을 그대로 못 씀. 대신 MLB 공식 API의 decisions 엔드포인트
// (/game/{gamePk}/feed/live의 liveData.decisions)가 승/패/세이브 투수를 실제 선수 ID로 직접
// 알려줘서, 이름 매칭 없이(=오매칭 가능성 자체가 없음) ID→국적을 바로 조회할 수 있음 — 배터/
// 하이라이트보다 오히려 더 확실한 매칭. gamePk는 날짜+양팀 ID로 스케줄 API에서 찾음.
const scheduleCache = new Map(); // dateYmd -> Promise<Map("awayId@homeId" -> gamePk)>
async function loadScheduleForDate(dateYmd) {
  if (scheduleCache.has(dateYmd)) return scheduleCache.get(dateYmd);
  const promise = (async () => {
    const map = new Map();
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateYmd}`);
      if (!res.ok) return map;
      const j = await res.json();
      for (const d of j.dates || []) {
        for (const g of d.games || []) {
          const homeId = g.teams?.home?.team?.id;
          const awayId = g.teams?.away?.team?.id;
          if (homeId && awayId) map.set(`${awayId}@${homeId}`, g.gamePk);
        }
      }
    } catch {
      // 네트워크 실패 — 빈 맵, 다음 run 재시도(ESPN 패턴과 동일).
    }
    return map;
  })();
  scheduleCache.set(dateYmd, promise);
  return promise;
}

// decisions(승/패/세이브)와 holds(홀드) 둘 다 같은 live feed 응답 하나에 들어있어(liveData.decisions,
// liveData.boxscore) 게임당 요청을 하나로 공유 — 2026-09-29 홀드 추가하면서 재사용.
const liveFeedCache = new Map(); // gamePk -> Promise<liveFeedJson|null>
async function loadLiveFeed(gamePk) {
  if (liveFeedCache.has(gamePk)) return liveFeedCache.get(gamePk);
  const promise = (async () => {
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  })();
  liveFeedCache.set(gamePk, promise);
  return promise;
}

async function getPeopleNat(personIds) {
  const map = new Map();
  if (personIds.length === 0) return map;
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people?personIds=${personIds.join(',')}`);
    if (!res.ok) return map;
    const j = await res.json();
    for (const p of j.people || []) {
      if (p.id != null && p.birthCountry) map.set(p.id, p.birthCountry);
    }
  } catch {
    // 빈 맵 — 다음 run 재시도.
  }
  return map;
}

export function addDaysYmd(dateYmd, delta) {
  const d = new Date(`${dateYmd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// games.json의 date는 KST, MLB 공식 스케줄 API는 미국 동부시각(ET) 날짜 기준 — 저녁 경기가 많아
// KST로는 보통 다음날로 넘어감(예: ET 9/27 저녁 경기 = KST 9/28). 처음엔 g.date를 그대로 넘겨서
// 매칭이 거의 다 실패하는 버그가 있었음(2026-09-29, 배포 직후 자체 재검증 중 발견 — "워싱턴 vs
// 뉴욕메츠 2026-09-28"로 조회 시 빈 결과, 실제로는 스케줄상 2026-09-27임을 재현 확인). KST
// 날짜와 그 전날(ET 기준 가장 흔한 경우) 둘 다 시도 — 그래도 못 찾으면 드문 주간경기 등으로 보고
// 생략(추측 안 함).
async function findGamePk(homeTeamKo, awayTeamKo, dateYmd) {
  const homeId = MLB_TEAM_ID[homeTeamKo];
  const awayId = MLB_TEAM_ID[awayTeamKo];
  if (!homeId || !awayId) return undefined;
  const key = `${awayId}@${homeId}`;
  for (const candidate of [addDaysYmd(dateYmd, -1), dateYmd]) {
    const sched = await loadScheduleForDate(candidate);
    const gamePk = sched.get(key);
    if (gamePk) return gamePk;
  }
  return undefined;
}

// 스코어 검증(2026-09-29 긴급 추가) — findGamePk가 날짜+양팀ID만으로 매칭하다 보니, 같은 두 팀이
// 연속 시리즈를 치르는 동안(하루 앞/뒤로도 같은 매치업이 실제로 존재하는 경우가 흔함) 엉뚱한
// 하루가 걸려도 "찾음"으로 반환되는 사고가 실제로 있었음(실사용자 리포트, 2026-09-29: "오타니는
// 국적조회되는데... 야마모토국적 미국아니고일본인데?" — 재조사 결과 상당수 MLB 투수 국적이
// 완전히 다른 실제 경기의 결정으로 뒤바뀌어 있었음, 날짜 하루 이내 오차인데도 시리즈 특성상 거의
// 항상 "그럴듯한" 다른 진짜 경기가 걸려서 조용히 틀린 데이터가 저장됨). 우리가 이미 알고 있는
// 스코어(g.homeScore/awayScore)와 MLB 쪽이 기록한 최종 스코어가 정확히 일치할 때만 그 경기를
// 신뢰 — 하나라도 다르면 완전히 다른 경기를 잘못 골랐다는 뜻이라 found:false로 안전하게 폐기.
async function verifyScoreMatch(gamePk, homeScore, awayScore) {
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return { ok: false, feed: undefined };
  const feed = await loadLiveFeed(gamePk);
  const teams = feed?.liveData?.linescore?.teams;
  const ok = !!teams && teams.home?.runs === homeScore && teams.away?.runs === awayScore;
  return { ok, feed };
}

// {winNat?, loseNat?, saveNat?, found} — found=false는 "게임 자체를 못 찾음"(팀명 미등록, 그
// 날짜에 매치업 없음, 스코어 불일치로 다른 경기로 판명, API 장애 등 재시도할 가치 있는 실패) —
// 호출부가 이걸로 "이미 시도함" 캐시 플래그를 세울지 판단(found=false면 플래그 세우지 말고 다음
// run 재시도). found=true인데 개별 win/lose/save 국적이 없는 건 그 자체로 정상적인 결과(해당
// 역할 자체가 없는 경기 등)라 플래그 확정해도 안전 — 절대 국적을 추측하지 않음.
export async function getMlbPitcherDecisionNats(homeTeamKo, awayTeamKo, dateYmd, homeScore, awayScore) {
  const gamePk = await findGamePk(homeTeamKo, awayTeamKo, dateYmd);
  if (!gamePk) return { found: false };
  const { ok, feed } = await verifyScoreMatch(gamePk, homeScore, awayScore);
  if (!ok) return { found: false };
  const dec = feed?.liveData?.decisions;
  if (!dec) return { found: false };
  const ids = [dec.winner?.id, dec.loser?.id, dec.save?.id].filter((id) => id != null);
  const out = { found: true };
  if (ids.length === 0) return out;
  const natById = await getPeopleNat(ids);
  if (dec.winner?.id != null && natById.has(dec.winner.id)) out.winNat = natById.get(dec.winner.id);
  if (dec.loser?.id != null && natById.has(dec.loser.id)) out.loseNat = natById.get(dec.loser.id);
  if (dec.save?.id != null && natById.has(dec.save.id)) out.saveNat = natById.get(dec.save.id);
  return out;
}

// 홀드 투수 국적(2026-09-29) — decisions와 달리 MLB API도 "누가 홀드인지"를 boxscore 개별 투수의
// pitching.holds>0 여부로만 알 수 있어(단일 winner/loser 같은 역할 필드 없음), 팀별 투수 등장
// 순서(team.pitchers 배열은 실제 등판 순서)로 홀드 투수만 골라낸 뒤, 호출부(fetch-schedule.mjs)가
// 네이버 홀드 투수 이름 배열과 같은 순서로 zip 매칭. {found, home?: (string|undefined)[], away?:
// (...)[]} — found=false는 게임 자체를 못 찾은 재시도 대상(getMlbPitcherDecisionNats와 동일
// 규약). 국적 조회 실패한 자리는 undefined로 그대로 유지(배열에서 빼면 이후 인덱스가 밀려 엉뚱한
// 투수와 매칭될 수 있어서). 길이 자체가 네이버 쪽 홀드 투수 수와 다르면(그 경기에 한해 드문
// 불일치) 호출부가 짧은 쪽까지만 zip.
export async function getMlbHoldNats(homeTeamKo, awayTeamKo, dateYmd, homeScore, awayScore) {
  const gamePk = await findGamePk(homeTeamKo, awayTeamKo, dateYmd);
  if (!gamePk) return { found: false };
  const { ok, feed } = await verifyScoreMatch(gamePk, homeScore, awayScore);
  if (!ok) return { found: false };
  const box = feed?.liveData?.boxscore;
  if (!box) return { found: false };
  const bySide = {};
  const allIds = [];
  for (const side of ['home', 'away']) {
    const team = box.teams?.[side];
    const holders = [];
    for (const pid of team?.pitchers || []) {
      const p = team.players?.[`ID${pid}`];
      const holds = p?.stats?.pitching?.holds;
      if (typeof holds === 'number' && holds > 0) {
        holders.push(pid);
        allIds.push(pid);
      }
    }
    bySide[side] = holders;
  }
  const out = { found: true };
  if (allIds.length === 0) return out;
  const natById = await getPeopleNat(allIds);
  for (const side of ['home', 'away']) {
    // filter로 빈 자리를 없애면 등장 순서 인덱스가 밀려 호출부의 zip 매칭이 다음 홀드 투수에게
    // 엉뚱한 국적을 붙일 수 있음 — undefined를 그 자리에 그대로 남겨 인덱스 정합성 유지.
    out[side] = bySide[side].map((id) => natById.get(id));
  }
  return out;
}

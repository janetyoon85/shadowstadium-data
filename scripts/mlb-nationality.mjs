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

const decisionsCache = new Map(); // gamePk -> Promise<{winner?,loser?,save?}|null>
async function loadDecisions(gamePk) {
  if (decisionsCache.has(gamePk)) return decisionsCache.get(gamePk);
  const promise = (async () => {
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
      if (!res.ok) return null;
      const j = await res.json();
      return j.liveData?.decisions || null;
    } catch {
      return null;
    }
  })();
  decisionsCache.set(gamePk, promise);
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

// {winNat?, loseNat?, saveNat?} — 매칭 실패(로스터에 없는 팀명, 그 날짜에 해당 매치업 없음, API
// 오류 등)는 전부 빈 객체로 graceful하게 생략, 절대 추측하지 않음.
export async function getMlbPitcherDecisionNats(homeTeamKo, awayTeamKo, dateYmd) {
  const homeId = MLB_TEAM_ID[homeTeamKo];
  const awayId = MLB_TEAM_ID[awayTeamKo];
  if (!homeId || !awayId) return {};
  const sched = await loadScheduleForDate(dateYmd);
  const gamePk = sched.get(`${awayId}@${homeId}`);
  if (!gamePk) return {};
  const dec = await loadDecisions(gamePk);
  if (!dec) return {};
  const ids = [dec.winner?.id, dec.loser?.id, dec.save?.id].filter((id) => id != null);
  if (ids.length === 0) return {};
  const natById = await getPeopleNat(ids);
  const out = {};
  if (dec.winner?.id != null && natById.has(dec.winner.id)) out.winNat = natById.get(dec.winner.id);
  if (dec.loser?.id != null && natById.has(dec.loser.id)) out.loseNat = natById.get(dec.loser.id);
  if (dec.save?.id != null && natById.has(dec.save.id)) out.saveNat = natById.get(dec.save.id);
  return out;
}

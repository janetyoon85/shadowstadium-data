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

// 득점자 국적+영문명 조회 — ESPN 팀 로스터를 선수 ID로 캐싱해서 조회(같은 팀은 프로세스 실행
// 1회당 로스터 fetch 1번만). 이름 매칭이 아니라 athletesInvolved[].id ↔ roster[].id 정확 일치라
// 오매칭 위험이 없음(2026-09, EPL 파일럿 검증 후 도입). 매칭 실패 시 undefined — 국적/영문명
// "추측"은 하지 않고 그냥 표시 생략(App.tsx displayTeamName 등과 동일 원칙).
//
// 2026-09-28: displayName도 같이 캐싱 — 득점자(네이버 원문 한글)와 어시스트(ESPN 원문 영문)가
// 같은 선수인데 문자열이 갈라지는 문제(선수 즐겨찾기 알림 매칭 누락)를 해결하려고, 매칭에 성공한
// 득점자의 실제 영문명을 자동으로 축적하는 사전(player-name-auto.json, fetch-schedule.mjs가
// 관리)의 재료로 재사용.
const rosterCache = new Map(); // `${sport}/${slug}/${teamId}` -> Map(athleteId -> {citizenship, displayName})

async function getRoster(sport, slug, teamId) {
  const key = `${sport}/${slug}/${teamId}`;
  if (!rosterCache.has(key)) {
    let map = new Map();
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/teams/${teamId}/roster`);
      if (res.ok) {
        const j = await res.json();
        const items = (j.athletes || []).flatMap((g) => g.items ?? [g]);
        for (const a of items) {
          if (a?.id) map.set(String(a.id), { citizenship: a.citizenship, displayName: a.displayName });
        }
      }
    } catch {
      // 네트워크 실패 등 — 그냥 빈 캐시로 두고 생략(스케줄 수집 자체를 막으면 안 됨)
    }
    rosterCache.set(key, map);
  }
  return rosterCache.get(key);
}

export async function getAthleteNationality(sport, slug, teamId, athleteId) {
  if (!teamId || !athleteId) return undefined;
  const roster = await getRoster(sport, slug, teamId);
  return roster.get(String(athleteId))?.citizenship;
}

export async function getAthleteDisplayName(sport, slug, teamId, athleteId) {
  if (!teamId || !athleteId) return undefined;
  const roster = await getRoster(sport, slug, teamId);
  return roster.get(String(athleteId))?.displayName;
}

// 득점자 국적 조회 — ESPN 팀 로스터를 선수 ID로 캐싱해서 조회(같은 팀은 프로세스 실행 1회당
// 로스터 fetch 1번만). 이름 매칭이 아니라 athletesInvolved[].id ↔ roster[].id 정확 일치라
// 오매칭 위험이 없음(2026-09, EPL 파일럿 검증 후 도입). 매칭 실패 시 undefined — 국적 "추측"은
// 하지 않고 그냥 표시 생략(App.tsx displayTeamName 등과 동일 원칙).
const rosterCache = new Map(); // `${sport}/${slug}/${teamId}` -> Map(athleteId -> citizenship)

export async function getAthleteNationality(sport, slug, teamId, athleteId) {
  if (!teamId || !athleteId) return undefined;
  const key = `${sport}/${slug}/${teamId}`;
  if (!rosterCache.has(key)) {
    let map = new Map();
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/teams/${teamId}/roster`);
      if (res.ok) {
        const j = await res.json();
        const items = (j.athletes || []).flatMap((g) => g.items ?? [g]);
        for (const a of items) {
          if (a?.id && a?.citizenship) map.set(String(a.id), a.citizenship);
        }
      }
    } catch {
      // 네트워크 실패 등 — 그냥 빈 캐시로 두고 국적 생략(스케줄 수집 자체를 막으면 안 됨)
    }
    rosterCache.set(key, map);
  }
  return rosterCache.get(key).get(String(athleteId));
}

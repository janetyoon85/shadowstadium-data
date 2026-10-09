// 네이버가 팀 이름을 영문 그대로(또는 다른 표기로) 내려주는 경우 앱·데이터가 이미 쓰는 정본 표기로 바꾼다(2026-10-10).
// 키는 리그 코드 → { 원문: 정본 }. 리그를 한정하는 이유: "Air Force" 같은 일반 명칭이 다른 대회의 다른 팀일 수 있어서.
// 새로 추가할 때: 정본 표기는 team-logos.json / team-name-en.json 에 이미 있는 이름을 쓸 것(그래야 로고·영문명이 그대로 붙음).
export const TEAM_NAME_CANON = {
  // 이라크 알 쿠와 알 자위야(공군 클럽) — 2026-27 시즌부터 네이버가 "Air Force"로 내려줌(이전엔 "알 쿠와").
  ACL: { 'Air Force': '알 쿠와' },
  ACL2: { 'Air Force': '알 쿠와' },
};

export function canonTeamName(league, name) {
  return TEAM_NAME_CANON[league]?.[name] ?? name;
}

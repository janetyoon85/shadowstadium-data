// 운영 점검(ops-health-check)과 백필 현황 보고(backfill-report)가 같은 제외 기준을 쓰도록 공용화(2026-10-09).
// 2026-10-13: 중국 구장도 좌표 없이 다시 등록(noLocation) — 일반 구장과 같이 백필·누락 점검 대상. 제외 목록은 비워 둔다(import 호환용 export 유지).
export const CHINA_VENUES = new Set();
// 올스타·선발 연합팀은 로고·영문명이 원래 없다 — 점검 제외
export const ALLSTAR_TEAMS = new Set(['드림', '나눔', '퍼시픽리그', '센트럴리그', '아메리칸', '내셔널', 'K리그 XI', '내셔널리그 폴 스타스', '아메리칸리그 폴 스타스']);
// App.tsx NATIONAL_TEAM_LEAGUES 미러 — 국가대표 대회는 국기를 쓰므로 팀 로고 점검 제외. 앱에 새 국가대표 대회를 추가하면 여기도 같이 추가할 것.
export const NATIONAL_LEAGUES = new Set('WORLDCUP AFRICACUP U17WORLDCUP UNL WCQUEFA AMATCHFRIENDLY WCQAFC ASIANCUP U17ASIANCUP U20ASIANCUP U23ASIANCUP WOMENASIANCUP U20WOMENASIANCUP AFFCUP E1MEN E1WOMEN COPAAMERICA UEFAEURO U20WORLDCUP U20WOMENWORLDCUP U17WOMENASIANCUP ASIANGAMESFOOTBALL OLYMPICFOOTBALL WBC PREMIER12 OLYMPICBASEBALL U18BASEBALLWORLDCUP U15BASEBALLWORLDCUP U23BASEBALLWORLDCUP U18ASIANBASEBALL ASIANGAMESBASEBALL'.split(' '));

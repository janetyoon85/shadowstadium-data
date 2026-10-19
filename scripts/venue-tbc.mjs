// 경기장 미정 자리표시(2026-10-19) — 네이버가 경기장을 못 정한 국가대표 경기에 "TBC 중국 PR)", "TBC (Ecuador)", "TBC 페루"처럼 나라마다 다른 이름을 내려준다.
// 나라별로 매핑·구장 등록을 반복하지 않도록, 매핑표에 없는 "TBC…" 라벨은 공용 자리표시 구장(venue_tbc)으로 자동 연결한다(미매핑 알림 없음).
// 매핑표에 이미 있는 라벨(나라별 자리표시 등)은 그쪽이 우선한다.
export const GENERIC_TBC_VENUE_ID = 'venue_tbc';
export const isTbcStadium = (s) => /^\s*TBC\b/i.test(s || '');

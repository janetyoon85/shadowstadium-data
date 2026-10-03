// FCM 토픽 헬퍼. shadowstadium 앱 App.tsx 의 동일 함수와 byte-for-byte 일치해야 함.
// 다르면 서버가 보낸 토픽을 클라이언트가 구독 안 한 셈이 되어 push 가 안 감.
//
// MIRROR SOURCE: shadowstadium/App.tsx (Phase 3 + 4B, "FCM 토픽 허용 문자" 주석 블록).
//   - FCM_GAME_TOPIC_PREFIX
//   - sanitizeTopicSegment
//   - gameTopic
//   - fnv1a32 / playerTopic (즐겨찾기 선수 알림, 2026-09-28)
// 한쪽 바꾸면 반대쪽도 동일하게 바꿀 것.
//
// Phase 4 B: per-user lead — 토픽명에 lead 포함. game_<sanitized-id>_h<L>.
// lead 는 정수(1/3/6/12/24)라 sanitize 불필요, gameId 만 sanitize.

export const FCM_GAME_TOPIC_PREFIX = 'game_';

export function sanitizeTopicSegment(raw) {
  return raw.replace(/[^a-zA-Z0-9\-_.~%]/g, '');
}

export function gameTopic(gameId, leadHours) {
  return FCM_GAME_TOPIC_PREFIX + sanitizeTopicSegment(gameId) + '_h' + leadHours;
}

// 농구 경기 리마인더 다국어(2026-10-03): 앱 언어 접미사 토픽. 접미사 없는 구토픽은 구버전 앱(한국어 문구)용.
export function gameLangTopic(gameId, leadHours, lang) {
  return gameTopic(gameId, leadHours) + '_' + lang;
}

// 선수명(한글/여러 스크립트 혼재)은 FCM 토픽 문자셋([a-zA-Z0-9-_.~%])을 못 지키므로
// 이름 문자열의 UTF-8 바이트에 FNV-1a 32비트 해시를 적용해 ASCII-safe 토픽으로 변환.
// 트랜스리터레이션 대신 해시를 쓰는 이유: 언어별 표기 규칙 없이도 양쪽(App.tsx/.mjs)에서
// 완전히 동일한 결과를 내기 쉬움. 매칭은 이름 문자열 단독(리그/팀 무관)이라 이름이 같으면
// 항상 같은 토픽으로 귀결됨 — 동명이인 시 같은 토픽을 공유하는 것도 사용자가 수용한 리스크.
export const FCM_PLAYER_TOPIC_PREFIX = 'player_';

export function fnv1a32(str) {
  let h = 0x811c9dc5;
  const bytes = Buffer.from(str, 'utf8');
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function playerTopic(name) {
  return FCM_PLAYER_TOPIC_PREFIX + fnv1a32(name);
}

// 언어별 푸시 토픽(2026-10-02): 구독 시 앱 언어 접미사를 붙임. 구버전 앱은 접미사 없는 토픽(한국어 문구) 유지.
export function playerLangTopic(id, lang) {
  return playerTopic(id) + '_' + lang;
}

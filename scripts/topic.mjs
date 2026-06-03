// FCM 토픽 헬퍼. shadowstadium 앱 App.tsx 의 동일 함수와 byte-for-byte 일치해야 함.
// 다르면 서버가 보낸 토픽을 클라이언트가 구독 안 한 셈이 되어 push 가 안 감.
//
// MIRROR SOURCE: shadowstadium/App.tsx (Phase 3 + 4B, "FCM 토픽 허용 문자" 주석 블록).
//   - FCM_GAME_TOPIC_PREFIX
//   - sanitizeTopicSegment
//   - gameTopic
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameTopic, sanitizeTopicSegment, fnv1a32, playerTopic } from '../topic.mjs';

test('sanitizeTopicSegment - FCM 허용 문자([a-zA-Z0-9-_.~%])만 남김', () => {
  assert.equal(sanitizeTopicSegment('K1_2026abc'), 'K1_2026abc');
  assert.equal(sanitizeTopicSegment('가나다'), ''); // 한글은 FCM 토픽 문자셋에 없음 — 전부 제거.
});

test('gameTopic - prefix+sanitize+lead 조합', () => {
  assert.equal(gameTopic('K1_2026abc', 3), 'game_K1_2026abc_h3');
});

test('fnv1a32 - 결정적(같은 입력=같은 출력), 다른 입력=다른 출력', () => {
  assert.equal(fnv1a32('손흥민'), fnv1a32('손흥민'));
  assert.notEqual(fnv1a32('손흥민'), fnv1a32('메시'));
  assert.match(fnv1a32('손흥민'), /^[0-9a-f]{8}$/); // 8자리 hex 고정폭.
});

test('playerTopic - ASCII-safe(App.tsx 쪽과 byte-for-byte 동일해야 함 — 이 함수 자체를 바꾸면 앱도 같이 바꿀 것)', () => {
  const topic = playerTopic('손흥민');
  assert.match(topic, /^player_[0-9a-f]{8}$/);
});

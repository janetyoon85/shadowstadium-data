// 즐겨찾기 선수 알림(2026-09-28) FCM sender — player_<hash> 토픽으로 발송.
// send-reminders.mjs 와 동일 구조(admin 초기화 + 발송 함수만 담당, 감지/dedup은 호출부).
//
// 환경변수: FIREBASE_SERVICE_ACCOUNT — service account JSON 통째 (GH secret, 기존 것과 공용).
// 토픽: playerTopic(name). App.tsx 의 동일 함수와 byte-for-byte 일치 필수(topic.mjs 주석 참조).

import admin from 'firebase-admin';
import { playerTopic } from './topic.mjs';

const NOTIF_CHANNEL_ID = 'player-alerts';

if (admin.apps.length === 0) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export async function sendPlayerEvent(name, { title, body, gameId }) {
  return admin.messaging().send({
    topic: playerTopic(name),
    notification: { title, body },
    data: {
      gameId: String(gameId ?? ''),
      playerName: String(name),
    },
    android: {
      priority: 'high',
      notification: {
        channelId: NOTIF_CHANNEL_ID,
      },
    },
  });
}

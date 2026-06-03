// Phase 4B FCM sender — game-lead topic 으로 reminder push 발송.
// cron 트리거 + "지금 보낼 경기·lead 고르기" 로직은 cron-reminders.mjs 에서 import 해서 호출.
// 이 파일은 sendGame 함수와 admin 초기화만 담당.
//
// 환경변수:
//   FIREBASE_SERVICE_ACCOUNT — service account JSON 통째 (GH secret)
//
// 토픽: gameTopic(gameId, leadHours) = 'game_' + sanitize + '_h' + lead. App.tsx Phase 4B 와 동일.
// FCM data 페이로드는 string-only — 모든 값 String() 처리.
// android.priority = 'high' — 알림 메시지라 즉시 표시 보장.
// android.notification.channelId = 'game-alerts' — App.tsx NOTIF_CHANNEL_ID 와 일치 (HIGH importance 채널).

import admin from 'firebase-admin';
import { gameTopic } from './topic.mjs';

const NOTIF_CHANNEL_ID = 'game-alerts';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export async function sendGame(gameId, leadHours, { title, body, venueId, date, doubleheaderNum }) {
  return admin.messaging().send({
    topic: gameTopic(gameId, leadHours),
    notification: { title, body },
    // gameId 가 클라이언트 라우팅 1순위 (App Link 와 동일 lookup). venueId/date/doubleheaderNum 은
    // gameId 미해석 시 fallback. FCM data 는 string-only — 전부 String() 처리.
    data: {
      gameId: String(gameId),
      venueId: String(venueId),
      date: String(date),
      doubleheaderNum: String(doubleheaderNum ?? ''),
    },
    android: {
      priority: 'high',
      notification: {
        channelId: NOTIF_CHANNEL_ID,
      },
    },
  });
}

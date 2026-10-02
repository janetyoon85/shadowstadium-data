// 즐겨찾기 선수 알림(2026-09-28) FCM sender — player_<hash> 토픽으로 발송.
// send-reminders.mjs 와 동일 구조(admin 초기화 + 발송 함수만 담당, 감지/dedup은 호출부).
//
// 환경변수: FIREBASE_SERVICE_ACCOUNT — service account JSON 통째 (GH secret, 기존 것과 공용).
// 토픽: playerTopic(id). App.tsx 의 동일 함수와 byte-for-byte 일치 필수(topic.mjs 주석 참조).
// id는 고유ID(예: "espn:6327")가 있으면 그걸, 없으면 기존처럼 이름 그대로(2026-09-28, 동명이인
// 분리 — "고유id로해야겠네" 요청. id가 이름 그대로인 경우는 이전과 완전히 동일한 토픽이라
// 기존에 이름으로 즐겨찾기해둔 구독도 그대로 유지됨, 하위호환 무마이그레이션).

import admin from 'firebase-admin';
import { playerTopic, playerLangTopic } from './topic.mjs';

const NOTIF_CHANNEL_ID = 'player-alerts';

if (admin.apps.length === 0) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const msg = (topic, { title, body }, gameId, displayName, id) => ({
  topic,
  notification: { title, body },
  data: { gameId: String(gameId ?? ''), playerName: String(displayName ?? id) },
  android: { priority: 'high', notification: { channelId: NOTIF_CHANNEL_ID } },
});

// byLang: { [lang]: {title, body} } — 언어별 토픽으로 각각 발송. 접미사 없는 토픽은 구버전 앱용(한국어).
export async function sendPlayerEvent(id, { title, body, gameId, displayName, byLang }) {
  const jobs = [admin.messaging().send(msg(playerTopic(id), { title, body }, gameId, displayName, id))];
  for (const [lang, t] of Object.entries(byLang || {})) {
    jobs.push(admin.messaging().send(msg(playerLangTopic(id, lang), t, gameId, displayName, id)));
  }
  const res = await Promise.allSettled(jobs);
  if (res.every((r) => r.status === 'rejected')) throw res[0].reason;
}

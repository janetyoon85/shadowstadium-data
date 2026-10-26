// firebase-admin 모듈식(modular) API 호환 모듈 — `import admin from 'firebase-admin'`(레거시 네임스페이스)을 대체한다.
// 이유(2026-10-26): firebase-admin 14 는 레거시 네임스페이스(admin.messaging(), admin.credential.cert, admin.apps, admin.initializeApp)를 삭제했다.
// 이 모듈은 13 에서도 14 에서도 동작하는 모듈식 API(firebase-admin/app, firebase-admin/messaging)로 같은 모양을 제공해,
// 호출부(알림 스크립트들)는 import 한 줄만 바꾸면 된다. 사용하는 표면: apps.length, initializeApp, credential.cert, messaging().send, unsubscribeFromTopic.
import { initializeApp, getApps, cert, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const admin = {
  apps: {
    get length() {
      return getApps().length;
    },
  },
  initializeApp,
  credential: { cert },
  messaging: () => getMessaging(),
};

// 토픽 구독 해제 — firebase-admin 14 의 SDK 구현은 다른 API(googlecloudmessaging)를 쓰며 서비스 계정에 없는 권한
// (cloudmessaging.topicSubscriptions.delete)을 요구해 실패했다(2026-10-26 CI 스모크 실측). 13 까지 쓰던 IID 엔드포인트
// (iid.googleapis.com batchRemove)는 여전히 정상 응답하므로, SDK 가 인증 오류를 내면 그 방식으로 폴백한다. 반환은 SDK 와 같은 {successCount, failureCount, errors}.
export async function unsubscribeFromTopic(tokens, topic) {
  const res = await getMessaging().unsubscribeFromTopic(tokens, topic);
  const authFailed = res.failureCount > 0 && (res.errors || []).some((e) => e?.error?.code === 'messaging/authentication-error');
  if (!authFailed) return res;
  const at = await getApp().options.credential.getAccessToken();
  const r = await fetch('https://iid.googleapis.com/iid/v1:batchRemove', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at.access_token, 'Content-Type': 'application/json', access_token_auth: 'true' },
    body: JSON.stringify({ to: '/topics/' + topic, registration_tokens: tokens }),
  });
  if (!r.ok) throw new Error('IID batchRemove HTTP ' + r.status);
  const results = (await r.json()).results || [];
  const errors = [];
  results.forEach((x, index) => { if (x && x.error) errors.push({ index, error: { code: 'messaging/' + String(x.error).toLowerCase().replace(/_/g, '-'), message: x.error } }); });
  return { successCount: tokens.length - errors.length, failureCount: errors.length, errors };
}

export default admin;

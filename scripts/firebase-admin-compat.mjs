// firebase-admin 모듈식(modular) API 호환 모듈 — `import admin from 'firebase-admin'`(레거시 네임스페이스)을 대체한다.
// 이유(2026-10-26): firebase-admin 14 는 레거시 네임스페이스(admin.messaging(), admin.credential.cert, admin.apps, admin.initializeApp)를 삭제했다.
// 이 모듈은 13 에서도 14 에서도 동작하는 모듈식 API(firebase-admin/app, firebase-admin/messaging)로 같은 모양을 제공해,
// 호출부(알림 스크립트들)는 import 한 줄만 바꾸면 된다. 사용하는 표면: apps.length, initializeApp, credential.cert, messaging().send/unsubscribeFromTopic.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
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

export default admin;

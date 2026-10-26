import test from 'node:test';
import assert from 'node:assert/strict';
import admin from '../firebase-admin-compat.mjs';

test('호환 모듈이 알림 스크립트가 쓰는 표면을 모두 제공한다', () => {
  assert.equal(typeof admin.initializeApp, 'function');
  assert.equal(typeof admin.credential.cert, 'function');
  assert.equal(typeof admin.messaging, 'function');
  assert.equal(typeof admin.apps.length, 'number');
});

test('초기화 전에는 apps.length 가 0 — 스크립트의 "이미 초기화됐나" 검사가 그대로 동작', () => {
  assert.equal(admin.apps.length, 0);
});

test('잘못된 서비스 계정은 cert() 가 즉시 오류 — 조용히 통과하지 않는다', () => {
  assert.throws(() => admin.credential.cert({ project_id: 'x' }));
});

test('초기화 없이 messaging() 은 오류(앱이 없음)', () => {
  assert.throws(() => admin.messaging());
});

test('토픽 구독 해제 헬퍼를 내보낸다(v14 SDK 권한 문제 폴백 포함)', async () => {
  const mod = await import('../firebase-admin-compat.mjs');
  assert.equal(typeof mod.unsubscribeFromTopic, 'function');
});

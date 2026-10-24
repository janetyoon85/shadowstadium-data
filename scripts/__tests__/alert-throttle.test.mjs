import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertWebhook } from '../alert-throttle.mjs';

const at = (h, m) => new Date(Date.UTC(2026, 9, 25, h, m));
test('TEST_DISCORD="false" 문자열은 스로틀을 우회하지 않는다', () => {
  const env = { DISCORD_WEBHOOK_URL: 'https://w', TEST_DISCORD: 'false' };
  assert.equal(alertWebhook(env, at(3, 9)), undefined);
  assert.equal(alertWebhook(env, at(6, 1)), 'https://w');
});
test('TEST_DISCORD="true"·ALERT_FORCE 는 즉시 발송', () => {
  assert.equal(alertWebhook({ DISCORD_WEBHOOK_URL: 'https://w', TEST_DISCORD: 'true' }, at(3, 9)), 'https://w');
  assert.equal(alertWebhook({ DISCORD_WEBHOOK_URL: 'https://w', ALERT_FORCE: '1' }, at(3, 9)), 'https://w');
});
test('웹훅이 없으면 항상 비운다', () => assert.equal(alertWebhook({}, at(6, 0)), undefined));

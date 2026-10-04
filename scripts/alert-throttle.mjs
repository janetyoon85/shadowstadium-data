// 크롤러 Discord 알림 스로틀 — 2분 주기 크롤러가 같은 알림을 매번 보내던 문제. UTC 0/6/12/18시 정각 3분 창에서만 발송.
// TEST_DISCORD / ALERT_FORCE 설정 시 즉시 발송.
export function alertWebhook() {
  const w = process.env.DISCORD_WEBHOOK_URL;
  if (!w || process.env.TEST_DISCORD || process.env.ALERT_FORCE) return w;
  const d = new Date();
  return d.getUTCHours() % 6 === 0 && d.getUTCMinutes() < 3 ? w : undefined;
}

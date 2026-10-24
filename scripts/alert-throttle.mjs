// 크롤러 Discord 알림 스로틀 — 2분 주기 크롤러가 같은 알림을 매번 보내던 문제. UTC 0/6/12/18시 정각 3분 창에서만 발송.
// TEST_DISCORD / ALERT_FORCE 가 'true'·'1' 일 때만 즉시 발송.
// 2026-10-25: 워크플로가 TEST_DISCORD 를 "false" 문자열로 넘겨서 `!!env` 검사가 항상 참이 되어 6시간 창이 통째로 우회되고 있었다(10분마다 알림) — 문자열 값을 해석한다.
const on = (v) => /^(true|1|yes)$/i.test(String(v || '').trim());
export function alertWebhook(env = process.env, now = new Date()) {
  const w = env.DISCORD_WEBHOOK_URL;
  if (!w || on(env.TEST_DISCORD) || on(env.ALERT_FORCE)) return w;
  return now.getUTCHours() % 6 === 0 && now.getUTCMinutes() < 3 ? w : undefined;
}

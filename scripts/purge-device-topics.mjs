// 한 기기(FCM 토큰)의 "남은 예전 언어 구독"을 서버에서 직접 해제한다(2026-10-12 — 앱의 해제 호출이 효과가 없어 황성빈 알림이 5개 언어로 계속 옴).
// FCM 은 클라이언트가 구독 목록을 조회할 수 없지만 서버는 IID 정보 API(rel.topics)로 한 토큰의 구독 토픽 목록을 읽고,
// Admin SDK 의 unsubscribeFromTopic 으로 개별 해제할 수 있다. KEEP_LANG(기본 ko)와 다른 언어 접미사·언어 없는 옛 토픽을 해제한다.
// 사용: workflow fcm-purge-device 에 토큰을 입력(마스킹됨). 앱 설정 제목을 길게 눌러 공유한 메시지에 토큰이 들어 있다.
import admin from 'firebase-admin';

const token = (process.env.FCM_TOKEN || '').trim();
const keep = process.env.KEEP_LANG || 'ko';
const dry = process.env.DRY_RUN === '1';
if (!token) { console.error('FCM_TOKEN required'); process.exit(1); }
const LANGS = new Set(['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-Hans', 'zh-Hant', 'hi', 'tr', 'nl']);

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const cred = admin.credential.cert(serviceAccount);
admin.initializeApp({ credential: cred });

const at = await cred.getAccessToken();
const res = await fetch(`https://iid.googleapis.com/iid/info/${encodeURIComponent(token)}?details=true`, {
  headers: { Authorization: `Bearer ${at.access_token}`, access_token_auth: 'true' },
});
console.log('IID info status', res.status);
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error('IID info failed:', JSON.stringify(body).slice(0, 300)); process.exit(1); }
const topics = Object.keys(body.rel?.topics || {});
console.log(`subscribed topics: ${topics.length}`);
const suffixLang = (t) => { const i = t.lastIndexOf('_'); const l = i < 0 ? '' : t.slice(i + 1); return LANGS.has(l) ? l : ''; };
const toRemove = [];
const keepers = [];
for (const t of topics) {
  const l = suffixLang(t);
  // 언어 접미사가 있는데 KEEP_LANG 가 아니거나, 선수/경기/팀종료 토픽인데 언어 접미사가 아예 없는 옛 토픽
  if (l && l !== keep) toRemove.push(t);
  else if (!l && /^(player|game|tfinal)_/.test(t)) toRemove.push(t);
  else keepers.push(t);
}
console.log(`keep ${keepers.length}, remove ${toRemove.length}${dry ? ' (dry run)' : ''}`);
for (const t of toRemove.slice(0, 60)) console.log('  -', t);
if (!dry) {
  let ok = 0, fail = 0;
  for (const t of toRemove) {
    try { const r = await admin.messaging().unsubscribeFromTopic([token], t); r.failureCount ? fail++ : ok++; } catch (e) { fail++; console.error('unsubscribe failed', t, e.message); }
  }
  console.log(`unsubscribed ok=${ok} fail=${fail}`);
}
process.exit(0);

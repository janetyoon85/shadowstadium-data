import { sendPlayerEvent } from './send-player-alert.mjs';

// 즐겨찾기 선수 알림 수신 테스트. 기본은 "어느 언어 토픽을 구독 중인지" 진단용 — 언어별로 제목에 언어 코드를 붙여 모든 언어로 보낸다(tag 없음: 구독 중인 언어 수만큼 따로 보임).
// USE_TAG=1 이면 모든 언어에 같은 tag 를 붙여 보낸다 — 한 기기에 여러 언어 구독이 남아 있어도 알림이 하나로 합쳐지는지 확인.
const name = process.env.PLAYER_NAME;
if (!name) { console.error('PLAYER_NAME required'); process.exit(1); }
const LANGS = ['ko', 'en', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-Hans', 'zh-Hant', 'hi', 'tr', 'nl'];
const useTag = process.env.USE_TAG === '1';
const stamp = new Date().toISOString().slice(11, 19);
const byLang = Object.fromEntries(LANGS.map((l) => [l, { title: `⚾ ${name} 테스트 [${l}] ${stamp}`, body: useTag ? '합치기(tag) 테스트' : '언어 구독 진단 테스트' }]));
await sendPlayerEvent(name, { title: byLang.ko.title, body: byLang.ko.body, gameId: '', displayName: name, byLang, tag: useTag ? `test_${name}` : undefined });
console.log('sent', name, useTag ? 'with tag' : 'no tag (diagnostic)');
process.exit(0);

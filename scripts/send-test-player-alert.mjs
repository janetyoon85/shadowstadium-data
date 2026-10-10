import { sendPlayerEvent } from './send-player-alert.mjs';

const name = process.env.PLAYER_NAME;
if (!name) { console.error('PLAYER_NAME required'); process.exit(1); }
const id = await sendPlayerEvent(name, { title: `⚾ ${name} 테스트 알림!`, body: '즐겨찾기 선수 알림 수신 테스트', gameId: '', displayName: name, byLang: { ko: { title: `⚾ ${name} 테스트 알림!`, body: '즐겨찾기 선수 알림 수신 테스트' } } });
// byLang: 앱은 구독을 언어별 토픽(playerLangTopic)으로 옮겼고 접미사 없는 구토픽은 해제하므로 언어 토픽으로도 보내야 도달한다.
console.log('sent', id);
process.exit(0);

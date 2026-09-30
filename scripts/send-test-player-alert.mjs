import { sendPlayerEvent } from './send-player-alert.mjs';

const name = process.env.PLAYER_NAME;
if (!name) { console.error('PLAYER_NAME required'); process.exit(1); }
const id = await sendPlayerEvent(name, { title: `⚾ ${name} 테스트 알림!`, body: '즐겨찾기 선수 알림 수신 테스트', gameId: '', displayName: name });
console.log('sent', id);
process.exit(0);

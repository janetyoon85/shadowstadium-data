// 429 감지·기록·알림 경로 시험용(수동): 로컬 서버가 429 를 돌려주게 해 watch-429 가 ops-logs 에 기록하는지 확인한다.
// rate-limit-alert 워크플로우를 simulate=true 로 실행하면 이 시뮬레이션 → 보고(Discord) 순서로 돈다.
import './lib/watch-429.mjs';
import http from 'node:http';

const srv = http.createServer((q, r) => { r.statusCode = 429; r.end('slow down'); });
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const port = srv.address().port;
for (let i = 0; i < 2; i++) console.log('시뮬레이션 응답', (await fetch(`http://127.0.0.1:${port}/simulate?key=SECRET${i}`)).status);
srv.close();

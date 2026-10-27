// 네이버 API 연결 호환 스위치(2026-10-27). NAVER_TLS12=1 이면 이 프로세스의 TLS 최대 버전을 1.2 로 제한한다.
// 실측: 집 PC 에서 Node 기본(TLS1.3·AES_256 협상)은 핸드셰이크 뒤 응답이 오지 않고 멈추는데(14개 서버 IP 전부),
// TLS1.2 로 제한하면 정상 응답(200)이 온다. curl 은 원래 정상. 헤더·UA 는 건드리지 않는다(정직한 UA 유지) — 암호 협상 방식만 바꾼다.
// 기본 꺼짐(미설정). 켜는 곳: 크롤러 워크플로우 env / 폴러 compose env.
import tls from 'node:tls';

export const naverTls12Enabled = process.env.NAVER_TLS12 === '1';
if (naverTls12Enabled) tls.DEFAULT_MAX_VERSION = 'TLSv1.2';

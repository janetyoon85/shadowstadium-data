# NAS 라이브 폴러 (2026-10-27)

앱 라이브 점수 지연을 줄이는 3단 구조의 마지막 단.

| 단 | 경로 | 지연 |
|---|---|---|
| 기본 | 크롤러 → git → GitHub raw → 앱 | 약 3분(raw 가 저장소보다 1~1.5분 늦음) |
| 느린 빠른 경로 | 크롤러 종료 → `publish-live-*.yml`(GitHub 서버) → RTDB `live/basketball`·`live/games` → 앱 | 약 1~1.5분 |
| **빠른 경로(이 문서)** | NAS `live-daemon` 이 15~20초 주기로 크롤링 → RTDB `live/basketball_fast`·`live/games_fast` → 앱 | 약 20~40초 |

앱(`BK_LIVE_DB_URL`)은 `live.json` 한 번으로 둘 다 받아 **빠른 경로가 90초 안에 갱신됐고 더 최신이면** 그 값을, 아니면 느린 경로 값을 쓴다. NAS 가 멈추면 자동으로 느린 경로로 돌아간다.

## 구성
- `scripts/live-daemon.mjs` — 상시 루프. 농구(`fetch-basketball.mjs`), 네이버 일정(`LIVE_ONLY=1 fetch-schedule.mjs`), ESPN 축구 39개 리그·MLB 마이너·윈터리그(각 크롤러의 `LIVE_ONLY` 모드)를 진행/곧 시작 경기가 있을 때만 돌리고, 429/403 이면 해당 소스를 5분 쉰다(Discord 알림은 선택).
- `fetch-schedule.mjs` 의 `LIVE_ONLY=1` — 라이브 가능한 카테고리만, 어제~모레 범위만 조회(수 초). 저장·알림·병합 없이 `live-snapshot.json` 만 남긴다. 구장 매핑(비공개 저장소 토큰)이 필요 없다.
- `docker/shadeside-live-poller.yml` — Container Manager 프로젝트 정의(이미지 `node:22-bookworm-slim`, 시작 시 공개 저장소 클론).
- 쓰기 권한은 RTDB 전용 비밀키(`FIREBASE_DB_SECRET`, REST `?auth=`). 서비스 계정(푸시 발송 가능)이 NAS 에 가지 않는다.

## 운영
- 로그(Container Manager > 컨테이너 > 로그): `일정 N경기 게시`, `농구 N경기 게시`, `동작 중 (…)`. 경기가 없으면 로그가 조용하다(정상).
- 비밀키 교체: 프로젝트 설정에서 새 키를 받아 compose 의 `FIREBASE_DB_SECRET` 을 바꾸고 프로젝트를 다시 시작.
- 문제 시: 컨테이너를 멈추면 앱이 느린 경로로 돌아간다(다른 조치 불필요).
- 네이버/ESPN 요청량: 경기가 있을 때만, 일정은 라이브 카테고리 1~3개·어제~모레 범위라 GitHub 1분 주기(전체 65카테고리)보다 요청이 적다.

## 자동 갱신
- 데몬은 15분마다 저장소를 최신으로 맞추고, 자신의 코드(`live-daemon.mjs`, `lib/live-*`)가 바뀌었으면 스스로 종료한다 → 컨테이너가 다시 떠서 새 코드를 받는다(사람이 NAS 를 만질 필요 없음).
- **적용 범위(2026-10-27 확정)**: 농구 전체 / 네이버 일정(KBO·K리그·MLB·NPB·유럽 주요 리그 등) / ESPN 축구 39개 리그(`fetch-espn-soccer-leagues`·`-world-`·`-asia-`) / MLB 마이너·윈터리그 / 올림픽 축구 / ESPN 야구(WBC·카리브시리즈·올림픽 야구) / 아시안게임 야구·축구. 각 크롤러가 `LIVE_ONLY=1` 로 활성 리그만 어제~내일 범위로 조회한다.
- **WBSC(`fetch-wbsc-baseball`)도 적용(2026-10-27)**: 예전엔 WBSC 계열 사이트가 GitHub 서버(데이터센터 IP)를 막아 유료 프록시(ScraperAPI, 무료 월 1,000건)를 썼다. 집 회선(NAS·PC)에서는 막지 않아(7개 도메인 실측 200) **프록시 없이 직접** 받는다 — 라이브 전용 모드와 일반 워크플로우(`runs-on: home-crawler`, `SCRAPERAPI_KEY` 미전달) 모두. **페일오버(2026-10-27)**: 직접 요청이 403/429/오류로 막히면 `SCRAPERAPI_KEY`(워크플로우에 연결됨)로 그 요청만 프록시 우회한다(월 900건 예산, 결제일 19일). 라이브 전용(NAS)은 직접만.
  - **페일오버 알림(Discord 🟠)이 오면 수동 조치**: cron-job.org 에서 **1분 주기 작업 → 2분**, **WBSC 작업 → 3시간 주기**로 바꿔 프록시 예산을 아낀다. 직접 요청이 풀리면(알림이 멈추면) 원래 주기로 복구.

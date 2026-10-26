# 집 PC 셀프호스트 러너 (네이버 API 차단 대응)

2026-10-26 09:14(UTC)부터 네이버 API 게이트웨이(`api-gw.sports.naver.com`)가 GitHub 호스티드 러너(Azure IP)의 요청에 응답하지 않아(연결은 되고 응답이 없음), 네이버에 의존하는 워크플로우를 집 PC 러너에서 돌린다.

## 구성
- 러너 3개(`home-pc-1~3`, 라벨 `home-crawler`) — `D:\actions-runner\r1~r3`. 동시에 3개 작업(일정·농구·순위표 등)이 돈다.
- 대상 워크플로우(`runs-on: ${{ vars.CRAWLER_RUNNER || 'ubuntu-latest' }}`, bash 셸): `fetch-schedule`, `fetch-basketball`, `fetch-basketball-stats`, `fetch-standings`, `backfill-baseball-pids`.
- **자동 페일오버(pick-runner.yml):** 각 실행 맨 앞에서 GitHub 서버가 네이버 API 에 응답하는지 8초 안에 확인해, 응답하면 `ubuntu-latest`, 아니면 `home-crawler`(집 PC)에서 본 작업을 돌린다. 네이버가 풀리면 사람이 아무것도 안 해도 GitHub 서버로 돌아간다.
- 저장소 변수 `CRAWLER_RUNNER`: 비어 있거나 `auto` 면 위 자동 선택, `home-crawler` / `ubuntu-latest` 로 두면 그 러너로 고정(수동 전환용).
- 러너 시작: 로그온 시 `shell:startup\ShadeSideRunners.vbs` 가 3개를 띄운다(PATH 에 Git bash·node 포함 — 이게 없으면 "bash: command not found").

## 운영 메모
- PC 가 꺼지거나 잠자기면 크롤이 멈춘다(AC 전원 잠자기 안 함으로 확인됨).
- 러너 프로세스를 강제로 끄면 진행 중이던 실행이 "진행 중"으로 남아 같은 워크플로우의 다음 실행을 막는다(concurrency). 그때는 `POST /actions/runs/{id}/force-cancel`.
- 공개 저장소이므로 이 러너를 쓰는 워크플로우에는 `pull_request` 트리거를 절대 넣지 않는다(`test.yml` 은 GitHub 서버에서만).
- 복구 알림: `naver-recovery-watch.yml` 이 30분마다 GitHub 서버→네이버 응답을 보고, 돌아오면 Discord 로 한 번 알린 뒤 스스로 꺼진다.
- 한계: 집 PC 가 꺼져 있고 동시에 네이버가 GitHub 서버를 막고 있으면 작업이 대기열에 쌓인다(두 경로 모두 불가).

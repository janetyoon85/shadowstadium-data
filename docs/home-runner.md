# 집 PC·NAS 셀프호스트 러너 (네이버 API 차단 대응)

2026-10-26 09:14(UTC)부터 네이버 API 게이트웨이(`api-gw.sports.naver.com`)가 GitHub 호스티드 러너(Azure IP)의 요청에 응답하지 않아(연결은 되고 응답이 없음), 네이버에 의존하는 워크플로우를 집 PC 러너에서 돌린다.

## 구성
- **우선순위: GitHub 서버 → NAS → PC.** 네이버가 GitHub 서버에서 응답하면 GitHub 서버, 아니면 NAS 러너(`nas` 라벨)가 온라인일 때 NAS, NAS 가 모두 꺼져 있으면 `home-crawler`(PC).
  NAS 온라인 확인은 secret `RUNNER_STATUS_TOKEN`(이 저장소 Administration:read 만 가진 fine-grained 토큰, 만료일 주의)으로 한다. 토큰이 없거나 만료면 "집 러너 아무나"로 폴백.
- **NAS 러너 3개**(`nas-1~3`, 라벨 `home-crawler,nas`) — Synology SA6400 Container Manager 프로젝트 `shadeside-runner`(이미지 myoung34/github-runner). compose 의 `RUNNER_TOKEN` 은 1시간짜리 등록 토큰이라, 컨테이너를 새로 만들 때마다 `POST /repos/{repo}/actions/runners/registration-token` 으로 새로 받아 넣는다.
- 러너 3개(`home-pc-1~3`, 라벨 `home-crawler`) — `D:\actions-runner\r1~r3`. 동시에 3개 작업(일정·농구·순위표 등)이 돈다.
- 대상 워크플로우(`runs-on: ${{ vars.CRAWLER_RUNNER || 'ubuntu-latest' }}`, bash 셸): `fetch-schedule`, `fetch-basketball`, `fetch-basketball-stats`, `fetch-standings`, `backfill-baseball-pids`.
- **자동 페일오버(pick-runner.yml):** 각 실행 맨 앞에서 GitHub 서버가 네이버 API 에 응답하는지 8초 안에 확인해, 응답하면 `ubuntu-latest`, 아니면 `home-crawler`(집 PC)에서 본 작업을 돌린다. 네이버가 풀리면 사람이 아무것도 안 해도 GitHub 서버로 돌아간다.
- 저장소 변수 `CRAWLER_RUNNER`: 비어 있거나 `auto` 면 위 자동 선택, `home-crawler` / `ubuntu-latest` 로 두면 그 러너로 고정(수동 전환용).
- 러너 시작: 로그온 시 `shell:startup\ShadeSideRunners.vbs` 가 3개를 띄운다(PATH 에 Git bash·node 포함 — 이게 없으면 "bash: command not found").

## 운영 메모
- PC 가 꺼지거나 잠자기면 크롤이 멈춘다(AC 전원 잠자기 안 함으로 확인됨).
- 러너 프로세스를 강제로 끄면 진행 중이던 실행이 "진행 중"으로 남아 같은 워크플로우의 다음 실행을 막는다(concurrency). 그때는 `POST /actions/runs/{id}/force-cancel`.
- 외부 기여자 PR 승인 정책은 "모든 외부 기여자"(all_external_contributors)로 올려 두었다.
- 공개 저장소이므로 이 러너를 쓰는 워크플로우에는 `pull_request` 트리거를 절대 넣지 않는다(`test.yml` 은 GitHub 서버에서만).
- 복구 알림: `naver-recovery-watch.yml` 이 30분마다 GitHub 서버→네이버 응답을 보고, 돌아오면 Discord 로 한 번 알린 뒤 스스로 꺼진다.
- 한계: 집 PC 가 꺼져 있고 동시에 네이버가 GitHub 서버를 막고 있으면 작업이 대기열에 쌓인다(두 경로 모두 불가).

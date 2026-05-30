# Schedule crawler

Naver Sports API → `games_2026.json` 자동 갱신 스크립트.

## 구성

- `fetch-schedule.mjs` — 메인 크롤러. KBO + K리그1 + K리그2 시즌 일정 fetch → 변환 → validate → prod 갱신
- `naverStadiumMap.json` — Naver `stadium` 텍스트 → 우리 `venueId` lookup table (categoryId별)
- `validators.mjs` — staging dataset 유효성 검사 (필드·게임수·중복·doubleheader)
- `staging.json` — (gitignored) 매 실행마다 덮어쓰는 raw 변환 결과 + 메타데이터

## 실행

### 로컬
```bash
node scripts/fetch-schedule.mjs
```
요구: Node 18+ (native `fetch`).

### CI (GitHub Actions)
[.github/workflows/fetch-schedule.yml](../.github/workflows/fetch-schedule.yml)에서 매일 03:00 KST 자동 실행. `GITHUB_TOKEN`은 워크플로에 의해 자동 주입(`permissions.contents: write`)되므로 commit + push도 자동.

수동 트리거: GitHub Actions 탭 → "Daily Schedule Fetch" → "Run workflow".

## 동작

1. 시즌 범위 `2026-03-01 ~ 2026-11-30` 고정
2. 카테고리 3개 (`kbo` / `kleague` / `kleague2`) 순차 fetch, 페이지당 200건, 페이지 간 1.1초 대기
3. Naver 응답 → `OfficialGame` 스키마 변환
4. 같은 `(date, stadium, home, away)` 그룹 크기 2 → 시간순 `doubleheaderNum: 1, 2` 부여
5. `staging.json` 저장 (디버깅용)
6. `validators.mjs` 통과 시만 `../games_2026.json` 덮어씀
7. 매핑 실패 stadium 게임은 prod에서 **자동 필터링** (warning 로그만, 갱신은 진행). 시범경기 임시 venue (마산, 이천(두산) 등)는 의도적 누락

## 종료 코드

- `0` — 성공 (`games_2026.json` 갱신됨, 매핑 누락 게임은 제외)
- `1` — validator 실패 (필수 필드·게임 수·gameId 중복)

## 매핑 실패 처리

새 stadium 텍스트가 Naver에 나타나면 (시즌 중 임시 홈구장 등):

1. 크롤러 실행 → `[mapping failures]` 로그 확인
2. `naverStadiumMap.json`의 해당 `categoryId` 섹션에 `"<텍스트>": "<venueId>"` 추가
3. 재실행

`venueId`는 [shadowstadium/App.tsx](https://github.com/janetyoon85/shadowstadium/blob/main/App.tsx)의 `VENUES` 배열 참고. 없는 venue면 앱 쪽에 venue 정의를 먼저 추가.

## Validator 임계값 (현재)

- KBO ≥ 500 게임
- K리그1 ≥ 150 게임
- K리그2 ≥ 200 게임

시즌 후반(11월) 이후엔 향후 일정이 적어질 수 있음 — 임계값은 보수적으로 설정 (`validators.mjs` `MIN_COUNTS`).

## 다음 단계

- B-5c: GitHub Actions cron 자동 실행
- B-5d: `rescheduledTo` 추론 (cancel된 매치업 + 후일 doubleheader 자동 link)

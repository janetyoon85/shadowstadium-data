# shadowstadium-data

ShadowStadium 앱의 공개 일정 데이터.

## URL
https://raw.githubusercontent.com/janetyoon85/shadowstadium-data/main/games_2026.json

## 자동 갱신
**매일 03:00 KST**에 GitHub Actions가 네이버 스포츠 API에서 KBO + K리그 일정을 fetch해서 자동 commit + push합니다 (`chore(data): daily schedule sync ...`).

- 워크플로: [.github/workflows/fetch-schedule.yml](.github/workflows/fetch-schedule.yml)
- 크롤러: [scripts/fetch-schedule.mjs](scripts/fetch-schedule.mjs)
- 수동 실행: GitHub Actions 탭 → "Daily Schedule Fetch" → "Run workflow"

실패 시 자동으로 Issue가 생성됩니다 (labels: `bug`, `crawler`).

## 수동 편집
긴급 수정이 필요한 경우 파일 직접 수정 + commit + push. 단 다음 cron 실행 때 덮어쓰일 수 있으니, 매핑이나 크롤러 로직 변경이 필요한 사항이면 [scripts/](scripts/)을 손볼 것.

## 스키마
`OfficialGame[]` (자세한 필드는 [shadowstadium/App.tsx](https://github.com/janetyoon85/shadowstadium/blob/main/App.tsx)의 `OfficialGame` 타입 참고).

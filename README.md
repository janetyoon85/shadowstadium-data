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

### `manual_games.json` — 크롤러가 못 가져오는 경기 (올스타전 등)
네이버 API에 아직 publish 안 된 경기 (예: KBO 올스타전, 시즌 중 즉석 추가된 이벤트)는 [manual_games.json](manual_games.json)에 추가하면 cron마다 자동 merge됩니다.

- 형식: `games_2026.json`과 동일 스키마 배열
- Dedup 키: **`(date+venueId+league)`** — 네이버가 추후 같은 슬롯을 자체 gameId로 publish 하면 크롤링 데이터가 우선 채택되고 manual 엔트리는 자동으로 빠집니다 (중복 2건 안 생김)
- 한계: 같은 (date+venueId+league) 슬롯에 더블헤더처럼 정상적으로 2경기가 있는 경우엔 부적합. manual은 단발 이벤트용
- gameId는 유니크해야 하며 `[a-zA-Z0-9\-_.~%]+` 만 허용 (앱의 App Links 정규식)

## 스키마
`OfficialGame[]` (자세한 필드는 [shadowstadium/App.tsx](https://github.com/janetyoon85/shadowstadium/blob/main/App.tsx)의 `OfficialGame` 타입 참고).

## 공개 페이지 (GitHub Pages)
- 랜딩: https://janetyoon85.github.io/shadowstadium-data/
- 개인정보처리방침: https://janetyoon85.github.io/shadowstadium-data/privacy-policy.html

활성화: GitHub Settings → Pages → Source: `main` branch / `/docs` folder.

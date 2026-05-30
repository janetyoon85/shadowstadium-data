# Schedule crawler

Naver Sports API → `games_2026.json` 자동 갱신 스크립트.

## 구성

- `fetch-schedule.mjs` — 메인 크롤러. KBO + K리그1 + K리그2 시즌 일정 fetch → 변환 → validate → prod 갱신
- `infer-rescheduled.mjs` — B-5d. cancelled 게임 → 미래 doubleheader 2차전 자동 매칭하여 `rescheduledTo` 채움
- `naverStadiumMap.json` — Naver `stadium` 텍스트 → 우리 `venueId` lookup table (categoryId별)
- `validators.mjs` — staging dataset 유효성 검사 (필드·게임수·중복·doubleheader·rescheduledTo orphan)
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

## B-5d: rescheduledTo 자동 추론 (`infer-rescheduled.mjs`)

Naver API는 "이 cancelled가 어느 doubleheader로 보강됐는지" 직접 링크를 주지 않음. 추론 스크립트가 패턴 매칭으로 채움.

### 매칭 규칙

각 `status='cancelled'` 게임에 대해:
- 같은 (home, away, league)
- doubleheaderNum=2 인 게임만 후보
- 취소일 + 1일 ~ + 30일 사이
- 후보 중 가장 가까운 날짜 채택

### 신뢰도 등급

| 등급 | 조건 | 처리 |
|---|---|---|
| **HIGH** | 후보 1개 + 동일 venue + ≤7일 | 자동 적용, silent |
| **MEDIUM** | 후보 1개 + 동일 venue + 7-15일 | 자동 적용, silent |
| **LOW** | 후보 1개 + 16-30일 OR venue 다름 | 자동 적용, **stdout warning** |
| **AMBIGUOUS** | 후보 2개 이상 | 가장 가까운 채택, **stdout warning** + alternatives 기록 |
| (unmatched) | 후보 0개 | rescheduledTo 비움 |

### 사용

```bash
# 적용 (prod 덮어쓰기)
node scripts/infer-rescheduled.mjs

# 미리보기 (파일 수정 X)
node scripts/infer-rescheduled.mjs --dry-run

# 전체 로그 (모든 매칭 시도)
node scripts/infer-rescheduled.mjs --verbose

# dry-run + verbose 조합 권장 (확인용)
node scripts/infer-rescheduled.mjs --dry-run --verbose
```

### 매번 fresh matching

매 실행마다 모든 cancelled의 rescheduledTo를 재계산. 기존 값도 덮어쓰기. 비-cancelled에 잘못 채워진 값은 자동 삭제.

### 출력

stdout JSON 요약:
```json
{
  "totalCancelled": 81,
  "matched": { "HIGH": 60, "MEDIUM": 15, "LOW": 4, "AMBIGUOUS": 2 },
  "unmatched": 0,
  "warnings": [...],
  "changedCount": 81,
  "dryRun": false
}
```

Exit: `0` 정상, `1` JSON 손상 등 fatal.

### 디버깅: unmatched 케이스

매칭 안 된 cancelled는:
- 보강이 30일 윈도우 밖 (드물지만 시즌 후반에 발생 가능)
- 보강이 아직 일정에 안 잡힘 (Naver 미반영)
- 매치업이 다른 venue로 옮겨감 (현 매칭은 venue 다름도 LOW로 매칭하므로 거의 X)
- 무관(데이터 오류 등)

`--verbose`로 unmatched 리스트 확인 후 수동 검증.

### 워크플로 통합

[.github/workflows/fetch-schedule.yml](../.github/workflows/fetch-schedule.yml)에서 fetch 직후 자동 실행:

```yaml
- name: Run crawler
  run: node scripts/fetch-schedule.mjs
- name: Infer rescheduledTo
  run: node scripts/infer-rescheduled.mjs
```

`Check for changes` step이 두 스크립트의 결과(games_2026.json)를 묶어서 감지 → 변경 있으면 1 commit.

## 다음 단계

- B-5c: GitHub Actions cron 자동 실행 (cron 재활성화는 B-4.5 검증 통과 후)
- B-5e: 시범경기 venue 정의 추가 검토 (마산·이천 등)

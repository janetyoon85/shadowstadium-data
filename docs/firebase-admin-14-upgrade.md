# firebase-admin 13 → 14 업그레이드 계획·복구 (2026-10-26)

취약점(uuid 등, CI 전용·악용 경로 없음) 해소용. 고치는 방법이 메이저 업그레이드뿐이라 두 단계로 나눠 진행한다.

## 기준점
- 태그 `pre-firebase-admin-14` = `f7409624f2` (업그레이드 시작 전 main). 전체 복원이 필요하면 이 상태 파일을 기준으로 한다.

## 단계
- **A단계(완료·병합 `9bef900717`)**: 레거시 네임스페이스(`admin.messaging()`·`admin.credential.cert`·`admin.apps`·`admin.initializeApp`)를 호환 모듈 `scripts/firebase-admin-compat.mjs`(모듈식 API 기반, 13/14 모두 동작)로 교체. 버전은 13 유지.
  - 검증: 단위 테스트 236개, 알림 스크립트 DRY_RUN, 브랜치에서 `fcm-player-test` 실발송(폰 도착 확인), 병합 후 `fcm-player-alerts`·`fcm-reminders` 연속 성공.
- **B단계(완료·병합 `9de21c6a9d`, 2026-10-27)**: `package.json` `firebase-admin` `^13` → `^14.5`(Node ≥22 필요) + 알림 워크플로우 4개(`fcm-player-alerts`, `fcm-reminders`, `fcm-player-test`, `fcm-purge-device`)의 `node-version` 20 → 22. 브랜치에서 발송 테스트 후 병합 커밋으로 반영.

- **C단계(완료)**: 14 의 SDK `unsubscribeFromTopic` 은 다른 API 를 쓰며 서비스 계정에 없는 권한(`cloudmessaging.topicSubscriptions.delete`)을 요구한다(CI 스모크 실측). `firebase-admin-compat.mjs` 의 `unsubscribeFromTopic` 이 SDK 인증 오류 시 13 까지 쓰던 IID 엔드포인트(`iid.googleapis.com/iid/v1:batchRemove`)로 폴백하고, `purge-device-topics.mjs` 가 이를 쓴다(가짜 토큰으로 폴백 경로 확인 — 유효 토큰 해제는 다음 실사용 때 확인).

## 복구
- A단계 문제: `git revert -m 1 9bef900717` (병합 커밋 하나). 레거시 import 로 돌아간다.
- C단계 문제: 병합 커밋 revert → 14 SDK 직접 호출(권한 오류 가능).
- B단계 문제: B 병합 커밋만 `git revert -m 1 <커밋>` → 13 + Node 20 + 호환 모듈(A 상태)로 복귀. 복구 후 `package-lock.json` 이 13 으로 돌아왔는지, 워크플로우가 `node-version: '20'` 인지 확인.
- 최악: 태그 기준 파일 복원(`git checkout pre-firebase-admin-14 -- package.json package-lock.json scripts .github/workflows/fcm-*.yml`) 후 커밋.
- 발송 기록(`sent-*.json`) 형식은 모든 단계에서 동일해 복구해도 영향이 없다. 복구 직후 첫 `fcm-player-alerts`/`fcm-reminders` 실행이 성공하는지, 알림이 중복되지 않는지 확인.

## 교훈(이번에 발견)
- 1분 주기에서 발송 기록 저장이 git rebase 충돌로 20회 실패하던 문제 → `scripts/merge-sent-state.mjs`(합집합 병합) 방식으로 교체(`fcm-player-alerts`, `fcm-reminders`).
- git 네트워크 호출이 응답 없이 멈추면 동시성 그룹이 최대 10분 막힘 → 저장 단계에 `timeout-minutes: 4` 와 `timeout 60 git ...`.
- 큐에 남은 옛 실행은 옛 커밋 코드를 그대로 돌린다 — 워크플로우를 고친 직후엔 오래된 `queued` 실행을 취소할 것.

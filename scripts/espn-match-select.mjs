// ESPN scoreboard 이벤트 중 실제 우리 경기에 해당하는 것 딱 하나를 고르는 로직 — 순수 함수라
// fetch-schedule.mjs(enrichEuroAssists)와 backfill-player-name-auto.mjs가 각자 따로 들고
// 있다가(2026-09-28 동시킥오프 콜리전 버그 수정 때 두 곳 다 고쳐야 했음) 하나로 합침
// (테스트 자동화 도입과 함께, 2026-09-28) — 앞으로 이 로직을 고칠 일이 생기면 여기 한 곳만
// 고치면 두 호출부 다 자동 반영됨.
//
// 같은 리그 안에서도 여러 경기가 동시 킥오프하는 경우가 흔함(EPL 토요일 15시 동시킥오프 등) —
// 시각만으로는 여러 후보 중 아무거나 골라버릴 수 있어, 시각으로 후보를 추린 뒤 최종 스코어까지
// 일치하는 것만 채택.
//
// 버그(2026-09-28 발견, 사용자 리포트 "국가가 이상한데?"): 동시킥오프 경기 중 "최종 스코어가
// 우연히 같은 경기"가 2개 이상이면 첫 번째를 아무 근거 없이 채택해버려, 완전히 다른 경기의
// 어시스트·국적이 잘못 붙는 사고 발생 확인(예: 뮌헨글라드바흐 4-0 호펜하임 ↔ 동시각
// 우니온베를린도 4-0 아우크스부르크). "스코어까지 일치하는 후보"가 유일해야만 채택하고,
// 2개 이상 동률이면 무엇도 확신할 수 없으므로 미매칭(undefined) 처리 — 오귀속보다 미부착이 낫다는
// 원칙.
export function selectUniqueScoreMatch(events, kickoffMs, homeScore, awayScore) {
  const timeCandidates = events.filter((e) => Math.abs(Date.parse(e.date) - kickoffMs) <= 5 * 60 * 1000);
  const scoreCandidates =
    timeCandidates.length <= 1
      ? timeCandidates
      : timeCandidates.filter((e) => {
          const comp = e.competitions?.[0];
          const h = comp?.competitors?.find((c) => c.homeAway === 'home');
          const a = comp?.competitors?.find((c) => c.homeAway === 'away');
          return h && a && Number(h.score) === homeScore && Number(a.score) === awayScore;
        });
  return scoreCandidates.length === 1 ? scoreCandidates[0] : undefined;
}

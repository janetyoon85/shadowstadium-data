// 진행중으로 굳어버린 지연·중단 경기 정리(2026-10-11, 라리가 빌바오-바예카노가 킥오프 19시간 뒤에도 "경기지연 0:0 경기중"으로 남음 —
// 네이버가 "경기지연"을 계속 주고 ESPN 은 ABANDONED(중단)로 확정한 경기). 비야구 경기가 지연·중단 문구인 채 킥오프 후 일정 시간이 지나면
// 이미 끝났거나 중단된 것이라 '연기(postponed)'로 내려 "경기중" 목록에서 뺀다. 결과/재개 일정은 소스가 갱신해 주면 다시 덮어쓴다.
export const STALE_SUSPENDED_HOURS = 6;
const SUSPENDED_RE = /지연|중단|연기|취소/;
/**
 * @param {string} status 현재 판별한 상태
 * @param {string} info statusInfo(예: "경기지연")
 * @param {number} startMs 킥오프 epoch ms
 * @param {number} nowMs 현재 epoch ms
 */
export function staleSuspendedStatus(status, info, startMs, nowMs) {
  if (status !== 'live') return status;
  if (!SUSPENDED_RE.test(String(info || ''))) return status;
  if (!Number.isFinite(startMs) || nowMs - startMs < STALE_SUSPENDED_HOURS * 3600e3) return status;
  return 'postponed';
}

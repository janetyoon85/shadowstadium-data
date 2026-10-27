// 라이브 경기 선택(순수 함수, Firebase 의존성 없음) — publish-live.mjs(GitHub 서버)와 live-daemon(NAS)·fetch-schedule 라이브 전용 모드가 함께 쓴다.

export function selectLive(games, nowMs) {
  const out = {};
  for (const g of games) {
    if (!g || !g.id || !g.h || !g.a) continue;
    const live = g.st === 'live';
    const recentFinal = g.st === 'final' && nowMs - g.t < 6 * 3600e3 && nowMs - g.t > 0;
    const soon = g.st === 'scheduled' && g.t - nowMs < 90 * 60e3 && g.t - nowMs > -3 * 3600e3;
    if (!(live || recentFinal || soon)) continue;
    // Firebase 키에는 . $ # [ ] / 를 쓸 수 없어 id 의 구분자를 바꿔 저장한다(앱이 같은 규칙으로 되돌림: '~' → ':').
    const key = String(g.id).replace(/[.$#[\]/:]/g, '~');
    out[key] = { id: g.id, st: g.st, per: g.per || '', h: { s: g.h.s, ls: g.h.ls || null }, a: { s: g.a.s, ls: g.a.ls || null } };
  }
  return out;
}

// games.json 의 경기 시작 시각(ms) — date/time 은 KST.
const startMs = (g) => (g.date && g.time ? Date.parse(g.date + 'T' + g.time + ':00+09:00') : NaN);
// 게시 대상: 진행 중(시작 14시간 안 — 'live' 로 남은 오래된 찌꺼기 제외) · 최근 2시간 안에 끝난 경기(최종 스코어를 빨리 전달) · 45분 안에 시작할 경기(live 전환을 빨리 전달).
// 앱의 큰 목록(1분 주기 전체 받기) 위에 덮어쓰는 라이브 필드만 담는다.
export function selectLiveGames(games, nowMs) {
  const out = {};
  for (const g of games) {
    if (!g || !g.gameId) continue;
    const t = startMs(g);
    if (!Number.isFinite(t)) continue;
    const live = g.status === 'live' && nowMs - t < 14 * 3600e3 && t - nowMs < 2 * 3600e3;
    const recentDone = g.status === 'completed' && t < nowMs && nowMs - t < 2 * 3600e3;
    const soon = g.status === 'scheduled' && t - nowMs < 45 * 60e3 && t - nowMs > -3 * 3600e3;
    if (!(live || recentDone || soon)) continue;
    const e = { gameId: g.gameId, status: g.status, homeScore: g.homeScore ?? null, awayScore: g.awayScore ?? null };
    for (const k of ['inningInfo', 'matchPeriod', 'liveState', 'scorers', 'cards', 'homePitcher', 'awayPitcher', 'homePitcherPid', 'awayPitcherPid']) if (g[k] !== undefined && g[k] !== null) e[k] = g[k];
    out[String(g.gameId).replace(/[.$#[\]/:]/g, '~')] = e;
  }
  return out;
}

// ── NAS 상시 폴러(live-daemon)용 판단 함수 ──

// games.json 형식: 시작 45분 전 ~ 5시간 뒤 안에 시작한 경기가 하나라도 있으면 "활성"(= 크롤링할 가치가 있음). 취소·연기 제외.
export function gamesActive(games, nowMs, beforeMs = 45 * 60e3, afterMs = 5 * 3600e3) {
  for (const g of games) {
    if (!g || g.status === 'cancelled' || g.status === 'postponed') continue;
    const t = startMs(g);
    if (Number.isFinite(t) && t - nowMs < beforeMs && nowMs - t < afterMs) return true;
  }
  return false;
}

// 농구(basketball/games.json): 진행 중이거나 45분 안에 시작(또는 3시간 안에 시작했는데 아직 live 전환 전)한 경기가 있으면 활성. 끝난 경기는 마지막 크롤링이 final 로 게시한다.
export function basketballActive(games, nowMs) {
  return games.some((g) => g && g.h && g.a && (g.st === 'live' || (g.st === 'scheduled' && g.t - nowMs < 45 * 60e3 && g.t - nowMs > -3 * 3600e3)));
}

// 소스가 진행 중인 경기 점수를 잠깐 0-0 으로 내려주는 일시 오류가 있어(2026-10-14 "두산 0-0 LG" 오알림) 직전 게시본의 점수를 유지한다. prev/next: { key: { homeScore, awayScore, status } }
export function guardScores(prev, next) {
  let guarded = 0;
  for (const [k, g] of Object.entries(next)) {
    const pv = prev?.[k];
    if (!pv || (g.status !== 'live' && g.status !== 'completed')) continue;
    if ((pv.status !== 'live' && pv.status !== 'completed') || !(pv.homeScore > 0 || pv.awayScore > 0)) continue;
    const zero = (g.homeScore === 0 || g.homeScore == null) && (g.awayScore === 0 || g.awayScore == null);
    if (zero) {
      g.homeScore = pv.homeScore;
      g.awayScore = pv.awayScore;
      guarded++;
    }
  }
  return guarded;
}

// ── 알림 감지용 이벤트 데이터(비공개 events/games 로만 게시 — 앱은 읽지 않음) ──
// selectLiveGames 와 같은 창(진행 중 · 최근 2시간 종료 · 45분 안 시작)의 경기에서 알림 스크립트가 쓰는 필드를 모두 담는다(득점자·카드·하이라이트(홈런 등)·선발투수·카운트).
export const EVENT_FIELDS = ['status', 'homeScore', 'awayScore', 'inningInfo', 'matchPeriod', 'liveState', 'scorers', 'cards', 'highlights', 'homePitcher', 'awayPitcher', 'homePitcherPid', 'awayPitcherPid'];
export function selectEventGames(games, nowMs) {
  const win = selectLiveGames(games, nowMs); // 같은 창 판정 재사용
  const out = {};
  for (const g of games) {
    if (!g || !g.gameId) continue;
    const key = String(g.gameId).replace(/[.$#[\]/:]/g, '~');
    if (!win[key]) continue;
    const e = { gameId: g.gameId };
    for (const k of EVENT_FIELDS) if (g[k] !== undefined && g[k] !== null) e[k] = g[k];
    out[key] = e;
  }
  return out;
}

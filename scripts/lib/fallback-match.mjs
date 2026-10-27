// 보조 원본(ESPN·MLB Stats API) 경기 ↔ games.json(네이버 출처) 경기 매칭·병합 규칙 — 네이버 의존도 절감 P2(2026-10-27).
// 네이버가 막혀 games.json 갱신이 멈춰도 점수·상태가 이어지게 하는 안전망. 원칙:
//  · 기존 gameId 는 절대 바꾸지 않는다(즐겨찾기·알림 중복방지 키) — 새 경기를 만들지 않고, 이미 있는 경기의 상태·점수만 "앞으로" 갱신한다.
//  · 오매칭 방지: 같은 리그 + 킥오프 ±10분 + 양 팀 영문명이 모두 일치(한글→영문 사전 team-name-en.json). 후보가 정확히 1개일 때만 매칭, 아니면 건너뜀.
//  · 퇴행 금지: 상태는 scheduled → live → completed 로만, 점수는 팀별 max(기존, 보조) — 네이버가 더 최신이거나 같으면 아무것도 안 바뀐다(멱등).
//  · 취소·연기 경기는 건드리지 않는다. 보조 원본이 모르는 필드(득점자·카드·선발투수 등)는 그대로 둔다.
// 순수 함수만 — 네트워크·파일 I/O 없음(테스트 용이).

const RANK = { scheduled: 0, live: 1, completed: 2 };
const rank = (s) => (s in RANK ? RANK[s] : -1);

const STOP = /\b(fc|afc|cf|sc|ac|as|ssc|rc|rcd|ud|cd|sv|vfl|vfb|fsv|tsg|1|ca|us|og|if|bk|ik|ff|fk|club|de|la|le|the|real|sporting)\b/g;
// ESPN·사전 표기 차이 흡수(2026-10-27 실측: Man City/Manchester City, Brøndby/Brondby, D.C./DC, Sporting KC/Sporting Kansas City, Crvena Zvezda/Red Star Belgrade 가 매칭 실패).
const CHAR_MAP = { ø: 'o', æ: 'ae', å: 'a', ð: 'd', þ: 'th', ß: 'ss', ł: 'l', đ: 'd', œ: 'oe' };
const ALIASES = [
  [/\bman city\b/, 'manchester city'], [/\bman (utd|united)\b/, 'manchester united'], [/\butd\b/, 'united'],
  [/\bred star belgrade\b/, 'crvena zvezda'], [/\bkansas city\b/, 'kc'], [/\bspurs\b/, 'tottenham'],
];
export function normTeam(name) {
  let t = String(name || '').toLowerCase();
  t = t.replace(/[øæåðþßłđœ]/g, (c) => CHAR_MAP[c] || c);
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’.]/g, '');
  t = t.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of ALIASES) t = t.replace(re, to);
  return t.replace(STOP, ' ').replace(/\s+/g, ' ').trim();
}
// 한쪽 이름이 다른 쪽에 포함되면 같은 팀으로 본다(예: 'newcastle' ⊂ 'newcastle united', 'milwaukee' ⊂ 'milwaukee brewers').
export function sameTeam(a, b) {
  const x = normTeam(a), y = normTeam(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// games.json 경기의 킥오프(UTC ms) — date/time 은 KST.
export const kickoffMs = (g) => (g.date && g.time ? Date.parse(`${g.date}T${g.time}:00+09:00`) : NaN);

// ESPN 이벤트 → 공통 형태. (ev = site.api.espn.com scoreboard events[i])
export function fromEspnEvent(ev) {
  const comp = ev?.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  const away = comp?.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  const t = ev.status?.type || {};
  const name = String(t.name || '');
  let status = null;
  if (/POSTPON|CANCEL|SUSPEND|ABANDON|DELAY/.test(name)) status = 'skip';
  else if (t.state === 'post' || /FINAL|FULL_TIME|END_OF/.test(name)) status = 'completed';
  else if (t.state === 'in' || /IN_PROGRESS|HALF|EXTRA|FIRST|SECOND|PENALT/.test(name)) status = 'live';
  else if (t.state === 'pre' || /SCHEDULED/.test(name)) status = 'scheduled';
  if (!status) return null;
  const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    source: 'espn',
    id: String(ev.id),
    kickoff: Date.parse(ev.date),
    home: home.team?.displayName || home.team?.name || '',
    away: away.team?.displayName || away.team?.name || '',
    homeScore: num(home.score),
    awayScore: num(away.score),
    status,
    period: Number(ev.status?.period) || 0,
    detail: String(t.shortDetail || t.detail || ''),
    typeName: name,
  };
}

// MLB Stats API 게임 → 공통 형태. (g = statsapi schedule dates[].games[i], hydrate=linescore 가 있으면 인닝 사용)
export function fromMlbGame(g) {
  const s = g?.status || {};
  const abs = s.abstractGameState;
  let status = null;
  if (/Postponed|Cancelled|Suspended/i.test(s.detailedState || '')) status = 'skip';
  else if (abs === 'Final') status = 'completed';
  else if (abs === 'Live') status = 'live';
  else if (abs === 'Preview') status = 'scheduled';
  if (!status) return null;
  const ls = g.linescore || {};
  const half = ls.inningState || (ls.isTopInning === true ? 'Top' : ls.isTopInning === false ? 'Bottom' : '');
  const inning = ls.currentInning;
  return {
    source: 'mlb',
    id: String(g.gamePk),
    kickoff: Date.parse(g.gameDate),
    home: g.teams?.home?.team?.name || '',
    away: g.teams?.away?.team?.name || '',
    homeScore: g.teams?.home?.score ?? null,
    awayScore: g.teams?.away?.score ?? null,
    status,
    inningInfo: inning && /Top|Bottom/.test(half) ? `${inning}회${half === 'Top' ? '초' : '말'}` : '',
  };
}

// 한 경기(game)에 맞는 보조 경기(candidates 중)를 찾는다. 정확히 1개일 때만 반환.
// en: 한글 팀명 → 영문 사전(team-name-en.json). 사전에 없는 팀이면 매칭하지 않는다(정직하게 건너뜀).
export function findMatch(game, candidates, en, { windowMs = 10 * 60e3 } = {}) {
  const k = kickoffMs(game);
  if (!Number.isFinite(k)) return null;
  const hEn = en[game.home], aEn = en[game.away];
  if (!hEn || !aEn) return null;
  const hits = candidates.filter((c) => Math.abs(c.kickoff - k) <= windowMs && sameTeam(hEn, c.home) && sameTeam(aEn, c.away));
  return hits.length === 1 ? hits[0] : null;
}

// 병합: 바뀐 필드만 담은 patch 를 돌려준다(없으면 빈 객체). 퇴행 금지·취소/연기 보호.
export function buildPatch(game, m) {
  const patch = {};
  if (!m || m.status === 'skip') return patch;
  if (game.status === 'cancelled' || game.status === 'postponed') return patch;
  const cur = rank(game.status);
  const next = rank(m.status);
  if (next < cur) return patch; // 상태 퇴행 금지 (completed 인데 보조가 live 라고 해도 무시)
  if (next > cur) patch.status = m.status;
  const live = m.status === 'live' || m.status === 'completed';
  if (live) {
    for (const [k, v] of [['homeScore', m.homeScore], ['awayScore', m.awayScore]]) {
      if (typeof v !== 'number') continue;
      const old = typeof game[k] === 'number' ? game[k] : 0;
      if (v > old || (typeof game[k] !== 'number' && v === 0)) patch[k] = Math.max(v, old);
    }
  }
  // 진행 정보(인닝/단계) — 진행 중이고 네이버 쪽 상태가 live 이거나 이번에 live 로 올라갈 때만.
  // 보조 원본이 점수 면에서 뒤처져 있으면(= 더 오래된 값) 진행 정보도 믿지 않는다 — 네이버가 최신일 때 단계가 거꾸로 가는 것 방지.
  const behind = (typeof m.homeScore === 'number' && typeof game.homeScore === 'number' && m.homeScore < game.homeScore) || (typeof m.awayScore === 'number' && typeof game.awayScore === 'number' && m.awayScore < game.awayScore);
  if (m.status === 'live' && !behind && (game.status === 'live' || patch.status === 'live')) {
    if (m.source === 'mlb' && m.inningInfo && m.inningInfo !== game.inningInfo) patch.inningInfo = m.inningInfo;
    if (m.source === 'espn') {
      const mp = espnPeriodKo(m);
      if (mp && mp !== game.matchPeriod) patch.matchPeriod = mp;
    }
  }
  return patch;
}

// ESPN 축구 진행 단계 → 네이버 문구에 가깝게(전반/후반/연장전반/연장후반/승부차기). 모르면 빈 문자열(표시 안 함).
export function espnPeriodKo(m) {
  const n = m.typeName || '';
  if (/HALFTIME/.test(n)) return '하프타임';
  if (/PENALT/.test(n)) return '승부차기';
  if (/EXTRA/.test(n) || m.period === 3) return '연장전반';
  if (m.period === 4) return '연장후반';
  if (m.period === 1) return '전반';
  if (m.period === 2) return '후반';
  return '';
}

// games 배열(제자리 수정 금지 — 새 배열 반환)에 보조 원본 후보를 적용. 반환: { games, changes: [{gameId, patch, via}] }
export function applyFallback(games, candidatesByLeague, en, nowMs = Date.now(), { windowHoursBefore = 6, windowHoursAfter = 36 } = {}) {
  const changes = [];
  const out = games.map((g) => {
    const cands = candidatesByLeague[g.league];
    if (!cands || !g.gameId) return g;
    const k = kickoffMs(g);
    if (!Number.isFinite(k) || k - nowMs > windowHoursBefore * 3600e3 || nowMs - k > windowHoursAfter * 3600e3) return g; // 오늘 전후만
    const m = findMatch(g, cands, en);
    const patch = buildPatch(g, m);
    if (!Object.keys(patch).length) return g;
    changes.push({ gameId: g.gameId, league: g.league, patch, via: m.source + ':' + m.id });
    return { ...g, ...patch };
  });
  return { games: out, changes };
}

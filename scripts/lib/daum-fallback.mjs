// 다음스포츠(sports.daum.net) 경기 목록 → games.json 보강용 공통 형태 변환·매칭 — 네이버 의존도 절감 P4'(2026-10-27).
// 공개 JSON 경로 `/api/hermes/game/list.json`(robots.txt 는 /media-api/·/prx/ 만 막음)에서 한국어 팀명·점수·상태를 받는다. 비공식 내부 API 이므로
// (1) 낮은 빈도 · (2) 진행/임박 경기가 있는 리그만 · (3) 실패하면 조용히 포기 — 의 보조 원본으로만 쓴다.
// 병합 규칙은 scripts/lib/fallback-match.mjs 의 buildPatch(상태·점수 퇴행 금지, 취소/연기 보호)를 그대로 재사용한다. 순수 함수만(I/O 없음).
import { kickoffMs, buildPatch } from './fallback-match.mjs';

// games.json 의 league → 다음 leagueCode(소문자로 호출).
export const DAUM_LEAGUE = {
  KBO: 'kbo', 'K리그1': 'kl', 'K리그2': 'kl2', NPB: 'npb',
  EPL: 'epl', LALIGA: 'primera', BUNDESLIGA: 'bundesliga', SERIEA: 'seriea', LIGUE1: 'ligue1', EREDIVISIE: 'eredivisie',
  UCL: 'uefacl', UEL: 'uefacup', MLS: 'mls', ACL: 'afccl', ACL2: 'acl2',
};

const STOP_KO = /(fc|hd|sc|ac|시티즌|유나이티드|fc서울)$/g;
export function normKo(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, '').replace(/[.·\-_'’]/g, '').trim();
}
// 한쪽이 다른 쪽에 포함되면 같은 팀(예: '울산' ⊂ '울산hd', 'fc서울' ∋ '서울'). 너무 짧은 이름(1글자)은 정확 일치만.
export function sameTeamKo(a, b) {
  const x = normKo(a), y = normKo(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 2) return false;
  return x.includes(y) || y.includes(x);
}

const scoreOf = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (typeof v.run === 'number') return v.run; // 야구
    if (typeof v.goal === 'number') return v.goal; // 축구
    if (typeof v.score === 'number') return v.score;
    if (typeof v.point === 'number') return v.point;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 상태 매핑 — 확인된 값: BEFORE(예정)·END(종료)·CANCEL(취소). 그 외 값(진행 중 표기는 미확인)은 시작 시각이 지났으면 live 로 본다.
export function daumStatus(g, nowMs = Date.now()) {
  const s = String(g.gameStatus || '');
  if (s === 'END') return 'completed';
  if (s === 'BEFORE') return 'scheduled';
  if (/CANCEL|POSTPONE|SUSPEND|DELAY/.test(s)) return 'skip';
  if (s && g.periodType && g.periodType !== 'BEFORE' && g.periodType !== 'END') return 'live';
  return null;
}

export function fromDaumGame(g, nowMs = Date.now()) {
  if (!g?.home?.team || !g?.away?.team || !g.startDate || !g.startTime) return null;
  const status = daumStatus(g, nowMs);
  if (!status) return null;
  const t = String(g.startTime).padStart(4, '0');
  const kickoff = Date.parse(`${g.startDate.slice(0, 4)}-${g.startDate.slice(4, 6)}-${g.startDate.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2)}:00+09:00`);
  if (!Number.isFinite(kickoff)) return null;
  return {
    source: 'daum',
    id: String(g.gameId),
    kickoff,
    home: g.home.team.nameKo || g.home.team.name || '',
    away: g.away.team.nameKo || g.away.team.name || '',
    homeShort: g.home.team.shortNameKo || '',
    awayShort: g.away.team.shortNameKo || '',
    homeScore: scoreOf(g.homeScore),
    awayScore: scoreOf(g.awayScore),
    status,
    periodType: g.periodType || '',
  };
}

// 한국어 팀명으로 매칭 — 같은 리그 + 킥오프 ±10분 + 양 팀 일치 후보가 정확히 1개일 때만.
export function findMatchKo(game, candidates, { windowMs = 10 * 60e3 } = {}) {
  const k = kickoffMs(game);
  if (!Number.isFinite(k)) return null;
  const hits = candidates.filter((c) => Math.abs(c.kickoff - k) <= windowMs
    && (sameTeamKo(game.home, c.homeShort) || sameTeamKo(game.home, c.home))
    && (sameTeamKo(game.away, c.awayShort) || sameTeamKo(game.away, c.away)));
  return hits.length === 1 ? hits[0] : null;
}

// games(배열) 에 다음 후보를 적용 — 오늘 전후만, 새 배열 반환.
export function applyDaum(games, candidatesByLeague, nowMs = Date.now(), { hoursBefore = 6, hoursAfter = 36 } = {}) {
  const changes = [];
  const out = games.map((g) => {
    const cands = candidatesByLeague[g.league];
    if (!cands || !g.gameId) return g;
    const k = kickoffMs(g);
    if (!Number.isFinite(k) || k - nowMs > hoursBefore * 3600e3 || nowMs - k > hoursAfter * 3600e3) return g;
    const m = findMatchKo(g, cands);
    const patch = buildPatch(g, m);
    if (!Object.keys(patch).length) return g;
    changes.push({ gameId: g.gameId, league: g.league, patch, via: `daum:${m.id}` });
    return { ...g, ...patch };
  });
  return { games: out, changes };
}

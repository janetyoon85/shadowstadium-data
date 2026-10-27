// 알림 감지용 신선 데이터 덮어쓰기(2026-10-27). 알림 스크립트는 커밋된 games.json 을 읽는데, 이 파일은 크롤러가 커밋해야 갱신된다(점수는 NAS 빠른 경로로 20~40초지만 알림은 1~2분 늦었다).
// NAS 폴러가 20초마다 비공개 events/games 에 올리는 최신 이벤트(득점자·카드·하이라이트·선발투수·점수)를, alert-loop 가 `.live-overlay.json` 으로 내려 두면 이 모듈이 커밋된 데이터 위에 덮어쓴다.
//
// 중복 알림 방지가 핵심이라 "퇴행하지 않는" 덮어쓰기만 한다:
//  · 상태는 앞으로만(scheduled → live → completed/final). 뒤로 가는 값은 무시.
//  · 득점자·카드·하이라이트는 항목 수가 줄어들지 않을 때만(각 편별로 더 긴 쪽). 같은 길이면 커밋된 값 유지.
//  · 점수·이닝·카운트는 오버레이가 진행 중(live)이거나 상태가 앞서갈 때만.
//  · 오버레이가 90초보다 오래됐거나 없으면 아무것도 바꾸지 않는다(기존 동작 그대로 — 안전한 폴백).
import fs from 'node:fs/promises';
import path from 'node:path';

export const OVERLAY_FILE = '.live-overlay.json';
export const OVERLAY_MAX_AGE_MS = 90e3;
const ORDER = { scheduled: 0, live: 1, completed: 2, final: 2 };
const rank = (s) => (s in ORDER ? ORDER[s] : -1);
const len = (v) => (Array.isArray(v) ? v.length : 0);

// scorers/cards 는 { home: [...], away: [...] } 형태 — 편별로 더 긴 쪽을 택한다(항목이 줄어들면 커밋된 값 유지).
function longerBySide(cur, next) {
  if (!next || typeof next !== 'object') return cur;
  if (Array.isArray(next) || Array.isArray(cur)) return len(next) > len(cur) ? next : cur;
  const out = { ...(cur || {}) };
  let changed = false;
  for (const side of ['home', 'away']) {
    if (len(next[side]) > len(out[side])) { out[side] = next[side]; changed = true; }
  }
  return changed ? out : cur;
}

// games.json 형식(축구·야구 등) 한 경기에 오버레이 o 를 적용. 바뀐 게 없으면 같은 객체를 돌려준다.
export function mergeGame(g, o) {
  if (!g || !o) return g;
  const patch = {};
  const forward = rank(o.status) > rank(g.status);
  const liveNow = o.status === 'live';
  if (forward) patch.status = o.status;
  if (liveNow || forward) {
    for (const k of ['homeScore', 'awayScore', 'inningInfo', 'matchPeriod', 'liveState', 'homePitcher', 'awayPitcher', 'homePitcherPid', 'awayPitcherPid']) {
      if (o[k] !== undefined && o[k] !== null && JSON.stringify(o[k]) !== JSON.stringify(g[k])) patch[k] = o[k];
    }
  }
  for (const k of ['scorers', 'cards']) {
    if (o[k] === undefined) continue;
    const m = longerBySide(g[k], o[k]);
    if (m !== g[k]) patch[k] = m;
  }
  if (len(o.highlights) > len(g.highlights)) patch.highlights = o.highlights;
  return Object.keys(patch).length ? { ...g, ...patch } : g;
}

export function applyEventOverlay(games, overlay, nowMs = Date.now()) {
  if (!Array.isArray(games) || !overlay || typeof overlay.ts !== 'number' || nowMs - overlay.ts > OVERLAY_MAX_AGE_MS || !overlay.games) return games;
  let changed = false;
  const out = games.map((g) => {
    const m = g && g.gameId ? mergeGame(g, overlay.games[g.gameId]) : g;
    if (m !== g) changed = true;
    return m;
  });
  return changed ? out : games;
}

// 농구(basketball/games.json): id 로 매칭, st 는 앞으로만, 진행 중이면 per·점수·쿼터별 점수 반영.
export function applyBasketballOverlay(games, overlay, nowMs = Date.now()) {
  if (!Array.isArray(games) || !overlay || typeof overlay.bkTs !== 'number' || nowMs - overlay.bkTs > OVERLAY_MAX_AGE_MS || !overlay.bk) return games;
  let changed = false;
  const out = games.map((g) => {
    const o = g && g.id ? overlay.bk[g.id] : null;
    if (!o) return g;
    const forward = rank(o.st) > rank(g.st);
    if (!(o.st === 'live' || forward)) return g;
    const next = { ...g, st: forward ? o.st : g.st, per: o.per ?? g.per, h: { ...g.h, s: o.h?.s ?? g.h.s, ...(o.h?.ls ? { ls: o.h.ls } : {}) }, a: { ...g.a, s: o.a?.s ?? g.a.s, ...(o.a?.ls ? { ls: o.a.ls } : {}) } };
    if (JSON.stringify(next) === JSON.stringify(g)) return g;
    changed = true;
    return next;
  });
  return changed ? out : games;
}

async function readOverlay(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, OVERLAY_FILE), 'utf8'));
  } catch {
    return null;
  }
}

// 알림 스크립트용 로더: 파일을 읽고(없으면 fallback) 신선한 오버레이가 있으면 덮어쓴다. 어떤 실패도 기존 동작(파일 그대로)으로 폴백.
export async function loadGamesFresh(file, root, fallback = []) {
  let games = fallback;
  try { games = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
  try { return applyEventOverlay(games, await readOverlay(root)); } catch { return games; }
}
export async function loadBasketballFresh(file, root) {
  let j = {};
  try { j = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
  const games = j.games || [];
  try { return applyBasketballOverlay(games, await readOverlay(root)); } catch { return games; }
}

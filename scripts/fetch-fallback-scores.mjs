// 보조 원본(ESPN 사이트 API·MLB Stats API)으로 games.json 의 경기 상태·점수를 "앞으로만" 보강한다 — 네이버 의존도 절감 P2(2026-10-27).
// 네이버가 막혀 fetch-schedule 이 멈춘 동안에도 오늘 전후 경기의 진행·종료·점수가 이어지게 하는 안전망. 네이버가 정상이면 같은 값이라 아무것도 안 바뀐다(멱등).
// 규칙(scripts/lib/fallback-match.mjs): 기존 gameId 유지 · 양 팀 영문명+킥오프 ±10분 정확히 1개 매칭 · 상태/점수 퇴행 금지 · 취소·연기 보호.
// 실행: node scripts/fetch-fallback-scores.mjs [--dry]     (환경변수 FALLBACK_DRY=1 도 동일)
import './lib/watch-429.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyFallback, fromEspnEvent, fromMlbGame, kickoffMs } from './lib/fallback-match.mjs';
import { ESPN_LEAGUE_SLUG } from './lib/espn-league-slugs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry') || process.env.FALLBACK_DRY === '1';
const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = Number(process.env.FALLBACK_GAP_MS) || 400;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const now = Date.now();
  const games = JSON.parse(await fs.readFile(path.join(ROOT, 'games.json'), 'utf-8'));
  const en = JSON.parse(await fs.readFile(path.join(ROOT, 'team-name-en.json'), 'utf-8'));
  // 대상: 킥오프가 (지금-36h ~ 지금+6h) 이고 아직 종료 확정이 아닌 경기(또는 최근 종료 재확인은 생략) — 리그별·날짜별로 필요한 요청만.
  const targets = games.filter((g) => {
    const k = kickoffMs(g);
    return Number.isFinite(k) && k - now < 6 * 3600e3 && now - k < 36 * 3600e3 && g.status !== 'completed' && g.status !== 'cancelled' && g.status !== 'postponed';
  });
  const need = new Map(); // league → Set(YYYYMMDD)
  for (const g of targets) {
    if (g.league !== 'MLB' && !ESPN_LEAGUE_SLUG[g.league]) continue;
    const k = kickoffMs(g);
    const set = need.get(g.league) || new Set();
    set.add(ymd(k)); // 킥오프(UTC) 날짜 — ESPN dates 파라미터는 UTC 기준 날짜
    need.set(g.league, set);
  }
  console.log(`[fallback] 대상 경기 ${targets.length}건, 조회할 (리그,날짜) ${[...need.values()].reduce((n, s) => n + s.size, 0)}개`);
  const cands = {};
  let requests = 0, errors = 0;
  for (const [league, dates] of need) {
    cands[league] = [];
    for (const d of dates) {
      try {
        if (league === 'MLB') {
          const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          const j = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${day}&endDate=${day}&hydrate=linescore`);
          for (const dt of j.dates || []) for (const x of dt.games || []) { const m = fromMlbGame(x); if (m) cands[league].push(m); }
        } else {
          const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE_SLUG[league]}/scoreboard?dates=${d}`);
          for (const ev of j.events || []) { const m = fromEspnEvent(ev); if (m) cands[league].push(m); }
        }
      } catch (e) {
        errors++;
        console.warn(`[fallback] ${league} ${d} 조회 실패: ${String(e.message).slice(0, 60)}`);
      }
      requests++;
      await sleep(GAP_MS);
    }
  }
  const { games: out, changes } = applyFallback(games, cands, en, now);
  for (const c of changes.slice(0, 40)) console.log(`[fallback] ${c.league} ${c.gameId} ${JSON.stringify(c.patch)} ← ${c.via}`);
  console.log(`[fallback] 요청 ${requests}건(실패 ${errors}), 변경 ${changes.length}건${DRY ? ' [DRY — 저장 안 함]' : ''}`);
  if (!changes.length || DRY) return;
  await fs.writeFile(path.join(ROOT, 'games.json'), JSON.stringify(out, null, 2) + '\n', 'utf-8');
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1); });

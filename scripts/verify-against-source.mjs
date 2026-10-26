// 원본 대조(2026-10-26, "정기적으로 대조 알람 적용해서 디스코드에") — 우리 games.json 을 ESPN 스코어보드(독립 원본)와 직접 비교해 불일치를 Discord 로 알린다.
// 점검: ① 결과 미반영(ESPN 종료인데 우리는 예정/진행중) ② 스코어 불일치 ③ 킥오프 시각 불일치 ④ 경기 누락(ESPN 출처 리그에 ESPN 경기가 우리에게 없음) ⑤ 상태 불일치(취소·연기)
// 오탐 방지: 크롤러 반영 지연(2~5분)·ESPN 정정 지연 때문에 같은 불일치가 "연속 2회 실행"에서 보일 때만 알림, 같은 알림은 24시간에 1회.
// 실행: node scripts/verify-against-source.mjs [--dry]   (DISCORD_WEBHOOK_URL)  — 상태: verify-source-state.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKoIndex } from './espn-team-index.mjs';
import { parseEspnEvents, compareSoccerEvents, compareMlbDecisions, compareNaverTimeline, compareNaverBatters, compareMlbBoxscore } from './verify-events.mjs';
import { boxInternalCheck, compareBoxFresh, parseEspnBox, parseNaverBox, compareNbaNaverVsOurs } from './verify-basketball.mjs';
import { norm as nbaNorm } from './nba-dedupe.mjs';
import { compareStandings } from './verify-standings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const KST = 9 * 3600e3;
const now = Date.now();
export const ourTs = (g) => Date.parse(`${g.date}T${/^\d\d:\d\d$/.test(g.time) ? g.time : '12:00'}:00Z`) - KST;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

// ── 비교 로직(순수 함수, 테스트 대상) ─────────────────────────────
// ours: games.json 경기, ev: ESPN scoreboard event(정규화: { id, startMs, completed, state, name, home:{name,score}, away:{name,score}, status }) → 불일치 목록 [{ kind, text }]
export function compareGame(ours, ev, nowMs = Date.now()) {
  const out = [];
  const label = `${ours.date} ${ours.league} ${ours.home} vs ${ours.away}`;
  const kickoff = ourTs(ours);
  if (ev.completed) {
    if ((ours.status === 'scheduled' || ours.status === 'live') && nowMs - kickoff > 3.5 * 3600e3) out.push({ kind: '결과 미반영', text: `${label} — ESPN 종료 ${ev.home.score}-${ev.away.score}, 우리는 ${ours.status}` });
    else if (ours.status === 'completed' && Number.isFinite(ours.homeScore) && Number.isFinite(ours.awayScore) && (ours.homeScore !== ev.home.score || ours.awayScore !== ev.away.score)) {
      // 홈/원정 표기가 서로 반대인 소스는 뒤집힌 점수도 일치로 본다(중립 경기·소스별 홈 정의 차이)
      const flipped = ours.homeScore === ev.away.score && ours.awayScore === ev.home.score;
      if (!flipped) out.push({ kind: '스코어 불일치', text: `${label} — 우리 ${ours.homeScore}-${ours.awayScore} / ESPN ${ev.home.score}-${ev.away.score}` });
    }
  } else if (ev.state === 'pre' && ours.status === 'scheduled' && !ours.timeTbd) { // 시각 미정(timeTbd) 경기는 자리표시 시각이라 비교하지 않는다
    const diff = Math.abs(ev.startMs - kickoff);
    if (diff > 25 * 60e3 && ev.startMs - nowMs < 48 * 3600e3 && ev.startMs > nowMs) out.push({ kind: '킥오프 시각 불일치', text: `${label} — 우리 ${ours.time} / ESPN ${new Date(ev.startMs + KST).toISOString().slice(11, 16)} (차이 ${Math.round(diff / 60e3)}분)` });
  }
  if (/postponed|canceled|cancelled|suspended/i.test(ev.status || '') && ours.status !== 'postponed' && ours.status !== 'cancelled' && nowMs - kickoff > -6 * 3600e3 && nowMs - kickoff < 36 * 3600e3) out.push({ kind: '연기·취소 미반영', text: `${label} — ESPN ${ev.status}, 우리는 ${ours.status}` });
  return out;
}

// 두 번 연속 보인 것만 알림 + 24시간 중복 억제(순수 함수)
// 같은 불일치가 "실행 2회"가 아니라 "일정 시간 이상" 이어질 때만 알린다 — 실행이 몇 분 간격으로 겹쳐 돌면(정시 호출 + GitHub 스케줄 + 수동) 2회가 금방 채워져, 경기 직후 ESPN 이 스탯을 정정하기 전 값을
// 오알림했다(2026-10-26 NBA 파울 5→4 등). 박스스코어 기록은 크롤러가 30분마다 다시 받으므로 2시간, 그 외 45분.
export const minAgeMs = (kind) => (/^농구 (선수 기록|박스스코어|NBA 선수)/.test(kind || '') ? 120 : 45) * 60e3;
export function decideAlerts(found, state, nowMs = Date.now()) {
  const pending = {};
  const toSend = [];
  for (const [key, item] of Object.entries(found)) {
    const prev = state.pending?.[key];
    pending[key] = { n: (prev?.n || 0) + 1, first: prev?.first || nowMs };
    const last = state.alerted?.[key] || 0;
    if (pending[key].n >= 2 && nowMs - pending[key].first >= minAgeMs(item.kind) && nowMs - last >= 24 * 3600e3) toSend.push(item);
  }
  const alerted = { ...(state.alerted || {}) };
  for (const it of toSend) alerted[it.key] = nowMs;
  for (const k of Object.keys(alerted)) if (nowMs - alerted[k] > 7 * 86400e3) delete alerted[k]; // 오래된 기록 정리
  return { toSend, pending, alerted };
}

// ── 실행부 ────────────────────────────────────────────────
async function main() {
  if (process.argv.includes('--test-discord')) { // 알림 경로 점검용 — 대조는 건너뛰고 테스트 메시지 1건만
    const hook0 = process.env.DISCORD_WEBHOOK_URL;
    if (!hook0) { console.error('[verify] DISCORD_WEBHOOK_URL 없음'); process.exit(1); }
    const r = await fetch(hook0, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '✅ **ShadeSide 원본 대조 알림 테스트** — 이 메시지가 보이면 Discord 알림 경로 정상(실제 불일치 알림 아님)' }) });
    console.log('[verify] discord test status', r.status);
    process.exit(r.ok ? 0 : 1);
  }
  const games = rj('games.json', []);
  // 리그 코드 ↔ ESPN 슬러그
  const slugByCode = {};
  const t1 = fs.readFileSync(path.join(ROOT, 'scripts/fetch-schedule.mjs'), 'utf8');
  const blk = t1.slice(t1.indexOf('const ESPN_LEAGUE_SLUG = {'), t1.indexOf('};', t1.indexOf('const ESPN_LEAGUE_SLUG = {')));
  for (const m of blk.matchAll(/^\s*([A-Z0-9_]+):\s*'([^']+)'/gm)) slugByCode[m[1]] = m[2];
  const espnOriginCodes = new Set();
  for (const f of ['fetch-espn-soccer-leagues', 'fetch-espn-world-soccer-leagues', 'fetch-espn-asia-soccer-leagues']) for (const m of fs.readFileSync(path.join(ROOT, `scripts/${f}.mjs`), 'utf8').matchAll(/code: '([A-Z0-9_]+)', slug: '([^']+)'/g)) { slugByCode[m[1]] = m[2]; espnOriginCodes.add(m[1]); }
  // 2026-10-26: 컵·유럽대항전·국가대표·친선·여자부까지 ESPN 이 다루는 축구는 전부 대조한다(승부차기 등 정의 차이는 compareGame 에서 보정).
  const codes = process.env.VERIFY_ONLY === 'mlb' ? [] : Object.keys(slugByCode); // 점검용: VERIFY_ONLY=mlb 이면 MLB 단계만
  // ESPN 영문 팀명 → 우리 한글 팀명 후보(네이버 출처 리그 매칭용) — fetch-schedule.mjs 의 ESPN 경기 매칭과 같은 색인을 쓴다.
  const koSet = buildKoIndex(ROOT);

  const byId = new Map(games.map((g) => [g.gameId, g]));
  const BACK = Number(process.env.VERIFY_BACK_DAYS || 3); // 과거 며칠을 대조할지(기본 3일, 점검용으로 늘릴 수 있음)
  const recent = games.filter((g) => ourTs(g) > now - (BACK + 1) * 86400e3 && ourTs(g) < now + 2 * 86400e3);
  const found = {};
  const eventPairs = []; // 이벤트(득점·도움·카드) 대조 대상: ESPN 과 매칭된 종료 경기
  const stats = { leagues: 0, events: 0, matched: 0, unmatched: 0 };
  const days = Array.from({ length: BACK + 2 }, (_, i) => i - BACK).map((d) => ymd(now + d * 86400e3));
  for (const code of codes) {
    const slug = slugByCode[code];
    const ourLeague = recent.filter((g) => g.league === code);
    if (!ourLeague.length && !espnOriginCodes.has(code)) continue; // 우리가 이 리그 경기를 거의 안 가진 경우 생략
    stats.leagues++;
    const seen = new Set();
    for (const d of days) {
      let j;
      try { const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${d}`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) continue; j = await r.json(); } catch { continue; }
      for (const e of j.events || []) {
        if (seen.has(e.id)) continue; seen.add(e.id);
        const c = e.competitions?.[0]; const h = c?.competitors?.find((x) => x.homeAway === 'home'), a = c?.competitors?.find((x) => x.homeAway === 'away');
        if (!h || !a) continue;
        const ev = { id: e.id, startMs: Date.parse(e.date), completed: !!e.status?.type?.completed, state: e.status?.type?.state, status: e.status?.type?.name || '', home: { name: h.team?.displayName, score: Number.parseInt(h.score, 10) }, away: { name: a.team?.displayName, score: Number.parseInt(a.score, 10) } };
        stats.events++;
        // 우리 경기 찾기: ESPN 출처는 id, 네이버 출처는 킥오프 ±20분 + 두 팀 한글명 후보
        let ours = byId.get(`${code}_ESPN_${e.id}`);
        if (!ours) {
          const hs = koSet(ev.home.name), as = koSet(ev.away.name);
          const slot = ourLeague.filter((g) => Math.abs(ourTs(g) - ev.startMs) <= 20 * 60e3);
          const ranked = slot.map((g) => ({ g, n: [hs.has(g.home), as.has(g.away), hs.has(g.away), as.has(g.home)].filter(Boolean).length })).sort((x, y) => y.n - x.n);
          if (ranked[0] && ranked[0].n >= 1 && (!ranked[1] || ranked[1].n < ranked[0].n)) ours = ranked[0].g;
          else if (slot.length === 1 && !hs.size && !as.size) ours = slot[0];
        }
        if (!ours) {
          stats.unmatched++;
          if (espnOriginCodes.has(code) && ev.startMs > now - 3 * 86400e3 && ev.startMs < now + 36 * 3600e3 && !/postponed|canceled|cancelled/i.test(ev.status) && !ev.home.name?.match(/^(TBD|To Be Determined)$/i)) {
            const k = `경기 누락|${code}|${e.id}`;
            found[k] = { key: k, kind: '경기 누락', text: `${code} ${new Date(ev.startMs + KST).toISOString().slice(5, 16).replace('T', ' ')} ${ev.home.name} vs ${ev.away.name} — ESPN에는 있는데 우리 데이터에 없음` };
          }
          continue;
        }
        stats.matched++;
        for (const m of compareGame(ours, ev, now)) { const k = `${m.kind}|${ours.gameId}`; found[k] = { key: k, ...m }; }
        if (ev.completed) eventPairs.push({ ours, slug, eventId: e.id, espnOrigin: String(ours.gameId).includes('_ESPN_') });
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  // ── 축구 선수 이벤트(득점·도움·카드): ESPN 경기 요약(keyEvents)과 선수 ID·분 단위로 비교 ───────────────────────
  // 최근 EVENT_BACK 일(기본 2일) 안에 끝난 매칭 경기만, 최신순으로 EVENT_MAX 건까지(실행당 요청 수 상한). ESPN 이벤트 수가 최종 스코어와 안 맞는 경기(원본 중복 기록)는 건너뛴다.
  {
    const EVENT_BACK = Number(process.env.VERIFY_EVENT_BACK_DAYS || 2), EVENT_MAX = Number(process.env.VERIFY_EVENT_MAX || 220);
    const cand = eventPairs.filter((p) => ourTs(p.ours) > now - EVENT_BACK * 86400e3).sort((a, b) => ourTs(b.ours) - ourTs(a.ours)).slice(0, EVENT_MAX);
    let done = 0, skipped = 0, items = 0;
    for (const p of cand) {
      let sj;
      try { const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${p.slug}/summary?event=${p.eventId}`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) continue; sj = await r.json(); } catch { continue; }
      done++;
      const res = compareSoccerEvents(p.ours, parseEspnEvents(sj), { tol: p.espnOrigin ? 1 : 3 });
      if (res.skipped) { skipped++; continue; }
      for (const m of res.items) { const k = `${m.kind}|${p.ours.gameId}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; items++; }
      await new Promise((r) => setTimeout(r, 100));
    }
    stats.eventGames = done; stats.eventSkipped = skipped;
    console.log(`[verify] 선수 이벤트 대조(ESPN) 경기 ${done}/${cand.length}건 (원본 불안정 제외 ${skipped}), 불일치 ${items}건`);
  }

  // ── MLB: 우리는 네이버 출처, 대조 원본은 MLB 공식 StatsAPI(독립) ─────────────────────────
  // KBO·NPB 는 StatsAPI 에 종목은 있으나 경기 데이터가 비어 있고(2026-10-26 확인), 공식 사이트는 robots.txt 로 자동 수집을 막아 독립 원본이 없다(=> 내부 정합성 규칙으로만 점검).
  try {
    const lo = new Date(now - BACK * 86400e3).toISOString().slice(0, 10), hi = new Date(now + 86400e3).toISOString().slice(0, 10);
    const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${lo}&endDate=${hi}&hydrate=linescore,decisions`, { signal: AbortSignal.timeout(20000) });
    const j = r.ok ? await r.json() : { dates: [] };
    const ourMlb = recent.filter((g) => g.league === 'MLB');
    const teamEn = rj('team-name-en.json', {});
    // 우리 MLB 영문명은 도시 이름("San Francisco")이거나 약칭("NY Yankees"·"LA Dodgers")이라, 공식 팀명("San Francisco Giants")이 그 이름으로 시작하는지로 맞춘다(NY/LA 는 풀네임으로 확장).
    const mlbSame = (ours, officialName) => {
      if (!ours) return false;
      const a = ours.toLowerCase().replace(/^ny /, 'new york ').replace(/^la /, 'los angeles ').trim();
      const b = String(officialName || '').toLowerCase();
      return b.startsWith(a) || (a === 'athletics' && /athletics/.test(b));
    };
    const evs = [];
    for (const d of j.dates || []) for (const x of d.games || []) {
      if (x.gameType && !/^[RFDLWP]$/.test(x.gameType)) continue; // 시범경기·올스타 제외(정규·포스트시즌만)
      evs.push({ id: String(x.gamePk), startMs: Date.parse(x.gameDate), completed: x.status?.abstractGameState === 'Final' && !/postponed|cancel/i.test(x.status?.detailedState || ''), state: ({ Final: 'post', Live: 'in', Preview: 'pre' })[x.status?.abstractGameState] || 'pre', status: x.status?.detailedState || '', home: { name: x.teams?.home?.team?.name, score: x.teams?.home?.score }, away: { name: x.teams?.away?.team?.name, score: x.teams?.away?.score }, decisions: x.decisions });
    }
    // 더블헤더: (MLB 경기, 우리 경기) 후보를 시각 차이순으로 1:1 배정 — 같은 날 같은 두 팀의 1·2차전을 서로 바꿔 짝짓지 않게 한다.
    const pairs = [];
    for (const ev of evs) for (const g of ourMlb) {
      const dt = Math.abs(ourTs(g) - ev.startMs);
      if (dt > 8 * 3600e3) continue;
      const is = (ko, evName) => mlbSame(teamEn[ko], evName);
      if ((is(g.home, ev.home.name) && is(g.away, ev.away.name)) || (is(g.home, ev.away.name) && is(g.away, ev.home.name))) pairs.push({ ev, g, dt });
    }
    pairs.sort((p, q) => p.dt - q.dt);
    const usedEv = new Set(), usedG = new Set();
    let mlbM = 0;
    for (const p of pairs) {
      if (usedEv.has(p.ev.id) || usedG.has(p.g.gameId)) continue;
      usedEv.add(p.ev.id); usedG.add(p.g.gameId); mlbM++; stats.matched++; stats.events++;
      for (const m of compareGame(p.g, p.ev, now)) { const k = `${m.kind}|${p.g.gameId}`; found[k] = { key: k, ...m, text: m.text.replace('ESPN', 'MLB') }; }
      // 승·패·세이브 투수: 공식 결정 기록과 선수 ID 로 비교(종료 경기, 최근 EVENT_BACK 일)
      if (p.ev.completed && p.g.status === 'completed' && ourTs(p.g) > now - Number(process.env.VERIFY_EVENT_BACK_DAYS || 2) * 86400e3) {
        for (const m of compareMlbDecisions(p.g, p.ev.decisions)) { const k = `${m.kind}|${p.g.gameId}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; }
        // 홈런·도루: 공식 박스스코어의 선수별 기록과 비교
        try {
          const br = await fetch(`https://statsapi.mlb.com/api/v1/game/${p.ev.id}/boxscore`, { signal: AbortSignal.timeout(15000) });
          if (br.ok) {
            const flip = !mlbSame(teamEn[p.g.home], p.ev.home.name);
            for (const m of compareMlbBoxscore(p.g, await br.json(), flip)) { const k = `${m.kind}|${p.g.gameId}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; }
            stats.mlbBox = (stats.mlbBox || 0) + 1;
          }
        } catch { /* 일시 오류는 건너뛴다 */ }
      }
    }
    stats.unmatched += evs.length - mlbM;
    console.log(`[verify] MLB statsapi games=${evs.length} matched=${mlbM}`);
  } catch (e) { console.warn('[verify] MLB 대조 실패:', e.message); }

  // ── MLB StatsAPI 산하(AAA)·윈터리그(AFL·LMP·LIDOM·ABL·PWL·LVBP)·LMB: 우리 크롤러도 같은 API 가 출처라 "독립 원본"은 아니다.
  // 대신 gamePk(gameId 끝 숫자)로 다시 받아 1:1 대조해 크롤러 쪽 문제(종료가 안 반영된 박제, 점수 불일치, 취소·연기 미반영, AAA 누락)를 잡는다.
  try {
    const lo = new Date(now - BACK * 86400e3).toISOString().slice(0, 10), hi = new Date(now + 86400e3).toISOString().slice(0, 10);
    const byPk = new Map();
    for (const sport of [11, 17, 23]) {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=${sport}&startDate=${lo}&endDate=${hi}&hydrate=linescore`, { signal: AbortSignal.timeout(25000) });
      if (!r.ok) continue;
      for (const d of (await r.json()).dates || []) for (const x of d.games || []) {
        byPk.set(String(x.gamePk), { sport, startMs: Date.parse(x.gameDate), completed: x.status?.abstractGameState === 'Final' && !/postponed|cancel|suspended/i.test(x.status?.detailedState || ''), state: ({ Final: 'post', Live: 'in', Preview: 'pre' })[x.status?.abstractGameState] || 'pre', status: x.status?.detailedState || '', home: { score: x.teams?.home?.score }, away: { score: x.teams?.away?.score } });
      }
    }
    const mine = recent.filter((g) => /^(AAA|AFL|LMP|LIDOM|ABL|PWL|LVBP|LMB)_MLBSTATS_\d+$/.test(g.gameId || ''));
    const seen = new Set();
    let n = 0;
    for (const g of mine) {
      const pk = g.gameId.split('_').pop();
      const ev = byPk.get(pk);
      seen.add(pk);
      if (!ev) continue;
      n++; stats.matched++; stats.events++;
      for (const m of compareGame(g, ev, now)) { const k = `${m.kind}(StatsAPI 재조회)|${g.gameId}`; found[k] = { key: k, kind: `${m.kind}(StatsAPI 재조회)`, text: m.text.replace('ESPN', 'StatsAPI') }; }
    }
    // AAA 는 전체 경기를 받아 오므로 StatsAPI 에 있는데 우리에 없는 경기를 누락으로 본다(종료·진행 중·곧 시작하는 것만).
    const ourPk = new Set(games.filter((g) => /^AAA_MLBSTATS_/.test(g.gameId || '')).map((g) => g.gameId.split('_').pop()));
    for (const [pk, ev] of byPk) {
      if (ev.sport !== 11 || ourPk.has(pk) || seen.has(pk)) continue;
      if (!(ev.completed || ev.state === 'in') || ev.startMs < now - BACK * 86400e3) continue;
      const k = `경기 누락(StatsAPI 재조회)|AAA|${pk}`;
      found[k] = { key: k, kind: '경기 누락(StatsAPI 재조회)', text: `${new Date(ev.startMs + KST).toISOString().slice(0, 16).replace('T', ' ')} AAA gamePk ${pk} — StatsAPI 에는 있는데 우리 목록에 없음` };
    }
    stats.affil = { api: byPk.size, mine: mine.length, matched: n };
    console.log(`[verify] StatsAPI 산하·윈터리그 재조회 api=${byPk.size} ours=${mine.length} matched=${n}`);
  } catch (e) { console.warn('[verify] StatsAPI 산하·윈터리그 대조 실패:', e.message); }

  // ── 네이버 출처 전 리그(KBO·NPB·K리그·MLB·EPL·KBL·WKBL …): 독립 원본이 없는 리그의 보완책 ─────────────────────────────
  // KBO·NPB·K리그·KBL·WKBL 은 공식 사이트가 robots.txt 로 자동 수집을 막고 StatsAPI 에도 경기 데이터가 없어 독립 원본이 없다.
  // 대신 같은 네이버의 "경기 상세"를 경기마다 새로 받아 우리 값과 비교한다 — 제공처 자체 오류는 못 잡지만, 우리 크롤러의 버그·오래된 값(제프 치바 건처럼 0-0 정정이 막혀 1-0 으로 남은 경우)은 잡는다.
  try {
    const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)'; // 'crawler' 가 든 UA 는 네이버가 무응답 처리한다
    const bkNaver = (rj('basketball/games.json', { games: [] }).games || []).filter((g) => g.src === 'naver' && g.t > now - (BACK + 1) * 86400e3 && g.t < now + 86400e3).map((g) => ({ id: g.id.replace(/^nv:/, ''), label: `${g.date} ${g.lg} ${g.h.k}-${g.a.k}`, completed: g.st === 'final', hs: g.h.s, as: g.a.s, t: g.t, key: g.id }));
    const soccerBaseball = recent.filter((g) => g.gameId && !String(g.gameId).includes('_') && (g.status === 'completed' || g.status === 'live' || ourTs(g) < now - 3 * 3600e3)).map((g) => ({ id: g.gameId, label: `${g.date} ${g.league} ${g.home} vs ${g.away}`, completed: g.status === 'completed', hs: g.homeScore, as: g.awayScore, t: ourTs(g), key: g.gameId, status: g.status, ours: g }));
    const targets = [...soccerBaseball, ...bkNaver].slice(0, 260);
    let n = 0, bad = 0;
    for (const t of targets) {
      let det;
      try { const r = await fetch(`https://api-gw.sports.naver.com/schedule/games/${t.id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); if (!r.ok) continue; const jj = await r.json(); det = jj.result?.game || jj.result; } catch { continue; }
      if (!det) continue;
      n++;
      const nCompleted = det.statusCode === 'RESULT' && !det.cancel;
      const nh = det.homeTeamScore, na = det.awayTeamScore;
      if (nCompleted && !t.completed && now - t.t > 3.5 * 3600e3) { const k = `결과 미반영(네이버 상세)|${t.key}`; found[k] = { key: k, kind: '결과 미반영(네이버 상세)', text: `${t.label} — 네이버 상세는 종료 ${nh}-${na}, 우리는 미종료`, }; bad++; }
      else if (nCompleted && t.completed && Number.isFinite(nh) && Number.isFinite(na) && Number.isFinite(t.hs) && Number.isFinite(t.as) && (nh !== t.hs || na !== t.as)) { const k = `스코어 불일치(네이버 상세)|${t.key}`; found[k] = { key: k, kind: '스코어 불일치(네이버 상세)', text: `${t.label} — 우리 ${t.hs}-${t.as} / 네이버 상세 ${nh}-${na}` }; bad++; }
      // K리그: 네이버 /record 의 이벤트 타임라인(골·자책골·경고·퇴장)을 새로 받아 우리 득점자·카드와 비교
      const isK = t.ours && /^K리그/.test(t.ours.league) && (t.ours.scorers || t.ours.cards);
      const isBase = t.ours && /^(KBO|NPB|MLB)$/.test(t.ours.league) && t.ours.highlights;
      if ((isK || isBase) && t.completed && now - t.t > 2 * 3600e3 && now - t.t < 2 * 86400e3) {
        try {
          const rr = await fetch(`https://api-gw.sports.naver.com/schedule/games/${t.id}/record`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
          const rec = rr.ok ? (await rr.json()).result?.recordData : null;
          if (isK && rec && Array.isArray(rec.timeline) && rec.timeline.length) {
            for (const m of compareNaverTimeline(t.ours, rec.timeline)) { const k = `${m.kind}|${t.key}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; bad++; }
            stats.naverTimeline = (stats.naverTimeline || 0) + 1;
          }
          if (isBase && rec) {
            const box = rec.battersBoxscore || (rec.homeBatter || rec.awayBatter ? { home: rec.homeBatter, away: rec.awayBatter } : null);
            if (box) {
              for (const m of compareNaverBatters(t.ours, box)) { const k = `${m.kind}|${t.key}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; bad++; }
              stats.naverBatters = (stats.naverBatters || 0) + 1;
            }
          }
        } catch { /* 일시 오류는 건너뛴다 */ }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    stats.naverDetail = n;
    console.log(`[verify] 네이버 상세 재조회 ${n}/${targets.length}건 (K리그 타임라인 ${stats.naverTimeline || 0}, 야구 타자 기록 ${stats.naverBatters || 0}), 불일치 ${bad}건`);
  } catch (e) { console.warn('[verify] 네이버 상세 대조 실패:', e.message); }

  // ── 순위표 ↔ 경기 결과(독립 원본이 없는 KBO·NPB·K리그·MLB 보완): 순위표의 팀별 경기수·승무패를 우리 경기 기록으로 다시 세어 비교 ──
  try {
    const stand = rj('standings.json', {});
    let nStand = 0;
    for (const lg of ['KBO', 'NPB', 'K리그1', 'K리그2', 'MLB']) for (const m of compareStandings(games, lg, stand[lg], { nowMs: now })) { const k = `${m.kind}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; nStand++; }
    stats.standingsMismatch = nStand;
    console.log(`[verify] 순위표↔경기결과 불일치 ${nStand}건`);
  } catch (e) { console.warn('[verify] 순위표 대조 실패:', e.message); }

  // ── 농구 선수 기록(박스스코어) ───────────────────────────────────────────
  // ① 내부 정합성: 최근 14일 종료 경기 전부(로컬 계산, 요청 0) — 선수 득점 합 = 경기 점수, 선수 득점 = 필드골·3점·자유투 구성, 쿼터 합 = 최종.
  // ② 새로 받은 같은 제공처 박스스코어와 비교(최근 EVENT_BACK 일): ESPN 출처(NBA·WNBA·NBL·FIBA)는 ESPN summary, 네이버 출처(KBL·WKBL)는 네이버 /record.
  // ③ NBA: 네이버(독립) 선수 득점 분포 ↔ 우리(ESPN). 네이버 NBA 는 우리 목록에서 중복 제거돼 있어 네이버 일정을 따로 받아 맞춘다.
  try {
    const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)';
    const bkGames = (rj('basketball/games.json', { games: [] }).games || []).filter((g) => g.st === 'final' && g.boxed);
    const bkTeams = rj('basketball/teams.json', {});
    const boxCache = {};
    const boxOf = (g) => { const f = `basketball/box-${g.date.slice(0, 7)}.json`; return (boxCache[f] ||= rj(f, {}))[g.id]; };
    const EV_BACK = Number(process.env.VERIFY_EVENT_BACK_DAYS || 2);
    let nInt = 0, nFresh = 0, nNba = 0;
    for (const g of bkGames) {
      if (g.t < now - 14 * 86400e3) continue;
      const box = boxOf(g);
      if (!box) continue;
      nInt++;
      const label = `${g.date} ${g.lg} ${bkTeams[g.h.k]?.ko || g.h.k} vs ${bkTeams[g.a.k]?.ko || g.a.k}`;
      for (const m of boxInternalCheck(g, box, label)) { const k = `${m.kind}|${g.id}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; }
    }
    const fresh = bkGames.filter((g) => g.t > now - EV_BACK * 86400e3 && g.t < now - 2 * 3600e3 && (g.src === 'espn' || g.src === 'naver')).sort((a, b) => b.t - a.t).slice(0, Number(process.env.VERIFY_BK_MAX || 60));
    for (const g of fresh) {
      const ours = boxOf(g);
      if (!ours) continue;
      const label = `${g.date} ${g.lg} ${bkTeams[g.h.k]?.ko || bkTeams[g.h.k]?.en || g.h.k} vs ${bkTeams[g.a.k]?.ko || bkTeams[g.a.k]?.en || g.a.k}`;
      try {
        let fb;
        if (g.src === 'espn') {
          const slug = { NBA: 'nba', WNBA: 'wnba', NBL: 'nbl', FIBA: null }[g.lg];
          if (!slug) continue;
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/${slug}/summary?event=${g.id.split(':')[2]}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
          if (!r.ok) continue;
          fb = parseEspnBox(await r.json(), g.h.k.split(':')[2]);
        } else {
          const r = await fetch(`https://api-gw.sports.naver.com/schedule/games/${g.id.slice(3)}/record`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
          if (!r.ok) continue;
          fb = parseNaverBox((await r.json()).result?.recordData);
        }
        if (!fb) continue;
        nFresh++;
        for (const m of compareBoxFresh(g, ours, fb, label)) { const k = `${m.kind}|${g.id}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; }
      } catch { /* 일시 오류는 건너뛴다 */ }
      await new Promise((r) => setTimeout(r, 120));
    }
    // ③ NBA 네이버 ↔ ESPN
    try {
      const nbaMine = bkGames.filter((g) => g.lg === 'NBA' && g.src === 'espn' && g.t > now - EV_BACK * 86400e3 && g.t < now - 2 * 3600e3);
      if (nbaMine.length) {
        const from = new Date(now - (EV_BACK + 1) * 86400e3).toISOString().slice(0, 10), to = new Date(now + 86400e3).toISOString().slice(0, 10);
        const sr = await fetch(`https://api-gw.sports.naver.com/schedule/games?fields=basic&upperCategoryId=wbasketball&categoryId=nba&fromDate=${from}&toDate=${to}&size=500`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        const nGames = sr.ok ? ((await sr.json()).result?.games || []).filter((x) => x.statusCode === 'RESULT' && !x.cancel) : [];
        for (const g of nbaMine) {
          const ha = nbaNorm(bkTeams[g.h.k]?.abbr), aa = nbaNorm(bkTeams[g.a.k]?.abbr);
          const hit = nGames.find((x) => x.gameDate === g.date && new Set([nbaNorm(x.homeTeamCode), nbaNorm(x.awayTeamCode)]).has(ha) && new Set([nbaNorm(x.homeTeamCode), nbaNorm(x.awayTeamCode)]).has(aa));
          const ours = boxOf(g);
          if (!hit || !ours) continue;
          const rr = await fetch(`https://api-gw.sports.naver.com/schedule/games/${hit.gameId}/record`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
          const nb = rr.ok ? parseNaverBox((await rr.json()).result?.recordData) : null;
          if (!nb) continue;
          nNba++;
          const label = `${g.date} NBA ${bkTeams[g.h.k]?.abbr}-${bkTeams[g.a.k]?.abbr}`;
          for (const m of compareNbaNaverVsOurs(g, ours, nb, nbaNorm(hit.homeTeamCode) !== ha, label)) { const k = `${m.kind}|${g.id}|${m.key}`; found[k] = { key: k, kind: m.kind, text: m.text }; }
          await new Promise((r) => setTimeout(r, 120));
        }
      }
    } catch (e) { console.warn('[verify] NBA 선수 기록 네이버 대조 실패:', e.message); }
    stats.bkBox = { internal: nInt, fresh: nFresh, nba: nNba };
    console.log(`[verify] 농구 박스스코어: 내부정합성 ${nInt}경기, 재조회 ${nFresh}경기, NBA 네이버↔ESPN ${nNba}경기`);
  } catch (e) { console.warn('[verify] 농구 박스스코어 대조 실패:', e.message); }

  // ── NBA: 네이버·ESPN 두 독립 소스를 농구 크롤러가 비교해 남긴 결과(basketball/xsource-mismatch.json) ──────────
  // 갱신이 6시간 넘게 멈췄으면(크롤러 정체) 그 자체도 알린다.
  try {
    const xs = rj('basketball/xsource-mismatch.json', null);
    if (xs && Array.isArray(xs.items)) {
      for (const it of xs.items) { const k = `${it.kind}|${it.id}`; found[k] = { key: k, kind: it.kind, text: it.text }; }
      stats.xsource = xs.items.length;
      if (now - (xs.updated || 0) > 6 * 3600e3) { const k = '농구 소스 대조 정체|xsource'; found[k] = { key: k, kind: '농구 소스 대조 정체', text: `basketball/xsource-mismatch.json 이 ${Math.round((now - (xs.updated || 0)) / 3600e3)}시간째 갱신되지 않음(농구 크롤러 정체)` }; }
    }
  } catch (e) { console.warn('[verify] 농구 교차검증 읽기 실패:', e.message); }

  // 원본(ESPN 등) 자체가 틀렸다고 확인된 경기는 verify-source-exceptions.json 에 등록 — 고칠 수 없는 건이 매일 알림을 만들지 않게 제외하고, 제외 건수는 상태에 남긴다.
  const exceptions = rj('verify-source-exceptions.json', []);
  let suppressed = 0;
  for (const k of Object.keys(found)) if (exceptions.some((e) => e.match && k.includes(e.match))) { delete found[k]; suppressed++; }
  stats.suppressed = suppressed;
  const stateFile = path.join(ROOT, 'verify-source-state.json');
  const state = rj('verify-source-state.json', { pending: {}, alerted: {} });
  const { toSend, pending, alerted } = decideAlerts(found, state, now);
  console.log(`[verify] leagues=${stats.leagues} espnEvents=${stats.events} matched=${stats.matched} unmatched=${stats.unmatched} found=${Object.keys(found).length} toSend=${toSend.length}`);
  for (const it of Object.values(found)) console.log(`  · ${it.kind}: ${it.text}`);
  if (!dry) fs.writeFileSync(stateFile, JSON.stringify({ pending, alerted, lastRun: new Date(now).toISOString(), stats }, null, 1) + '\n');

  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!toSend.length || dry || !hook) return;
  const groups = {};
  for (const it of toSend) (groups[it.kind] ??= []).push(it.text);
  const lines = [`🔎 **ShadeSide 원본(ESPN) 대조 — 불일치 ${toSend.length}건** (연속 2회 확인된 것만)`];
  for (const [kind, arr] of Object.entries(groups)) { lines.push(`**${kind}** (${arr.length})`); for (const t of arr.slice(0, 8)) lines.push(`• ${t}`); if (arr.length > 8) lines.push(`… 외 ${arr.length - 8}건`); }
  let buf = '';
  for (const l of lines) { if ((buf + l + '\n').length > 1800) { await post(hook, buf); buf = ''; } buf += l + '\n'; }
  if (buf) await post(hook, buf);
}
async function post(hook, content) { try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); } catch (e) { console.warn('[verify] discord 실패:', e.message); } }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

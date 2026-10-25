// 원본 대조(2026-10-26, "정기적으로 대조 알람 적용해서 디스코드에") — 우리 games.json 을 ESPN 스코어보드(독립 원본)와 직접 비교해 불일치를 Discord 로 알린다.
// 점검: ① 결과 미반영(ESPN 종료인데 우리는 예정/진행중) ② 스코어 불일치 ③ 킥오프 시각 불일치 ④ 경기 누락(ESPN 출처 리그에 ESPN 경기가 우리에게 없음) ⑤ 상태 불일치(취소·연기)
// 오탐 방지: 크롤러 반영 지연(2~5분)·ESPN 정정 지연 때문에 같은 불일치가 "연속 2회 실행"에서 보일 때만 알림, 같은 알림은 24시간에 1회.
// 실행: node scripts/verify-against-source.mjs [--dry]   (DISCORD_WEBHOOK_URL)  — 상태: verify-source-state.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAMS, normalizeTeamName } from './espn-soccer-teams.mjs';
import { ASIA_TEAMS } from './espn-asia-soccer-teams.mjs';
import { BATCH2_TEAMS } from './espn-world-soccer-teams.mjs';

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
  } else if (ev.state === 'pre' && ours.status === 'scheduled') {
    const diff = Math.abs(ev.startMs - kickoff);
    if (diff > 25 * 60e3 && ev.startMs - nowMs < 48 * 3600e3 && ev.startMs > nowMs) out.push({ kind: '킥오프 시각 불일치', text: `${label} — 우리 ${ours.time} / ESPN ${new Date(ev.startMs + KST).toISOString().slice(11, 16)} (차이 ${Math.round(diff / 60e3)}분)` });
  }
  if (/postponed|canceled|cancelled|suspended/i.test(ev.status || '') && ours.status !== 'postponed' && ours.status !== 'cancelled' && nowMs - kickoff > -6 * 3600e3 && nowMs - kickoff < 36 * 3600e3) out.push({ kind: '연기·취소 미반영', text: `${label} — ESPN ${ev.status}, 우리는 ${ours.status}` });
  return out;
}

// 두 번 연속 보인 것만 알림 + 24시간 중복 억제(순수 함수)
export function decideAlerts(found, state, nowMs = Date.now()) {
  const pending = {};
  const toSend = [];
  for (const [key, item] of Object.entries(found)) {
    const prev = state.pending?.[key];
    pending[key] = { n: (prev?.n || 0) + 1, first: prev?.first || nowMs };
    const last = state.alerted?.[key] || 0;
    if (pending[key].n >= 2 && nowMs - last >= 24 * 3600e3) toSend.push(item);
  }
  const alerted = { ...(state.alerted || {}) };
  for (const it of toSend) alerted[it.key] = nowMs;
  for (const k of Object.keys(alerted)) if (nowMs - alerted[k] > 7 * 86400e3) delete alerted[k]; // 오래된 기록 정리
  return { toSend, pending, alerted };
}

// ── 실행부 ────────────────────────────────────────────────
async function main() {
  const games = rj('games.json', []);
  // 리그 코드 ↔ ESPN 슬러그
  const slugByCode = {};
  const t1 = fs.readFileSync(path.join(ROOT, 'scripts/fetch-schedule.mjs'), 'utf8');
  const blk = t1.slice(t1.indexOf('const ESPN_LEAGUE_SLUG = {'), t1.indexOf('};', t1.indexOf('const ESPN_LEAGUE_SLUG = {')));
  for (const m of blk.matchAll(/^\s*([A-Z0-9_]+):\s*'([^']+)'/gm)) slugByCode[m[1]] = m[2];
  const espnOriginCodes = new Set();
  for (const f of ['fetch-espn-soccer-leagues', 'fetch-espn-world-soccer-leagues', 'fetch-espn-asia-soccer-leagues']) for (const m of fs.readFileSync(path.join(ROOT, `scripts/${f}.mjs`), 'utf8').matchAll(/code: '([A-Z0-9_]+)', slug: '([^']+)'/g)) { slugByCode[m[1]] = m[2]; espnOriginCodes.add(m[1]); }
  // 국제대회·컵은 ESPN 경기 정의(중립 구장·승부차기 합산 등)가 달라 오탐이 많아 국내 리그만 대조
  const SKIP = /FRIENDLY|CUP|^UCL$|^UEL$|^UECL$|^UNL$|^WORLDCUP|^WCQ|SUPERCUP|ASIAN|OLYMPIC|^ACL2?$|AFRICA|COMMUNITY|U\d\d|WOMEN/;
  const codes = Object.keys(slugByCode).filter((c) => !SKIP.test(c));
  // ESPN 영문 팀명 → 우리 한글 팀명 후보(네이버 출처 리그 매칭용)
  const byEn = new Map();
  const addEn = (en, ko) => { const k = normalizeTeamName(en || ''); if (k && ko) (byEn.get(k) ?? byEn.set(k, new Set()).get(k)).add(ko); };
  for (const [ko, en] of Object.entries(rj('team-name-en.json', {}))) if (!ko.startsWith('bk:') && !ko.includes('|')) addEn(en, ko);
  // 위키데이터 기반 별칭(team-aliases.json: 한글 → 여러 언어 표기)의 영문(라틴) 표기도 역색인에 넣는다.
  for (const [ko, arr] of Object.entries(rj('team-aliases.json', {}))) for (const al of arr) if (/^[ -~À-ɏ]+$/.test(al) && al.length >= 4) addEn(al, ko);
  for (const grp of [TEAMS, ASIA_TEAMS, BATCH2_TEAMS]) for (const lg of Object.values(grp)) for (const [k, v] of Object.entries(lg || {})) if (v?.ko) { (byEn.get(k) ?? byEn.set(k, new Set()).get(k)).add(v.ko); if (v.en) addEn(v.en, v.ko); }
  const koSet = (en) => byEn.get(normalizeTeamName(en || '')) || new Set();

  const byId = new Map(games.map((g) => [g.gameId, g]));
  const recent = games.filter((g) => ourTs(g) > now - 4 * 86400e3 && ourTs(g) < now + 2 * 86400e3);
  const found = {};
  const stats = { leagues: 0, events: 0, matched: 0, unmatched: 0 };
  const days = [-3, -2, -1, 0, 1].map((d) => ymd(now + d * 86400e3));
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
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }

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

// KBO/NPB 종료 경기의 pid 없는 선수 참조(하이라이트·선발·승패세) 보강용 경기별 이름→pid 표를 만든다.
// 전수조사(2026-10-12): pid 없는 참조가 3~7월 경기에 몰려 있다 — pid 지원이 들어가기 전 캐시된 경기들. 네이버 /record 의 박스스코어는
// 경기 안의 모든 타자·투수 이름과 코드를 주므로(팀 안에서 이름이 유일) 경기 단위로 정확히 연결할 수 있다.
// games.json 은 fetch-schedule 이 2분마다 다시 쓰므로 여기서 직접 고치지 않고 game-player-pids.json({gameId:{이름:{b?,p?}}})만 만든다.
// fetch-schedule 의 attachPlayerPids 가 이 표를 읽어 붙인다. 차단 방지: 요청 간격 1.2s, 실행당 예산, 429/403 즉시 중단.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(REPO_ROOT, 'game-player-pids.json');
const BUDGET = Number(process.env.PID_BACKFILL_BUDGET || 300);
const DELAY_MS = Number(process.env.PID_BACKFILL_DELAY_MS || 1200);
const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startersMissing = (g) => (g.homePitcher && !g.homePitcherPid) || (g.awayPitcher && !g.awayPitcherPid);
const refsMissing = (g) => {
  for (const s of ['home', 'away']) for (const h of g.highlights?.[s] || []) if (h.player && !h.pid) return true;
  for (const f of ['homePitcher', 'awayPitcher', 'winPitcher', 'losePitcher', 'savePitcher']) if (g[f] && !g[`${f}Pid`]) return true;
  return false;
};

export function mapFromRecord(league, rd) {
  const out = {};
  const put = (name, role, pid) => { const n = String(name ?? '').trim(); if (n && pid) (out[n] ??= {})[role] = pid; };
  if (league === 'KBO') {
    for (const s of ['home', 'away']) {
      for (const p of rd?.battersBoxscore?.[s] || []) put(p?.name, 'b', p?.playerCode && `kbo:b:${p.playerCode}`);
      for (const p of rd?.pitchersBoxscore?.[s] || []) put(p?.name, 'p', p?.pcode && `kbo:p:${p.pcode}`);
    }
  } else if (league === 'NPB') {
    for (const k of ['homeBatter', 'awayBatter']) for (const p of rd?.[k] || []) put(p?.name, 'b', p?.playerId && `npb:${p.playerId}`);
    for (const k of ['homePitcher', 'awayPitcher']) for (const p of rd?.[k] || []) put(p?.name, 'p', p?.playerId && `npb:${p.playerId}`);
  }
  // 선발투수(기록지 투수 목록의 첫 번째) — 일정 API 의 선발 표기와 박스스코어 표기가 다르게 음역되는 경우("우에자와"↔"우와사와")가 있어
  // 이름 일치 대신 위치로 확정한다. 투수 목록은 등판 순서라 첫 번째가 선발이다.
  const first = (arr, pidOf) => (Array.isArray(arr) && arr[0] ? pidOf(arr[0]) : undefined);
  if (league === 'KBO') {
    out._s = { home: first(rd?.pitchersBoxscore?.home, (p) => p?.pcode && `kbo:p:${p.pcode}`), away: first(rd?.pitchersBoxscore?.away, (p) => p?.pcode && `kbo:p:${p.pcode}`) };
  } else if (league === 'NPB') {
    out._s = { home: first(rd?.homePitcher, (p) => p?.playerId && `npb:${p.playerId}`), away: first(rd?.awayPitcher, (p) => p?.playerId && `npb:${p.playerId}`) };
  }
  return out;
}

async function main() {
  const games = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'games.json'), 'utf8'));
  let table = {};
  try { table = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }
  const todo = games
    .filter((g) => (g.league === 'KBO' || g.league === 'NPB') && g.status === 'completed' && g.gameId && ((!(g.gameId in table) && refsMissing(g)) || (g.gameId in table && !('_s' in table[g.gameId]) && startersMissing(g))))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // 최근 경기부터
  console.log(`[pid-backfill] todo=${todo.length} budget=${BUDGET}`);
  let done = 0, fails = 0, stop = '';
  for (const g of todo) {
    if (done >= BUDGET) break;
    let res;
    try { res = await fetch(`https://api-gw.sports.naver.com/schedule/games/${g.gameId}/record`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); }
    catch { if (++fails >= 5) { stop = '연속 네트워크 실패'; break; } await sleep(DELAY_MS * 2); continue; }
    if (res.status === 429 || res.status === 403) { stop = `HTTP ${res.status} — 즉시 중단`; break; }
    if (!res.ok) { if (++fails >= 5) { stop = `연속 HTTP ${res.status}`; break; } await sleep(DELAY_MS * 2); continue; }
    fails = 0;
    let j; try { j = await res.json(); } catch { j = null; }
    table[g.gameId] = mapFromRecord(g.league, j?.result?.recordData); // 빈 표도 저장해 재시도 방지
    done++;
    if (done % 50 === 0) { await fs.writeFile(OUT, JSON.stringify(table) + '\n', 'utf8'); console.log(`[pid-backfill] ${done}/${Math.min(BUDGET, todo.length)}`); }
    await sleep(DELAY_MS);
  }
  await fs.writeFile(OUT, JSON.stringify(table) + '\n', 'utf8');
  console.log(`[pid-backfill] done=${done}${stop ? ' STOP: ' + stop : ''}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

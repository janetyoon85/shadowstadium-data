// 대표팀 경기에서 ID 없는 선수를 클럽 경기의 ESPN ID로 "검증을 통과한 경우에만" 연결하는 표를 만든다(2026-10-12).
// 이름(성만 있는 표기가 대부분)만으로 연결하면 틀린 선수가 붙는다 — 실측 31건 중 15건이 다른 나라 동명 선수였다(푸에르토리코 "리베라"=프랑스 선수 등).
// 그래서 다음을 전부 만족할 때만 연결한다:
//  ① 성인 남자 대표팀 대회(친선·네이션스리그·월드컵·예선)의 득점·카드 참조 — 청소년·여자 대회는 동명 선수 위험이 커서 제외
//  ② 같은 이름이 클럽 경기 데이터에 ESPN ID 정확히 하나로만 존재(동명이인 후보가 둘 이상이면 포기)
//  ③ ESPN 선수 프로필의 국적이 그 대표팀과 일치
//  ④ 그 대표팀의 위키 선수단 데이터가 있으면 선수단에 같은 성이 있어야 함(없는 팀은 ①~③만)
// 결과: national-pid-links.json {"팀|이름": {pid, at}} (탈락도 {pid:null, at}로 남겨 90일간 재조회 안 함). games.json 은 건드리지 않고
// fetch-schedule 의 attachPlayerPids 가 이 표를 읽어 붙인다. 차단 방지: 요청 간격 0.4s, 실행당 예산, 429/403 즉시 중단.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(REPO_ROOT, 'national-pid-links.json');
const BUDGET = Number(process.env.NATIONAL_PID_BUDGET || 200);
const DELAY_MS = Number(process.env.NATIONAL_PID_DELAY_MS || 400);
const RETRY_AFTER_MS = 90 * 86400000;
const UA = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
export const NATIONAL_SENIOR_LEAGUES = new Set(['AMATCHFRIENDLY', 'UNL', 'WORLDCUP', 'WCQUEFA']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const ALIASES = { southkorea: ['korearepublic', 'korea', 'southkorea'], unitedstates: ['usa', 'unitedstates'], czechia: ['czechrepublic', 'czechia'], turkiye: ['turkey', 'turkiye'], ivorycoast: ['cotedivoire', 'ivorycoast'], capeverde: ['caboverde', 'capeverde'], northmacedonia: ['macedonia', 'northmacedonia'], stlucia: ['saintlucia', 'stlucia'], stkittsandnevis: ['saintkittsandnevis', 'stkittsandnevis'], stvincent: ['saintvincent', 'stvincent', 'saintvincentandthegrenadines'] };

export function nationalityMatches(citizenship, wantEn) {
  const a = norm(citizenship);
  const b = norm(wantEn);
  if (!a || !b) return false;
  if (a === b) return true;
  const set = new Set([b, ...(ALIASES[b] || [])]);
  for (const [k, v] of Object.entries(ALIASES)) if (v.includes(b)) { set.add(k); v.forEach((x) => set.add(x)); }
  return set.has(a);
}

async function main() {
  const games = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'games.json'), 'utf8'));
  const teamEn = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'team-name-en.json'), 'utf8'));
  const rosters = {};
  for (let i = 0; i < 16; i++) { try { Object.assign(rosters, JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'team-rosters', `${i.toString(16)}.json`), 'utf8'))); } catch { /* 없음 */ } }
  let links = {};
  try { links = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }

  // 클럽 경기(성인 대표팀 대회 제외)의 이름 → ESPN ID 집합
  const clubByName = new Map();
  for (const g of games) {
    if (NATIONAL_SENIOR_LEAGUES.has(g.league)) continue;
    for (const s of ['home', 'away']) for (const k of ['scorers', 'cards']) for (const x of g[k]?.[s] || []) {
      if (!x.n || !String(x.pid || '').startsWith('espn:')) continue;
      if (!clubByName.has(x.n)) clubByName.set(x.n, new Set());
      clubByName.get(x.n).add(x.pid);
    }
  }
  const todo = new Map(); // "팀|이름" → pid 후보
  const now = Date.now();
  for (const g of games) {
    if (!NATIONAL_SENIOR_LEAGUES.has(g.league)) continue;
    for (const s of ['home', 'away']) {
      const team = g[s];
      if (!team || /\(|여자|U\d/.test(team)) continue; // 여자·연령대 팀 제외
      for (const k of ['scorers', 'cards']) for (const x of g[k]?.[s] || []) {
        if (x.pid || !x.n) continue;
        const key = `${team}|${x.n}`;
        const prev = links[key];
        if (prev && (prev.pid || now - prev.at < RETRY_AFTER_MS)) continue;
        const c = clubByName.get(x.n);
        if (c && c.size === 1) todo.set(key, [...c][0]);
        else if (!prev) links[key] = { pid: null, at: now, why: c ? 'ambiguous' : 'no-club-pid' }; // 후보 없음/모호는 기록만
      }
    }
  }
  console.log(`[national-pids] candidates=${todo.size} budget=${BUDGET}`);
  let done = 0, ok = 0, fails = 0, stop = '';
  for (const [key, pid] of todo) {
    if (done >= BUDGET) break;
    const [team] = key.split('|');
    let res;
    try { res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/${pid.slice(5)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); }
    catch { if (++fails >= 5) { stop = '연속 네트워크 실패'; break; } await sleep(DELAY_MS * 2); continue; }
    if (res.status === 429 || res.status === 403) { stop = `HTTP ${res.status} — 즉시 중단`; break; }
    if (!res.ok) { if (++fails >= 5) { stop = `연속 HTTP ${res.status}`; break; } await sleep(DELAY_MS * 2); continue; }
    fails = 0;
    done++;
    const a = (await res.json().catch(() => null))?.athlete;
    const natOk = !!a && nationalityMatches(a.citizenship || a.birthPlace?.country, teamEn[team]);
    let rosterOk = true;
    const ros = rosters[team];
    if (natOk && ros && String(ros[0]?.id).startsWith('wk:')) {
      const sur = norm(String(a.displayName || '').trim().split(/\s+/).pop());
      rosterOk = ros.some((p) => norm(String(p.n).trim().split(/\s+/).pop()) === sur);
    }
    if (natOk && rosterOk) { links[key] = { pid, at: now }; ok++; }
    else links[key] = { pid: null, at: now, why: natOk ? 'not-in-squad' : 'nationality' };
    await sleep(DELAY_MS);
  }
  await fs.writeFile(OUT, JSON.stringify(links) + '\n', 'utf8');
  console.log(`[national-pids] checked=${done} linked=${ok}${stop ? ' STOP: ' + stop : ''}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

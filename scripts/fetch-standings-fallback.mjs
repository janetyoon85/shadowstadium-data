// 순위표 보조 갱신 실행기 — K리그1·2 (다음스포츠). 순위표가 뒤처졌을 때만 요청한다(평소 0건). 실행: node scripts/fetch-standings-fallback.mjs [--dry]
import './lib/watch-429.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAUM_STANDINGS_LEAGUE, isStale, fromDaumRank, mergeStandings } from './lib/standings-fallback.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry') || process.env.STANDINGS_DRY === '1';
const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const standings = JSON.parse(await fs.readFile(path.join(ROOT, 'standings.json'), 'utf-8'));
  const games = JSON.parse(await fs.readFile(path.join(ROOT, 'games.json'), 'utf-8'));
  let changedAny = false;
  for (const [league, code] of Object.entries(DAUM_STANDINGS_LEAGUE)) {
    const cur = standings[league];
    if (!cur?.rows?.length) continue;
    const season = String(cur.seasonCode || new Date().getUTCFullYear());
    const completed = games.filter((g) => g.league === league && g.status === 'completed' && String(g.date || '').startsWith(season)).length;
    if (!isStale(cur.rows, completed)) { console.log(`[standings] ${league}: 최신(완료 ${completed}경기) — 요청 없음`); continue; }
    console.log(`[standings] ${league}: 뒤처짐(완료 ${completed}경기 > 순위표) — 다음스포츠 조회`);
    try {
      const r = await fetch(`https://sports.daum.net/api/arms/SPORTS_TEAM_RANK?leagueCode=${code}&seasonKey=${season}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const m = mergeStandings(cur.rows, fromDaumRank(j?.document?.list));
      if (!m.ok) { console.warn(`[standings] ${league}: 적용 안 함 — ${m.reason}`); continue; }
      if (!m.changed) { console.log(`[standings] ${league}: 변경 없음`); continue; }
      console.log(`[standings] ${league}: 갱신 ${m.rows.slice(0, 3).map((x) => `${x.rank}.${x.team}(${x.pts})`).join(' ')} …${DRY ? ' [DRY]' : ''}`);
      standings[league] = { ...cur, updatedAt: new Date().toISOString(), rows: m.rows };
      changedAny = true;
    } catch (e) {
      console.warn(`[standings] ${league} 조회 실패: ${String(e.message).slice(0, 60)}`);
    }
    await sleep(1200);
  }
  if (!changedAny || DRY) return;
  await fs.writeFile(path.join(ROOT, 'standings.json'), JSON.stringify(standings, null, 2) + '\n', 'utf-8');
}

main().catch((e) => { console.error('[fatal]', e); process.exit(1); });

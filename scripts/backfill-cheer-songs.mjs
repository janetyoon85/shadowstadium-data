// 선수 응원가 영상 ID 사전백필(2026-09-30, 사용자: "선수정보에 응원가 실행 누르면 응원가 들리는지") —
// 앱은 cheer-songs.json만 읽고(런타임 YouTube 호출 0회), 크롤러가 YouTube Data API로 미리 검색.
// 대상: 전 리그 선수(pid 있는 선수). 우선순위 = KBO/K리그(한글 응원가) → MLB → ESPN 축구, 그 안에선 최근 활동순.
// NPB는 Naver 이름이 성만 있어(예: "군지") 검색 정확도가 낮아 제외.
// 쿼터: search.list 1회=100유닛, 무료 하루 10,000유닛 → 하루 ~100건. 예산 95건/실행, 하루 1회.
// 결과: {v,t}(찾음) | null(검색했지만 없음, 캐시) | 쿼터 초과/일시오류는 캐시 안 함(다음 실행 재시도).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCheerSongQuery, pickCheerSong } from './cheer-song-pick.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLAYERS_PATH = path.join(REPO_ROOT, 'players.json');
const TEAM_EN_PATH = path.join(REPO_ROOT, 'team-name-en.json');
const OUT_PATH = path.join(REPO_ROOT, 'cheer-songs.json');
const BUDGET = 30; // 하이라이트 검색(highlights-search.json, 65건/일)이 우선, 응원가는 남는 몫
const API_KEY = process.env.YOUTUBE_API_KEY;

// 농구: KBL(nbk:kbl, 한글 응원가)은 KBO급 최우선, NBA/WNBA는 축구 다음. NBL/FIBA/기타 코드는 제외.
const tierOf = (id) => (id.startsWith('kbo:') || id.startsWith('naver:') || id.startsWith('nbk:kbl:') ? 0 : id.startsWith('mlb:') ? 1 : id.startsWith('espn:') || id.startsWith('espnbk:nba:') || id.startsWith('espnbk:wnba:') ? 2 : 9);

// 인기도 근사(무료 API에 인기 지표가 없어 리그 급으로 대체): 빅리그/국제대회 우선, 한국 국적 선수는 최우선.
const TOP_LEAGUES = ['EPL', 'LALIGA', 'SERIEA', 'BUNDESLIGA', 'LIGUE1', 'UCL', 'WORLDCUP', 'UEL', 'AMATCHFRIENDLY', 'WCQUEFA', 'ACL', 'EREDIVISIE', 'MLS', 'SAUDI', 'J1', 'UECL'];
function popularityRank(p) {
  const apps = p.appearances || [];
  if (apps.some((a) => /korea/i.test(a.nat || ''))) return 0;
  const best = Math.min(...apps.map((a) => { const i = TOP_LEAGUES.indexOf(a.league); return i < 0 ? 99 : i; }), 99);
  return 1 + best;
}

async function fetchMlbFullNames(personIds) {
  const out = {};
  if (personIds.length === 0) return out;
  try {
    const res = await fetch('https://statsapi.mlb.com/api/v1/people?personIds=' + personIds.join(','), { signal: AbortSignal.timeout(15000) });
    if (res.ok) for (const x of (await res.json()).people || []) out['mlb:' + x.id] = x.fullName;
  } catch {}
  return out;
}

async function searchYoutube(q) {
  const url = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '5', q,
    videoEmbeddable: 'true', videoSyndicated: 'true', regionCode: 'KR', relevanceLanguage: 'ko', key: API_KEY,
  });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.status === 403) return { quota: true };
    if (!res.ok) return { error: res.status };
    return { items: (await res.json()).items || [] };
  } catch {
    return { error: 'network' };
  }
}

async function main() {
  if (!API_KEY) { console.error('[cheer-songs] YOUTUBE_API_KEY missing'); process.exit(1); }
  const players = JSON.parse(await fs.readFile(PLAYERS_PATH, 'utf-8'));
  const teamEn = JSON.parse(await fs.readFile(TEAM_EN_PATH, 'utf-8'));
  const bkTeams = {};
  try {
    players.push(...JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'players.json'), 'utf-8')));
    Object.assign(bkTeams, JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'teams.json'), 'utf-8')));
  } catch {}
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }

  const targets = players
    .filter((p) => p.id && tierOf(p.id) < 9 && !(p.id in cache))
    .sort((a, b) => tierOf(a.id) - tierOf(b.id) || (tierOf(a.id) === 2 ? popularityRank(a) - popularityRank(b) : 0) || (b.lastSeenDate || '').localeCompare(a.lastSeenDate || ''))
    .slice(0, BUDGET);
  const mlbNames = await fetchMlbFullNames(targets.filter((p) => p.id.startsWith('mlb:')).map((p) => p.id.slice(4)));

  let used = 0;
  let found = 0;
  let stopped = '';
  for (const p of targets) {
    const rawTeam = p.appearances?.[0]?.team;
    const bk = bkTeams[rawTeam];
    const team = bk ? bk.ko || bk.en : rawTeam;
    const teamE = bk ? bk.en : teamEn[rawTeam];
    let q;
    let spec;
    if (p.id.startsWith('kbo:') || p.id.startsWith('naver:') || p.id.startsWith('nbk:')) {
      q = buildCheerSongQuery(team, p.name);
      spec = { full: p.name, songWords: ['응원가'] };
    } else {
      const isMlb = p.id.startsWith('mlb:');
      const full = isMlb ? mlbNames[p.id] : p.name;
      if (!full) continue; // 영문 풀네임을 못 얻음 — 캐시 안 하고 다음 실행에 재시도.
      q = buildCheerSongQuery(teamE, full, isMlb ? 'walk-up song' : 'song chant');
      spec = { full, surname: full.split(' ').slice(-1)[0], teamEn: teamE, songWords: ['song', 'chant', 'walk-up', 'walkup', 'anthem'] };
    }
    used++;
    const r = await searchYoutube(q);
    if (r.quota) { stopped = 'quota'; break; }
    if (r.error) continue;
    const hit = pickCheerSong(r.items, spec);
    cache[p.id] = hit;
    if (hit) found++;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  await fs.writeFile(OUT_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[cheer-songs] cached=${Object.keys(cache).length} thisRunUsed=${used} thisRunFound=${found}${stopped ? ' stopped=' + stopped : ''}`);
}

main().catch((e) => { console.error('[cheer-songs] FATAL:', e); process.exit(1); });

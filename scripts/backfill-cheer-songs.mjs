// 선수 응원가 영상 ID 사전백필(2026-09-30, 사용자: "선수정보에 응원가 실행 누르면 응원가 들리는지") —
// 앱은 cheer-songs.json만 읽고(런타임 YouTube 호출 0회), 크롤러가 YouTube Data API로 미리 검색.
// 대상: KBO(kbo:) / K리그(naver:) 선수 — 고유 응원가가 있는 리그. 최근 활동 선수 우선.
// 쿼터: search.list 1회=100유닛, 무료 하루 10,000유닛 → 하루 ~100건. 예산 95건/실행, 하루 1회.
// 반환 3상태: {v,t}(찾음) | null(검색했지만 없음, 캐시) | 쿼터 초과 시 즉시 중단(캐시 안 함).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCheerSongQuery, pickCheerSong } from './cheer-song-pick.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLAYERS_PATH = path.join(REPO_ROOT, 'players.json');
const OUT_PATH = path.join(REPO_ROOT, 'cheer-songs.json');
const BUDGET = 95;
const API_KEY = process.env.YOUTUBE_API_KEY;

async function searchYoutube(q) {
  const url = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '5', q,
    videoEmbeddable: 'true', videoSyndicated: 'true', regionCode: 'KR', relevanceLanguage: 'ko', key: API_KEY,
  });
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (res.status === 403) return { quota: true };
  if (!res.ok) return { error: res.status };
  return { items: (await res.json()).items || [] };
}

async function main() {
  if (!API_KEY) { console.error('[cheer-songs] YOUTUBE_API_KEY missing'); process.exit(1); }
  const players = JSON.parse(await fs.readFile(PLAYERS_PATH, 'utf-8'));
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(OUT_PATH, 'utf-8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }

  const targets = players
    .filter((p) => p.id && (p.id.startsWith('kbo:') || p.id.startsWith('naver:')) && !(p.id in cache))
    .sort((a, b) => (b.lastSeenDate || '').localeCompare(a.lastSeenDate || ''));

  let used = 0, found = 0, stopped = '';
  for (const p of targets) {
    if (used >= BUDGET) break;
    used++;
    const r = await searchYoutube(buildCheerSongQuery(p.appearances?.[0]?.team, p.name));
    if (r.quota) { stopped = 'quota'; break; }
    if (r.error) continue; // 일시 오류 — 캐시 안 함, 다음 실행에 재시도.
    const hit = pickCheerSong(r.items, p.name);
    cache[p.id] = hit;
    if (hit) found++;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  await fs.writeFile(OUT_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[cheer-songs] targets=${targets.length} cached=${Object.keys(cache).length} thisRunUsed=${used} thisRunFound=${found}${stopped ? ' stopped=' + stopped : ''}`);
}

main().catch((e) => { console.error('[cheer-songs] FATAL:', e); process.exit(1); });

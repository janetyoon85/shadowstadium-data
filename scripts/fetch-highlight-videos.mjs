// 경기 하이라이트 영상(YouTube) 매칭(2026-10-05, 사용자: "경기 유튜브 하이라이트 먼저 하고 매일 남는양으로 선수 응원가").
// 공식 리그 채널의 업로드 목록에서 "양 팀 이름이 제목에 들어간 하이라이트 영상"을 종료된 경기에 연결 → highlights-video.json.
// 앱은 이 JSON만 읽음(런타임 YouTube 호출 0회). 출력: { [gameId]: { v: 영상ID, t: 제목 } } (농구는 basketball 경기 id).
// 소스: YOUTUBE_API_KEY 있으면 uploads 플레이리스트(playlistItems.list, 1유닛/50개, 페이지당) — 없으면 무료 RSS(최근 15개).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'highlights-video.json');
const API_KEY = process.env.YOUTUBE_API_KEY;
const PAGES = Number(process.env.HL_PAGES || 3);
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };

const MLB_NICK = {
  '샌프란시스코': ['giants'], '뉴욕메츠': ['mets'], '밀워키': ['brewers'], '시카고컵스': ['cubs'], '볼티모어': ['orioles'], '휴스턴': ['astros'],
  '신시내티': ['reds'], '샌디에이고': ['padres'], '세인트루이스': ['cardinals'], '필라델피아': ['phillies'], 'LA다저스': ['dodgers'], '시애틀': ['mariners'],
  '토론토': ['blue jays'], '마이애미': ['marlins'], '애틀랜타': ['braves'], '캔자스시티': ['royals'], '애리조나': ['diamondbacks', 'd-backs'], '시카고W': ['white sox'],
  '워싱턴': ['nationals'], '내셔널': ['nationals'], '디트로이트': ['tigers'], '뉴욕양키스': ['yankees'], '보스턴': ['red sox'], '텍사스': ['rangers'],
  '콜로라도': ['rockies'], '클리블랜드': ['guardians'], '미네소타': ['twins'], '피츠버그': ['pirates'], 'LA에인절스': ['angels'], '애슬레틱스': ['athletics', "a's"], '탬파베이': ['rays'],
};

// 채널: ids = 게임 리그 코드(games.json league 또는 basketball lg). must = 하이라이트 판정, 둘 다 팀 이름 필요.
export const CHANNELS = [
  { name: 'K LEAGUE', id: 'UCYVxbD_KLbC39PPW9iTBcmQ', src: 'g', leagues: ['K리그1', 'K리그2'], must: /하이라이트|highlights/i, lang: 'ko' },
  { name: 'MLB', id: 'UCoLrcjPV5PbUrUyXq5mjc_A', src: 'g', leagues: ['MLB'], must: /full game( \d+)? highlights|game \d+ highlights|\bhighlights\b.*\(/i, not: /full inning|every play|walk-off|shorts/i },
  { name: 'NBA', id: 'UCWJ2lWNubArHWmf3FIHbfcQ', src: 'bk', leagues: ['NBA'], must: /full game highlights/i },
  { name: 'MLS', id: 'UCSZbXT5TLLW_i-5W8FZpFsg', src: 'g', leagues: ['MLS'], must: /highlights/i, not: /shorts/i },
];

const norm = (s) => String(s).toLowerCase().replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[’‘]/g, "'");
const has = (title, a) => {
  const x = norm(a);
  if (!x || (/^[\x00-\x7f]+$/.test(x) && x.length < 3)) return false;
  return /^[\x00-\x7f]+$/.test(x) ? new RegExp(`(^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(title) : title.includes(x);
};
const KST = 9 * 3600e3;

async function listVideos(ch) {
  if (API_KEY) {
    const out = [];
    let token = '';
    for (let i = 0; i < PAGES; i++) {
      const u = 'https://www.googleapis.com/youtube/v3/playlistItems?' + new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId: 'UU' + ch.id.slice(2), key: API_KEY, ...(token ? { pageToken: token } : {}) });
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) { console.error(`[hl] ${ch.name} api ${r.status}`); break; }
      const j = await r.json();
      for (const it of j.items || []) out.push({ v: it.snippet?.resourceId?.videoId, t: it.snippet?.title || '', p: Date.parse(it.snippet?.publishedAt || '') });
      token = j.nextPageToken;
      if (!token) break;
    }
    if (out.length) return out;
  }
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + ch.id, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return [];
  const x = await r.text();
  return x.split('<entry>').slice(1).map((e) => ({ v: (e.match(/<yt:videoId>([^<]*)/) || [])[1], t: (e.match(/<title>([^<]*)/) || [])[1] || '', p: Date.parse((e.match(/<published>([^<]*)/) || [])[1] || '') }));
}

async function main() {
  const out = await readJson(OUT, {});
  const games = await readJson(path.join(ROOT, 'games.json'), []);
  const bk = (await readJson(path.join(ROOT, 'basketball', 'games.json'), { games: [] })).games || [];
  const bkTeams = await readJson(path.join(ROOT, 'basketball', 'teams.json'), {});
  const teamEn = await readJson(path.join(ROOT, 'team-name-en.json'), {});
  const aliasG = (lg, name) => (lg === 'MLB' ? MLB_NICK[name] || [] : [name, teamEn[name]].filter(Boolean));
  const aliasBk = (k) => { const t = bkTeams[k]; if (!t) return []; const w = (t.en || '').split(' '); return [t.en, w.slice(-1)[0], w.slice(-2).join(' '), t.ko].filter(Boolean); };

  let added = 0;
  for (const ch of CHANNELS) {
    let vids = [];
    try { vids = await listVideos(ch); } catch (e) { console.error(`[hl] ${ch.name} fail`, e.message); continue; }
    vids = vids.filter((v) => v.v && v.p && ch.must.test(norm(v.t)) && !(ch.not && ch.not.test(norm(v.t)))).sort((a, b) => a.p - b.p);
    const pool = ch.src === 'bk'
      ? bk.filter((g) => ch.leagues.includes(g.lg) && g.st === 'final').map((g) => ({ id: g.id, ts: g.t, h: aliasBk(g.h.k), a: aliasBk(g.a.k) }))
      : games.filter((g) => ch.leagues.includes(g.league) && g.status === 'completed').map((g) => ({ id: g.gameId, ts: Date.parse(`${g.date}T${g.time && /^\d\d:\d\d$/.test(g.time) ? g.time : '12:00'}:00Z`) - KST, h: aliasG(g.league, g.home), a: aliasG(g.league, g.away) }));
    for (const v of vids) {
      const title = norm(v.t);
      const cands = pool.filter((g) => g.ts <= v.p + 3600e3 && v.p - g.ts < 4 * 86400e3 && g.h.some((x) => has(title, x)) && g.a.some((x) => has(title, x)) && !out[g.id]);
      cands.sort((x, y) => y.ts - x.ts);
      const g = cands[0];
      if (!g) continue;
      out[g.id] = { v: v.v, t: v.t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') };
      added++;
    }
    console.log(`[hl] ${ch.name} videos=${vids.length}`);
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  await fs.writeFile(OUT, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`[hl] added=${added} total=${Object.keys(sorted).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// 경기 하이라이트 영상(YouTube) 매칭(2026-10-05, 사용자: "경기 유튜브 하이라이트 먼저 하고 매일 남는양으로 선수 응원가").
// 공식 리그 채널의 업로드 목록에서 "양 팀 이름이 제목에 들어간 하이라이트 영상"을 종료된 경기에 연결 → highlights-video.json.
// 앱은 이 JSON만 읽음(런타임 YouTube 호출 0회). 출력: { [gameId]: { v: 영상ID, t: 제목 } } (농구는 basketball 경기 id).
// 소스: 평시 무료 RSS(최근 15개, 쿼터 0). 마지막 딥스캔 후 6시간 지난 실행에서만(하루 4회, highlights-deep.json에 기록) uploads 플레이리스트(playlistItems.list 페이지당 1유닛)로 깊게 훑음(≈250유닛/일). HL_DEEP=1이면 강제.
import { readFileSync, writeFileSync } from 'node:fs';
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

const KBO_NICK = { '한화': ['이글스'], 'KIA': ['타이거즈'], '두산': ['베어스'], 'NC': ['다이노스'], '롯데': ['자이언츠'], 'SSG': ['랜더스'], 'KT': ['위즈'], '삼성': ['라이온즈'], 'LG': ['트윈스'], '키움': ['히어로즈'] };
const NPB_JA = { '소프트뱅크': ['ソフトバンク'], '오릭스': ['オリックス'], '지바롯데': ['ロッテ'], '라쿠텐': ['楽天'], '세이부': ['西武'], '닛폰햄': ['日本ハム'], '한신': ['阪神'], '요미우리': ['巨人', '読売'], '야쿠르트': ['ヤクルト'], '히로시마': ['広島'], '주니치': ['中日'], '요코하마': ['DeNA', '横浜'] };
const GENERIC = new Set(['united', 'city', 'real', 'sporting', 'athletic', 'manchester', 'atletico', 'inter', 'club', 'sport', 'town', 'rovers', 'wanderers', 'olympique', 'borussia', 'racing', 'deportivo', 'national', 'fenerbahce fc']);
const J_EXTRA = { '가와사키': ['川崎フロンターレ', '川崎F'], '나가사키': ['V・ファーレン長崎', '長崎'] };

// 채널: ids = 게임 리그 코드(games.json league 또는 basketball lg). must = 하이라이트 판정, 둘 다 팀 이름 필요.
export const CHANNELS = [
  { name: 'K LEAGUE', id: 'UCYVxbD_KLbC39PPW9iTBcmQ', src: 'g', leagues: ['K리그1', 'K리그2'], must: /하이라이트|highlights/i, lang: 'ko' },
  { name: 'MLB', id: 'UCoLrcjPV5PbUrUyXq5mjc_A', src: 'g', leagues: ['MLB'], must: /full game( \d+)? highlights|game \d+ highlights|\bhighlights\b.*\(/i, not: /full inning|every play|walk-off|shorts/i },
  { name: 'NBA', id: 'UCWJ2lWNubArHWmf3FIHbfcQ', src: 'bk', leagues: ['NBA'], must: /full game highlights/i },
  { name: 'KBO', id: 'UCoVz66yWHzVsXAFG8WhJK9g', src: 'g', leagues: ['KBO'], must: /야구 하이라이트/ },
  { name: 'NPB Pacific', id: 'UC0v-pxTo1XamIDE-f__Ad0Q', src: 'g', leagues: ['NPB'], must: /試合ハイライト/ },
  { name: 'J.League', id: 'UCyzs0YrgWiL2wdROpajnO1Q', src: 'g', leagues: ['J1'], must: /ハイライト/, not: /プレーまとめ|shorts/ },
  { name: 'B.LEAGUE', id: 'UC4NpGzqd6nnntf8ehYC50-A', src: 'bk', leagues: ['BLEAGUE1', 'BLEAGUE2', 'BLEAGUE3'], must: /ハイライト/, not: /プレーまとめ/ },
  { name: 'WNBA', id: 'UCO9a_ryN_l7DIDS-VIt-zmw', src: 'bk', leagues: ['WNBA'], must: /full game highlights/i },
  { name: 'Coupang Play', id: 'UCnBht7BrOx-A328KFXgysqQ', src: 'g', leagues: ['EPL', 'LALIGA', 'BUNDESLIGA', 'ACL'], must: /highlights|하이라이트/i, not: /shorts|women|femenil/i, script: 'latin' },
  { name: 'SPOTV', id: 'UCtm_QoN2SIxwCE-59shX7Qg', src: 'g', leagues: ['UCL', 'UEL', 'UECL', 'SERIEA', 'UNL'], must: /하이라이트/, not: /shorts|mlb|kbo|nba/i, script: 'ko' },
  { name: 'Serie A', id: 'UCBJeMCIeLQos7wacox4hmLQ', src: 'g', leagues: ['SERIEA'], must: /highlights/i, not: /classic|full match|shorts/i, script: 'latin' },
  { name: 'Bundesliga', id: 'UC6UL29enLNe4mqwTfAyeNuw', src: 'g', leagues: ['BUNDESLIGA'], must: /highlights/i, not: /shorts/i, script: 'latin' },
  { name: 'beIN Turkiye', id: 'UCPe9vNjHF1kEExT5kHwc7aw', src: 'g', leagues: ['TURKEY'], must: /highlights|özet/i, not: /shorts/i, script: 'latin' },
  { name: 'ESPN Nederland', id: 'UCXnPiEv1DoUCDAqDUXT9shQ', src: 'g', leagues: ['EREDIVISIE'], must: /samenvatting/i, script: 'latin' },
  { name: 'AFA', id: 'UCJmCVoUfCBQb9lcfXIS8nXQ', src: 'g', leagues: ['ARGENTINA'], must: /resumen/i, script: 'latin' },
  { name: 'ge tv', id: 'UCgCKagVhzGnZcuP9bSMgMCg', src: 'g', leagues: ['BRASILEIRAO'], must: /highlights/i, not: /femin|women/i, script: 'latin' },
  { name: 'TUDN Mexico', id: 'UCTIyEyDNHPrwVFPhpi5dm0A', src: 'g', leagues: ['LIGAMX'], must: /highlights/i, not: /femenil|shorts/i, script: 'latin' },
  { name: 'sport tv', id: 'UCINrlkmrXi4a-kOl6unb51A', src: 'g', leagues: ['PORTUGAL'], must: /resumo/i, script: 'latin' },
  { name: 'TVING KBL', id: 'UC8JtQf77wqhVpOQ8Cze8JjA', src: 'bk', leagues: ['KBL'], must: /프로농구.*하이라이트/ },
  { name: 'DAZN Baseball', id: 'UCyeDNNizMGbVsn_8Ttc3FIw', src: 'g', leagues: ['NPB'], must: /ハイライト/, not: /プレーまとめ/ },
  { name: 'MLS', id: 'UCSZbXT5TLLW_i-5W8FZpFsg', src: 'g', leagues: ['MLS'], must: /highlights/i, not: /shorts/i },
];

const norm = (s) => String(s).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[’‘]/g, "'");
const has = (title, a) => {
  const x = norm(a);
  if (!x || (/^[\x00-\x7f]+$/.test(x) && x.length < 3)) return false;
  return /^[\x00-\x7f]+$/.test(x) ? new RegExp(`(^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(title) : title.includes(x);
};
const KST = 9 * 3600e3;

const NOW = new Date();
const DEEP_F = new URL('../highlights-deep.json', import.meta.url);
let lastDeep = 0;
try { lastDeep = JSON.parse(readFileSync(DEEP_F, 'utf8')).t || 0; } catch {}
const DEEP = process.env.HL_DEEP === '1' || NOW.getTime() - lastDeep >= 6 * 3600e3;

async function viaApi(ch, pages) {
  {
    const out = [];
    let token = '';
    for (let i = 0; i < pages; i++) {
      const u = 'https://www.googleapis.com/youtube/v3/playlistItems?' + new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId: 'UU' + ch.id.slice(2), key: API_KEY, ...(token ? { pageToken: token } : {}) });
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) { console.error(`[hl] ${ch.name} api ${r.status}`); break; }
      const j = await r.json();
      for (const it of j.items || []) out.push({ v: it.snippet?.resourceId?.videoId, t: it.snippet?.title || '', p: Date.parse(it.snippet?.publishedAt || '') });
      token = j.nextPageToken;
      if (!token) break;
    }
    return out;
  }
}

async function viaRss(ch) {
  try {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + ch.id, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return [];
    const x = await r.text();
    return x.split('<entry>').slice(1).map((e) => ({ v: (e.match(/<yt:videoId>([^<]*)/) || [])[1], t: (e.match(/<title>([^<]*)/) || [])[1] || '', p: Date.parse((e.match(/<published>([^<]*)/) || [])[1] || '') }));
  } catch { return []; }
}

async function listVideos(ch) {
  if (API_KEY && DEEP) { const o = await viaApi(ch, PAGES); if (o.length) return o; }
  const o = await viaRss(ch);
  if (o.length || !API_KEY) return o;
  return viaApi(ch, 1);
}

async function main() {
  const out = await readJson(OUT, {});
  const games = await readJson(path.join(ROOT, 'games.json'), []);
  const bk = (await readJson(path.join(ROOT, 'basketball', 'games.json'), { games: [] })).games || [];
  const bkTeams = await readJson(path.join(ROOT, 'basketball', 'teams.json'), {});
  const teamEn = await readJson(path.join(ROOT, 'team-name-en.json'), {});
  const tAl = await readJson(path.join(ROOT, 'team-aliases.json'), {});
  const aliasG = (lg, name) => {
    if (lg === 'MLB') return MLB_NICK[name] || [];
    if (lg === 'KBO') return KBO_NICK[name] || [];
    if (lg === 'NPB') return NPB_JA[name] || [];
    if (lg === 'J1') return [...(J_EXTRA[name] || []), ...(tAl[name] || []).filter((a) => /[぀-ヿ]/.test(a) || /^[一-鿿]{2,}/.test(a))];
    return [name, teamEn[name]].filter(Boolean);
  };
  const aliasS = (name, script) => {
    const ok = (a) => script === 'ko' ? /[가-힣]/.test(a) : /^[ -~À-ɏ]+$/.test(a);
    return [...new Set([name, teamEn[name], ...(tAl[name] || [])].filter(Boolean).map(norm))].filter((a) => ok(a) && a.length >= (script === 'ko' ? 2 : 4) && !GENERIC.has(a));
  };
  const prep = (t, ch) => (ch.script === 'latin' ? t.replace(/\butd\b\.?/g, 'united').replace(/\bman\b/g, 'manchester') : t);
  const aliasBk = (k) => { const t = bkTeams[k]; if (!t) return []; const w = (t.en || '').split(' '); if (t.lg === 'KBL' && t.ko) return [t.ko, t.ko.split(' ').slice(-1)[0]]; return [t.en, w.slice(-1)[0], w.slice(-2).join(' '), t.ko, t.ja].filter(Boolean); };

  let added = 0;
  for (const ch of CHANNELS) {
    let vids = [];
    try { vids = await listVideos(ch); } catch (e) { console.error(`[hl] ${ch.name} fail`, e.message); continue; }
    vids = vids.filter((v) => v.v && v.p && ch.must.test(norm(v.t)) && !(ch.not && ch.not.test(norm(v.t)))).sort((a, b) => a.p - b.p);
    const pool = ch.src === 'bk'
      ? bk.filter((g) => ch.leagues.includes(g.lg) && g.st === 'final').map((g) => ({ id: g.id, ts: g.t, h: aliasBk(g.h.k), a: aliasBk(g.a.k) }))
      : games.filter((g) => ch.leagues.includes(g.league) && g.status === 'completed').map((g) => ({ id: g.gameId, ts: Date.parse(`${g.date}T${g.time && /^\d\d:\d\d$/.test(g.time) ? g.time : '12:00'}:00Z`) - KST, h: ch.script ? aliasS(g.home, ch.script) : aliasG(g.league, g.home), a: ch.script ? aliasS(g.away, ch.script) : aliasG(g.league, g.away) }));
    for (const v of vids) {
      const title = prep(norm(v.t), ch);
      const cands = pool.filter((g) => g.ts <= v.p + 3600e3 && v.p - g.ts < 4 * 86400e3 && g.h.some((x) => has(title, x)) && g.a.some((x) => has(title, x)) && !out[g.id]);
      cands.sort((x, y) => y.ts - x.ts);
      const g = cands[0];
      if (!g) continue;
      out[g.id] = { v: v.v, t: v.t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') };
      added++;
    }
    console.log(`[hl] ${ch.name} videos=${vids.length}`);
  }
  if (API_KEY && DEEP) writeFileSync(DEEP_F, JSON.stringify({ t: NOW.getTime() }) + '\n');
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  await fs.writeFile(OUT, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`[hl] added=${added} total=${Object.keys(sorted).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

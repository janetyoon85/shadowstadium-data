// 경기 하이라이트 영상(YouTube) 매칭(2026-10-05, 사용자: "경기 유튜브 하이라이트 먼저 하고 매일 남는양으로 선수 응원가").
// 공식 리그 채널의 업로드 목록에서 "양 팀 이름이 제목에 들어간 하이라이트 영상"을 종료된 경기에 연결 → highlights-video.json.
// 앱은 이 JSON만 읽음(런타임 YouTube 호출 0회). 출력: { [gameId]: { v: 영상ID, t: 제목 } } (농구는 basketball 경기 id).
// 소스: 평시 무료 RSS(최근 15개, 쿼터 0). 마지막 딥스캔 후 6시간 지난 실행에서만(하루 4회, highlights-deep.json에 기록) uploads 플레이리스트(playlistItems.list 페이지당 1유닛)로 깊게 훑음(≈250유닛/일). HL_DEEP=1이면 강제.
import { readFileSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowSearch, seedStats } from './search-yield.mjs';

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
// 공식 채널 제목의 오타(예: J.LEAGUE International 의 'FC Machina Zelvia' — Machida 의 오기, 2026-10-10)도 같은 팀으로 매칭하기 위한 영문 보조 별칭.
const LATIN_TYPO = { '마치다 젤비아': ['FC Machina Zelvia', 'Machina Zelvia'] , '다룰 탁짐': ['조호르'], '바이킹': ['비킹', '비킹 FK'] };
const J_EXTRA = { '가와사키': ['川崎フロンターレ', '川崎F'], '나가사키': ['V・ファーレン長崎', '長崎'] };

// 채널: ids = 게임 리그 코드(games.json league 또는 basketball lg). must = 하이라이트 판정, 둘 다 팀 이름 필요.
export const CHANNELS = [
  { name: 'K LEAGUE', id: 'UCYVxbD_KLbC39PPW9iTBcmQ', src: 'g', leagues: ['K리그1', 'K리그2'], must: /하이라이트|highlights/i, lang: 'ko' },
  { name: 'MLB', id: 'UCoLrcjPV5PbUrUyXq5mjc_A', src: 'g', leagues: ['MLB'], must: /full game( \d+)? highlights|game \d+ highlights|\bhighlights\b.*\(/i, not: /full inning|every play|walk-off|shorts/i },
  { name: 'NBA', id: 'UCWJ2lWNubArHWmf3FIHbfcQ', src: 'bk', leagues: ['NBA'], must: /full game highlights/i },
  // 정규시즌 제목은 "[A vs B] 10.12(월) 야구 하이라이트｜…"인데 포스트시즌은 "[A vs B] 10.14(수) WC 1차전 하이라이트｜…"로 "야구"가 빠진다(2026-10-14 두산-LG 와일드카드 영상이 7시간 늦게 붙음).
  // 그래서 "[A vs B] … 하이라이트"로 시작하는 풀 하이라이트면 모두 받는다(크보모먼트·선수 클립은 이 형식이 아니라 제외).
  { name: 'KBO', id: 'UCoVz66yWHzVsXAFG8WhJK9g', src: 'g', leagues: ['KBO'], must: /^\[?[^\]|｜[]{1,24} vs [^\]|｜[]{1,24}\].*하이라이트/ }, // 2026-10-18: 공식 영상 제목이 "LG트윈스 vs KIA타이거즈] …"처럼 여는 "["를 빠뜨린 채 올라와 24시간 뒤에야 붙었다 — 여는 대괄호는 선택.
  { name: 'NPB Pacific', id: 'UC0v-pxTo1XamIDE-f__Ad0Q', src: 'g', leagues: ['NPB'], must: /試合ハイライト/ },
  // 2026-10-13: 일본어 J.League 공식 채널 영상은 한국에서 거의 전부 재생 불가(J1 82건 중 81건) — 영문 채널(J.LEAGUE International)은 한국에서 열린다(사용자 확인). 같은 경기의 대체 후보(alts)로 쓰인다.
  { name: 'J.LEAGUE International', handle: 'JLEAGUEInternational', src: 'g', leagues: ['J1'], must: /highlights/i, not: /shorts|classic|top goals|goal of|best of|preview|press|interview|mid-season|awards/i, script: 'latin' },
  { name: 'J.League', id: 'UCyzs0YrgWiL2wdROpajnO1Q', src: 'g', leagues: ['J1'], must: /ハイライト/, not: /プレーまとめ|shorts/ },
  { name: 'B.LEAGUE', id: 'UC4NpGzqd6nnntf8ehYC50-A', src: 'bk', leagues: ['BLEAGUE1', 'BLEAGUE2', 'BLEAGUE3'], must: /ハイライト/, not: /プレーまとめ/ },
  { name: 'WNBA', id: 'UCO9a_ryN_l7DIDS-VIt-zmw', src: 'bk', leagues: ['WNBA'], must: /full game highlights/i },
  { name: 'Coupang Play', id: 'UCnBht7BrOx-A328KFXgysqQ', src: 'g', leagues: ['EPL', 'LALIGA', 'BUNDESLIGA', 'ACL'], must: /highlights|하이라이트/i, not: /shorts|women|femenil/i, script: 'latin' },
  // 같은 채널의 한국어 제목(2026-10-14: "[ACLE] 상하이 하이강 vs 대전 2분 하이라이트" 가 영문 별칭(latin)으로는 안 맞아 누락) — 한국어 팀명으로 따로 매칭. 먼저 붙은 영문 영상이 있으면 대체 후보(alts)로 들어가고, 앱은 한국어 설정이면 한국어 제목을 우선한다.
  { name: 'Coupang Play (ko)', id: 'UCnBht7BrOx-A328KFXgysqQ', src: 'g', leagues: ['EPL', 'LALIGA', 'BUNDESLIGA', 'ACL', 'ACL2'], must: /하이라이트/, not: /shorts|women|femenil|여자/i, script: 'ko' },
  { name: 'SPOTV', id: 'UCtm_QoN2SIxwCE-59shX7Qg', src: 'g', leagues: ['UCL', 'UEL', 'UECL', 'SERIEA', 'UNL', 'ASIANGAMESFOOTBALL'], must: /하이라이트/, not: /shorts|mlb|kbo|nba/i, script: 'ko' },
  { name: 'Serie A', id: 'UCBJeMCIeLQos7wacox4hmLQ', src: 'g', leagues: ['SERIEA', 'COPPAITALIA'], must: /highlights/i, not: /classic|full match|shorts/i, script: 'latin' },
  { name: 'Bundesliga', id: 'UC6UL29enLNe4mqwTfAyeNuw', src: 'g', leagues: ['BUNDESLIGA'], must: /highlights/i, not: /shorts/i, script: 'latin' },
  { name: 'beIN Turkiye', id: 'UCPe9vNjHF1kEExT5kHwc7aw', src: 'g', leagues: ['TURKEY'], must: /highlights|özet/i, not: /shorts/i, script: 'latin' },
  { name: 'ESPN Nederland', id: 'UCXnPiEv1DoUCDAqDUXT9shQ', src: 'g', leagues: ['EREDIVISIE'], must: /samenvatting/i, script: 'latin' },
  { name: 'AFA', id: 'UCJmCVoUfCBQb9lcfXIS8nXQ', src: 'g', leagues: ['ARGENTINA'], must: /resumen/i, script: 'latin' },
  { name: 'ge tv', id: 'UCgCKagVhzGnZcuP9bSMgMCg', src: 'g', leagues: ['BRASILEIRAO'], must: /highlights/i, not: /femin|women/i, script: 'latin' },
  { name: 'TUDN Mexico', id: 'UCTIyEyDNHPrwVFPhpi5dm0A', src: 'g', leagues: ['LIGAMX'], must: /highlights/i, not: /femenil|shorts/i, script: 'latin' },
  { name: 'sport tv', id: 'UCINrlkmrXi4a-kOl6unb51A', src: 'g', leagues: ['PORTUGAL'], must: /resumo/i, script: 'latin' },
  // 2026-10-13 허용 목록 추가(사용자 결정). 최근 업로드를 확인한 결과 두 채널 모두 씨름·태권도·UFC·테니스·당구와 "#KBL/#WKBL" 선수 클립 위주라 지금은 경기 하이라이트가 거의 없다 —
  // 팀 이름 두 개가 제목에 있어야 매칭되므로 선수 클립은 걸리지 않고, 앞으로 KBL·WKBL 경기 하이라이트를 올리면 자동으로 후보(alts)가 된다.
  { name: 'tvN SPORTS', id: 'UCtybqqaTj6Nx74Azdz1KrsA', src: 'bk', leagues: ['KBL', 'WKBL'], must: /하이라이트/, not: /shorts|ufc|pba|씨름|태권도|테니스|당구/i, lang: 'ko' },
  { name: 'MBC Sports+', id: 'UCMkrtzkegsLZJ1s6H7S0eKw', src: 'bk', leagues: ['KBL', 'WKBL'], must: /하이라이트/, not: /shorts|ufc|pba|씨름|태권도|테니스|당구/i, lang: 'ko' },
  { name: 'TVING KBL', id: 'UC8JtQf77wqhVpOQ8Cze8JjA', src: 'bk', leagues: ['KBL'], must: /프로농구.*하이라이트/ },
  { name: 'DAZN Baseball', id: 'UCyeDNNizMGbVsn_8Ttc3FIw', src: 'g', leagues: ['NPB'], must: /ハイライト/, not: /プレーまとめ/ },
  { name: 'Win Sports', id: 'UCZjpA3YBPXvJv3pg4SPEjfw', src: 'g', leagues: ["COLOMBIA"], must: /resumen y goles/i, not: /#shorts|femenin|golazo|atajada|#laligaxwin/i, script: 'latin' },
  { name: 'AUFTV', id: 'UC0jQd1_qQAT4an-dDaG1Sww', src: 'g', leagues: ["URUGUAY"], must: /\| (resumen|hl largo) \|/i, not: /sub-\d|juveniles|femenin|segunda profesional/i, script: 'latin' },
  { name: 'Tigo Sports PY', id: 'UCDnZ8zbVWLaVfuDmNuWq7rw', src: 'g', leagues: ["PARAGUAY"], must: /\d+-\d+ .*(clausura|apertura|fecha)/i, not: /femenino|intermedia|copa efe|copa paraguay/i, script: 'latin' },
  { name: 'TNT Sports Chile', id: 'UChCovZlgNh2x6Z57MJ5fhFw', src: 'g', leagues: ["CHILE"], must: /compacto top .*liga de primera/i, not: /ascenso|replay|copa/i, script: 'latin' },
  { name: 'Liga1 Perú', id: 'UCRwbNkNPqxA7M5EAu9cnAKg', src: 'g', leagues: ["PERU"], must: /resumen del partido/i, not: /femenin/i, script: 'latin' },
  { name: 'L1MAX', id: 'UCGVHVLD7Nzw0zdIwbVhE3vw', src: 'g', leagues: ["PERU"], must: /resumen/i, not: /entrevista|conferencia|analiza|pablo guede/i, script: 'latin' },
  { name: 'Liga FUTVE', id: 'UCQc3SSO8WacZt3L0IQe08Pg', src: 'g', leagues: ["VENEZUELA"], must: /^resumen/i, not: /rueda de prensa|modo futve|femenin/i, script: 'latin' },
  { name: 'ESBN Bolivia', id: 'UCz9SQCLCddsUZOPCtZN5fpA', src: 'g', leagues: ["BOLIVIA"], must: /\| (resumen|highlights|summary)$/i, not: /femenin|sub-?\d+/i, script: 'latin' },
  { name: 'Deportes Canal 4', id: 'UCV-6dbHTGsSR-7DdwlrjosA', src: 'g', leagues: ["ELSALVADOR"], must: /resumen/i, not: /previa|habla|femenin|conferencia/i, script: 'latin' },
  { name: 'FUTVCR', id: 'UCAb1ZnVRP06U1iNEgN4POXw', src: 'g', leagues: ["AMATCHFRIENDLY"], must: /(amistoso|friendly)/i, not: /femenin|u-?\d\d|futsal/i, script: 'latin' },
  { name: 'Ligue 1 McDonalds', id: 'UCQsH5XtIc9hONE1BQjucM0g', src: 'g', leagues: ["LIGUE1"], must: /\(\d+ ?- ?\d+\).*week \d+/i, not: /all goals|top skills|highlights week/i, script: 'latin' },
  { name: 'Roshn Saudi League', id: 'UCqXAWrjSgLb0EPa_icPt-pw', src: 'g', leagues: ["SAUDI"], must: /powered by toyota/i, not: /club guide|fantasy|goal of the|top \d/i, script: 'latin' },
  { name: 'KFATV Live', id: 'UCxKEldsuGD4SmJvDO_UT8kQ', src: 'g', leagues: ["KOREACUP"], must: /korea cup.*\bHL\b/i, not: /k3|k4|league/i, script: 'latin' },
  { name: 'Real Federación Española de Fútbol', id: 'UCQBxzdEPXjy05MtpfbdtMxQ', src: 'g', leagues: ["COPADELREY"], must: /resumen.*copadelrey/i, not: /femenin|supercopa/i, script: 'latin' },
  { name: 'The Emirates FA Cup', id: 'UCChcWqwYXCEs657MQ00qVWA', src: 'g', leagues: ["FACUP"], must: /(highlights|key moments)/i, not: /crazy|goals$|best of|shorts/i, script: 'latin' },
  { name: 'EFL', id: 'UCCmo_NIuQR5eU4AvBa6sEQQ', src: 'g', leagues: ["EFL","EFLCUP"], must: /extended highlights/i, not: /women|goal hero|shorts|black history/i, script: 'latin' },
  { name: 'SPFL', id: 'UCakRszbIjjGYtFrDPeg5Ieg', src: 'g', leagues: ["SCOTLAND"], must: /\| highlights \|/i, not: /round-up|women/i, script: 'latin' },
  { name: 'TV 2 Sport', id: 'UC9QZZRUajPEoo1Q-V3MfvnQ', src: 'g', leagues: ["NORWAY"], must: /høydepunkter|\d+ - \d+/i, not: /intervju|reaksjon/i, script: 'latin' },
  { name: 'Pro League', id: 'UCZYeLruZnUvYvO6QRTiy88Q', src: 'g', leagues: ["BELGIUM"], must: /^samenvatting \|/i, not: /lwpl|doelpunten/i, script: 'latin' },
  { name: 'The AFC Hub', id: 'UCnj0TjaM0wyxkAWW_nz8_1g', src: 'g', leagues: ["ACL2"], must: /vs.*highlights.*acl two/i, not: /all highlights|top saves|top headers/i, script: 'latin' },
  { name: 'NBL Australia', id: 'UCQOt5-Mc5m03JCO_W9SWySA', src: 'bk', leagues: ["NBL"], must: /game highlights/i, not: /press conference|top 10|moments that mattered|full highlights/i },
  { name: 'FIBA Basketball', id: 'UCtInrnU3QbWqFGsdKT1GZtg', src: 'bk', leagues: ["FIBA"], must: /(extended )?highlights/i, not: /full basketball game|full game|3x3/i },
  { name: 'FIFA', id: 'UCpcTrCXblq78GZrTUTLWeBw', src: 'g', leagues: ["U20WOMENWORLDCUP","INTERCONTINENTALCUP"], must: /highlights/i, not: /world cup (19|20)\d\d.*(goals|volley)|1-min|throwback|sixty|60 seconds/i, script: 'latin' },
  { name: 'MLS', id: 'UCSZbXT5TLLW_i-5W8FZpFsg', src: 'g', leagues: ['MLS'], must: /highlights/i, not: /shorts/i },
];

const norm = (s) => String(s).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[’‘]/g, "'");
const has = (title, a) => {
  const x = norm(a);
  if (!x || (/^[\x00-\x7f]+$/.test(x) && x.length < 3)) return false;
  return /^[\x00-\x7f]+$/.test(x) ? new RegExp(`(^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(title) : title.includes(x);
};
const SA_LEAGUES = new Set(['ARGENTINA', 'URUGUAY', 'PARAGUAY', 'ELSALVADOR', 'COLOMBIA', 'CHILE', 'PERU', 'VENEZUELA', 'BOLIVIA', 'ECUADOR', 'COSTARICA']);
const LEAD_GENERIC = /^(cd|ca|cf|fc|sc|ac|as|sd|ud|cs|csd|club|deportivo)\s+/i;
const TRAIL_GENERIC = /\s+(fc|cf|club|juniors|jrs|sc)$/i;
function nameVariants(n) {
  const noParen = String(n).trim().replace(/\s*\([^)]*\)/g, '').trim();
  const l = noParen.replace(LEAD_GENERIC, '').trim();
  const t = noParen.replace(TRAIL_GENERIC, '').trim();
  const lt = l.replace(TRAIL_GENERIC, '').trim();
  const dc = noParen.replace(/\s+de\s+[^\s]+$/i, '').trim();
  // 한글 팀명은 2~3글자(대전·울산·토트넘)가 흔해 길이 4 미만이라고 버리면 한국어 제목(쿠팡플레이·SPOTV)이 매칭되지 않는다(2026-10-14 "상하이 하이강 vs 대전" 누락). 두 팀이 모두 제목에 있어야 하므로 짧아도 오매칭 위험은 낮다.
  return [...new Set([n, noParen, l, t, lt, dc])].filter((x) => x && (x.length >= 4 || (/[가-힣]/.test(x) && x.length >= 2)));
}
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

// 채널 업로드로 못 찾은 종료 경기를 search.list(100유닛)로 보강. 하이라이트 우선 — 하루 상한(SEARCH_DAILY)까지만 쓰고 나머지는 응원가 몫.
const SEARCH_F = path.join(ROOT, 'highlights-search.json');
const SEARCH_DAILY = Number(process.env.HL_SEARCH_DAILY || 65);
const SEARCH_RUN = Number(process.env.HL_SEARCH_RUN || 6);
const HL_WORD = /highlight|하이라이트|ハイライト|resumen|resumo|resume|résumé|samenvatting|özet|sintesi|zusammenfassung|melhores momentos|all goals|goles|gols|\btore\b|\bbuts\b/i;
const HL_NOT = /shorts|preview|prediction|predict|reaction|efootball|fifa \d|pes \d|simulation|gameplay|live stream|watchalong|press conference|interview/i;

async function searchFallback({ out, games, bk, bkTeams, teamEn, tAl, aliasG, aliasS, aliasBk }) {
  const st = await readJson(SEARCH_F, { day: '', used: 0, tried: {} });
  const day = new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10);
  if (st.day !== day) { st.day = day; st.used = 0; }
  // 리그별 검색 성공률 통계(2026-10-09 검색 한도 절약) — 처음엔 최근 시도 기록(tried)과 결과(out)로 1회 시드한다.
  const idLg = new Map([...games.map((g) => [g.gameId, g.league]), ...bk.map((g) => [g.id, g.lg])]);
  st.lg ??= seedStats(st.tried, (id) => !!out[id], (id) => idLg.get(id));
  const now = Date.now();
  const covered = new Set(CHANNELS.flatMap((c) => c.leagues));
  // 2026-10-07 "모든경기 하이라이트, A매치·UNL 다 포함" — 국가대표 경기는 단일 공식채널이 없어 검색 보강을 최우선으로(6시간 후부터).
  const NAT = new Set(['UNL', 'AMATCHFRIENDLY', 'ASIANGAMESFOOTBALL', 'U20WOMENWORLDCUP']);
  const names = (nm, lg) => [...new Set([...aliasG(lg, nm), ...aliasS(nm, 'latin'), ...aliasS(nm, 'ko')])];
  const cands = [
    ...games.filter((g) => g.status === 'completed').map((g) => ({ id: g.gameId, lg: g.league, ts: Date.parse(`${g.date}T${g.time && /^\d\d:\d\d$/.test(g.time) ? g.time : '12:00'}:00Z`) - KST, hn: g.home, an: g.away, h: names(g.home, g.league), a: names(g.away, g.league), qh: teamEn[g.home] || g.home, qa: teamEn[g.away] || g.away })),
    ...bk.filter((g) => g.st === 'final').map((g) => { const h = bkTeams[g.h.k] || {}, a = bkTeams[g.a.k] || {}; return { id: g.id, lg: g.lg, ts: g.t, h: aliasBk(g.h.k), a: aliasBk(g.a.k), qh: h.en || h.ko || '', qa: a.en || a.ko || '' }; }),
  ].filter((c) => !out[c.id] && c.qh && c.qa && c.ts >= now - 3 * 86400e3 && c.ts <= now - (NAT.has(c.lg) ? 6 : covered.has(c.lg) ? 12 : 3) * 3600e3)
    .filter((c) => { const t = st.tried[c.id]; return !t || (t.n < 3 && now - t.t >= 12 * 3600e3); })
    .sort((x, y) => (NAT.has(y.lg) - NAT.has(x.lg)) || (covered.has(x.lg) - covered.has(y.lg)) || y.ts - x.ts);
  let added = 0, runN = 0;
  const skippedLow = {};
  for (const c of cands) {
    if (st.used >= SEARCH_DAILY * 100 || runN >= SEARCH_RUN) break;
    // 성공률이 낮은 리그(예: AFL 0/12)는 7일에 1회만 프로브 — 검색 한도(하루 100회)를 성공률 높은 곳에 쓰기 위함.
    const ls = (st.lg[c.lg] ??= { n: 0, h: 0 });
    if (!allowSearch(ls, now)) { skippedLow[c.lg] = (skippedLow[c.lg] || 0) + 1; continue; }
    st.used += 100; runN++;
    const u = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', q: `${c.qh} vs ${c.qa} highlights`, publishedAfter: new Date(c.ts - 3600e3).toISOString(), key: API_KEY });
    let items;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (r.status === 403) { st.used = SEARCH_DAILY * 100; console.error('[hl] search quota'); break; }
      if (!r.ok) continue;
      items = (await r.json()).items || [];
    } catch { continue; }
    const t = st.tried[c.id] || { n: 0 };
    st.tried[c.id] = { n: t.n + 1, t: now };
    ls.n += 1;
    const hits = items.filter((it) => {
      const title = norm(it.snippet?.title || '');
      const p = Date.parse(it.snippet?.publishedAt || '');
      return it.id?.videoId && p - c.ts < 4 * 86400e3 && HL_WORD.test(title.normalize('NFC')) && !HL_NOT.test(title.normalize('NFC')) && c.h.some((x) => has(title, x)) && c.a.some((x) => has(title, x));
    });
    const hit = hits[0];
    if (hit) ls.h += 1;
    if (hit) {
      const fix = (t) => (t || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      out[c.id] = { v: hit.id.videoId, t: fix(hit.snippet.title) };
      // 같은 검색 결과의 나머지 일치 영상은 대체 후보(alts)로 — 대표 영상이 일부 지역에서 막혀 있어도 앱이 열리는 후보를 고른다.
      const alts = hits.slice(1, 3).map((h) => ({ v: h.id.videoId, t: fix(h.snippet.title) }));
      if (alts.length) out[c.id].alts = alts;
      added++; console.log(`[hl] search hit ${c.lg} ${c.qh} vs ${c.qa}${alts.length ? ` (+${alts.length} alts)` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const [k, v] of Object.entries(st.tried)) if (now - v.t > 7 * 86400e3) delete st.tried[k];
  await fs.writeFile(SEARCH_F, JSON.stringify(st) + '\n');
  console.log(`[hl] search used=${runN} dayUnits=${st.used} candidates=${cands.length}`);
  const skipped = Object.entries(skippedLow).map(([k, v]) => `${k}:${v}`).join(' ');
  if (skipped) console.log(`[hl] search skipped(low-yield leagues) ${skipped}`);
  return added;
}

const HANDLE_CACHE = path.join(ROOT, 'highlight-channel-ids.json');
async function resolveHandles() {
  const todo = CHANNELS.filter((c) => c.handle && !c.id);
  if (!todo.length) return;
  const cache = await readJson(HANDLE_CACHE, {});
  let dirty = false;
  for (const c of todo) {
    if (cache[c.handle]) { c.id = cache[c.handle]; continue; }
    if (!API_KEY) continue;
    try {
      const r = await fetch('https://www.googleapis.com/youtube/v3/channels?' + new URLSearchParams({ part: 'id,snippet', forHandle: c.handle, key: API_KEY }), { signal: AbortSignal.timeout(20000) });
      if (!r.ok) { console.error(`[hl] handle ${c.handle} api ${r.status}`); continue; }
      const it = ((await r.json()).items || [])[0];
      if (it?.id) { c.id = it.id; cache[c.handle] = it.id; dirty = true; console.log(`[hl] handle ${c.handle} -> ${it.id} (${it.snippet?.title})`); }
    } catch (e) { console.error('[hl] handle resolve fail', c.handle, e.message); }
  }
  if (dirty) await fs.writeFile(HANDLE_CACHE, JSON.stringify(cache, null, 1) + '\n');
}

async function main() {
  await resolveHandles();
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
  const aliasS = (name, script, lg) => {
    // norm() 이 NFD 로 분해하므로 한글 판정·길이는 NFC 로 되돌려서 한다(분해된 자모는 /[가-힣]/ 에 안 걸려 한글 별칭이 전부 버려지고 있었다 — 2026-10-14).
    const ok = (a) => script === 'ko' ? /[가-힣]/.test(a.normalize('NFC')) : /^[ -~À-ɏ]+$/.test(a);
    return [...new Set([name.replace(/\s*\((남자|여자)\)$/, ''), teamEn[name], ...(tAl[name] || []), ...(LATIN_TYPO[name] || [])].filter(Boolean).flatMap(nameVariants).map(norm))].filter((a) => ok(a) && a.normalize('NFC').length >= (script === 'ko' ? 2 : SA_LEAGUES.has(lg) ? 3 : 4) && (SA_LEAGUES.has(lg) || !GENERIC.has(a)));
  };
  const prep = (t, ch) => (ch.script === 'latin' ? t.replace(/\butd\b\.?/g, 'united').replace(/\bman\b/g, 'manchester') : t);
  const aliasBk = (k) => { const t = bkTeams[k]; if (!t) return []; const w = (t.en || '').split(' '); if (t.lg === 'KBL' && t.ko) return [t.ko, t.ko.split(' ').slice(-1)[0]]; return [t.en, w.slice(-1)[0], w.slice(-2).join(' '), t.ko, t.ja].filter(Boolean); };

  let added = 0, altAdded = 0;
  for (const ch of CHANNELS) {
    if (!ch.id) { console.error(`[hl] ${ch.name} skipped (no channel id)`); continue; }
    let vids = [];
    try { vids = await listVideos(ch); } catch (e) { console.error(`[hl] ${ch.name} fail`, e.message); continue; }
    vids = vids.filter((v) => v.v && v.p && ch.must.test(norm(v.t).normalize('NFC')) && !(ch.not && ch.not.test(norm(v.t).normalize('NFC')))).sort((a, b) => a.p - b.p);
    const pool = ch.src === 'bk'
      ? bk.filter((g) => ch.leagues.includes(g.lg) && g.st === 'final').map((g) => ({ id: g.id, ts: g.t, h: aliasBk(g.h.k), a: aliasBk(g.a.k) }))
      : games.filter((g) => ch.leagues.includes(g.league) && g.status === 'completed').map((g) => ({ id: g.gameId, ts: Date.parse(`${g.date}T${g.time && /^\d\d:\d\d$/.test(g.time) ? g.time : '12:00'}:00Z`) - KST, h: ch.script ? aliasS(g.home, ch.script, g.league) : aliasG(g.league, g.home), a: ch.script ? aliasS(g.away, ch.script, g.league) : aliasG(g.league, g.away) }));
    for (const v of vids) {
      const title = prep(norm(v.t), ch);
      const matches = pool.filter((g) => g.ts <= v.p + 3600e3 && v.p - g.ts < 4 * 86400e3 && g.h.some((x) => has(title, x)) && g.a.some((x) => has(title, x)));
      matches.sort((x, y) => y.ts - x.ts);
      const vt = v.t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const g = matches.find((m) => !out[m.id]);
      if (g) { out[g.id] = { v: v.v, t: vt }; added++; continue; }
      // 후보 보관(2026-10-13): 이 경기에 이미 다른 채널의 영상이 있으면 이 영상을 대체 후보(alts, 최대 6개 — 한국에서 막힌 해외 채널 영상 3개가 먼저 차면 한국어 영상이 못 붙던 문제, 2026-10-15 뮌헨-비킹)로 둔다 — 앱이 사용자 지역에서 열리는 첫 후보를 고른다.
      const dup = matches[0];
      if (dup && out[dup.id] && out[dup.id].v !== v.v) {
        const alts = (out[dup.id].alts ??= []);
        if (alts.length < 6 && !alts.some((a) => a.v === v.v)) { alts.push({ v: v.v, t: vt }); altAdded++; }
      }
    }
    console.log(`[hl] ${ch.name} videos=${vids.length}`);
  }
  if (API_KEY && DEEP) writeFileSync(DEEP_F, JSON.stringify({ t: NOW.getTime() }) + '\n');
  if (API_KEY) added += await searchFallback({ out, games, bk, bkTeams, teamEn, tAl, aliasG, aliasS, aliasBk });
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  await fs.writeFile(OUT, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`[hl] added=${added} altAdded=${altAdded} total=${Object.keys(sorted).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

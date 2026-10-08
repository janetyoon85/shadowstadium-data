// 응원가 영상 선택(2026-09-30) — YouTube 검색 결과 중 선수 이름과 "응원가/song" 류 단어가 제목에
// 모두 있는 첫 영상만 채택(동명이인/무관 영상 방지: 틀린 영상보단 없는 게 낫다).
// NFD 로 악센트를 떼고 NFC 로 다시 합친다 — 합치지 않으면 한글이 자모로 분해돼서 '김동주'(…주)가 '김동준'(…준)에 부분일치하는 오탐이 생긴다(2026-10-09 백테스트로 발견).
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/[\s.\-']+/g, '').toLowerCase();

export function buildCheerSongQuery(team, name, suffix = '응원가') {
  return [team, name, suffix].filter(Boolean).join(' ');
}

// spec: { full, songWords[], surname?, teamEn? } — full 이름이 제목에 있으면 채택, 성(surname, 4자 이상)만
// 있으면 teamEn(영문 팀명)까지 제목에 있을 때만 채택(성만 같은 다른 선수 영상 방지).
export const CHEER_REJECT = ['야르한', '패러디', '밈', '리믹스', '커버', '개사', '바치는', '19금', 'cover', 'remix', 'parody', 'meme', 'asmr', 'reaction', '리액션', '플레이리스트', '모음'].map(norm);
export function pickCheerSong(items, spec) {
  const full = norm(spec?.full);
  if (!full) return null;
  const surname = norm(spec.surname);
  const team = norm(spec.teamEn);
  const words = (spec.songWords || ['응원가']).map(norm);
  for (const it of items || []) {
    const id = it?.id?.videoId;
    const title = it?.snippet?.title || '';
    const t = norm(title);
    if (!id || !words.some((w) => t.includes(w))) continue;
    if (CHEER_REJECT.some((w) => t.includes(w))) continue;
    const nameOk = t.includes(full) || (surname.length >= 4 && !!team && t.includes(surname) && t.includes(team));
    if (nameOk) return { v: id, t: title };
  }
  return null;
}

// ───────────────── 채널 업로드 목록 매칭(검색 0회) ─────────────────
// 2026-10-09: KBO 응원가의 대부분은 구단 공식 채널이 아니라 팬 채널 두 곳(야쏭·크보쏭)이 "[구단] [선수] 응원가 Music Video"
// 형식으로 올린다(기존 hit 샘플 60건 중 55건이 야쏭). 이 채널들의 업로드 재생목록을 playlistItems.list(페이지당 1유닛)로 훑어
// 선수 이름으로 매칭하면 search.list(100유닛, 하루 100회 한도)를 쓰지 않고 KBO 응원가를 채울 수 있다.
export const KBO_CHEER_CHANNELS = [
  { name: '야쏭', id: 'UC0KYcMjlFq08UjK2cWkB9Cg' },
  { name: '크보쏭', id: 'UCaWU-EbhBBZA_Eyj46roLPw' },
];
export const uploadsPlaylistId = (channelId) => 'UU' + String(channelId).slice(2);

// 영문 약칭(KT·LG·NC·SSG·KIA)은 다른 단어 안에 우연히 들어갈 수 있어 앞뒤가 영문자가 아닐 때만 인정.
const isLetter = (ch) => !!ch && ch >= 'a' && ch <= 'z';
function hasWord(text, w) {
  for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) {
    if (!isLetter(text[i - 1]) && !isLetter(text[i + w.length])) return true;
  }
  return false;
}
const AI_RE = /\bai\b|인공지능/i;
/**
 * videos: [{ v, t, p }] 채널 업로드. players: [{ id, name, team }] (KBO 선수, team = 앱 팀 약칭 '삼성'·'KT'·'LG' …).
 * 규칙(틀린 영상보다 없는 게 낫다): 제목에 선수 이름 + '응원가'(CHEER_REJECT 제외) + 소속 팀 약칭이 모두 있어야 채택.
 *  - 팀 약칭을 요구해 동명이인(예: 같은 이름의 다른 구단 선수)을 가른다. 이적한 선수는 못 찾으면 그냥 건너뜀(검색 경로가 처리).
 *  - 후보가 여럿이면 AI 생성곡이 아닌 것 → 최신 순.
 * 반환: { [player.id]: { v, t } }
 */
export function matchChannelVideos(videos, players) {
  const norms = (videos || [])
    .filter((x) => x?.v && x.t)
    .map((x) => ({ v: x.v, t: x.t, p: x.p || 0, n: norm(x.t.split('#')[0]) })) // 해시태그(#선수이름)로만 이름이 걸린 제목은 제외
    .filter((x) => x.n.includes(norm('응원가')) && !CHEER_REJECT.some((w) => x.n.includes(w)))
    // 여러 선수 이름을 구분자(• · , &)로 나열한 모음·재탕 제목은 한 선수의 곡이 아니므로 제외.
    .filter((x) => !/[•‧·,&]/.test(x.t.split('#')[0]));
  const out = {};
  for (const pl of players || []) {
    const name = norm(pl.name);
    const team = norm(pl.team);
    if (!name || !team) continue;
    // 영문 약칭(KT·LG·NC·SSG·KIA)은 다른 단어 안에 우연히 들어갈 수 있어 단어 경계로 확인, 한글 약칭은 그대로 포함 검사.
    const ascii = String(pl.team).split('').every((ch) => ch >= ' ' && ch <= '~');
    const w = String(pl.team).toLowerCase();
    const teamOk = (x) => (ascii ? hasWord(x.t.toLowerCase(), w) : x.n.includes(team));
    // 이름이 첫 '응원가'보다 앞, 12자 이내여야 그 선수의 곡("[팀] 노경은 응원가 - 기존 박성한 응원가"처럼 다른 선수 곡 제목 오탐 방지).
    const song = norm('응원가');
    const nameOk = (x) => { const i = x.n.indexOf(name); const q = x.n.indexOf(song); return i >= 0 && q >= i + name.length && q - (i + name.length) <= 12; };
    const cands = norms.filter((x) => nameOk(x) && teamOk(x));
    if (!cands.length) continue;
    cands.sort((a, b) => (AI_RE.test(a.t) - AI_RE.test(b.t)) || b.p - a.p);
    out[pl.id] = { v: cands[0].v, t: cands[0].t };
  }
  return out;
}

// 응원가 영상 선택(2026-09-30) — YouTube 검색 결과 중 선수 이름과 "응원가/song" 류 단어가 제목에
// 모두 있는 첫 영상만 채택(동명이인/무관 영상 방지: 틀린 영상보단 없는 게 낫다).
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s.\-']+/g, '').toLowerCase();

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

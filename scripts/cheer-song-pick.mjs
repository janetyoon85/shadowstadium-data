// 응원가 영상 선택(2026-09-30) — YouTube 검색 결과 중 선수 이름과 "응원가"가 제목에 모두 있는
// 첫 영상만 채택(동명이인/무관 영상 방지: 틀린 영상보단 없는 게 낫다).
const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();

export function buildCheerSongQuery(team, name) {
  return [team, name, '응원가'].filter(Boolean).join(' ');
}

export function pickCheerSong(items, playerName) {
  const n = norm(playerName);
  if (!n) return null;
  for (const it of items || []) {
    const id = it?.id?.videoId;
    const title = it?.snippet?.title || '';
    if (id && norm(title).includes(n) && norm(title).includes('응원가')) return { v: id, t: title };
  }
  return null;
}

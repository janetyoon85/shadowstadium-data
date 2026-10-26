// 유로리그 공식 API(api-live.euroleague.net) 공용 — 농구 크롤러(fetch-basketball.mjs)와 통계(fetch-basketball-stats.mjs)가 같이 쓴다.
// ESPN 은 유로리그 경기를 제공하지 않아(2026-10-26 확인) 일정·박스스코어·순위·통계 전부 공식 API 로 받는다.
export const EL_SEASON = process.env.EUROLEAGUE_SEASON || 'E2026';
export const EL_API = 'https://api-live.euroleague.net';
// 공식 클럽 코드 → 이미 등록된 ESPN 유로리그 팀 id(번역·로고 데이터가 붙어 있어 같은 키를 재사용)
export const EL_TEAM = { BAR: 125618, PAR: 126416, OLY: 125614, PAM: 126418, BES: 133462, VIR: 126417, DUB: 133463, ASV: 125706, PRS: 130149, MUN: 125617, PAN: 125632, MAD: 125611, TEL: 125613, BAS: 125621, RED: 125633, MIL: 125615, IST: 125612, HTA: 132589, ZAL: 125610, ULK: 125631 };
export const elTeamKey = (code) => (EL_TEAM[code] ? `espn:EUROLEAGUE:${EL_TEAM[code]}` : null);
// "AYAYI, JOEL" → "Joel Ayayi" (Mc·로마숫자·아포스트로피·하이픈 처리)
export const elName = (raw) => {
  const [sur, giv] = String(raw || '').split(',').map((x) => x.trim());
  return String(giv ? giv + ' ' + sur : sur)
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
};

// Wikimedia Commons 구장 사진 2차 폴백(2026-09-30, "검색시도해봐") — 영문 위키 문서/TheSportsDB에 없는
// 소규모 구장(K리그2·J리그·유럽 하부리그 등)도 Commons엔 사진이 있는 경우가 많음. 검색이 퍼지라
// 오귀속 위험이 커서 파일명 검증: (1) 구장명의 고유 단어(stadium/park 등 일반어 제외)가 전부 파일명에 있고
// (2) 경기/인물/지도/로고류 파일은 제외. 못 찾으면 null(확정), 일시 오류는 undefined(재시도).
export const COMMONS_UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const GENERIC = new Set(['stadium', 'stadion', 'stade', 'estadio', 'stadio', 'arena', 'park', 'ballpark', 'field', 'ground', 'grounds', 'sports', 'sport', 'complex', 'center', 'centre', 'city', 'municipal', 'football', 'baseball', 'soccer', 'the', 'de', 'la', 'le', 'del', 'of', 'and', 'club', 'general', 'prefectural', 'athletics', 'athletic', 'town', 'international', 'national']);
const BAD_FILE_RE = /dimen[st]?i?on|diagram|layout|seating|\.svg|\bvs?\b|\bmatch\b|derby|\bmap\b|logo|flag|crest|poster|ticket|parkplatz|parking|satellite|construction|thumbnail|addressing|enter|yaris|aleppo|stamp|postage|sello|statue|portrait|painting|bust|\bmonument\b|coin|medal|banknote|mural|bandera|escudo|google art project|art project|oil on|canvas|mexibus|metrobus|\bmetro\b|\bstation\b|estacion del|\bbus\b|\btram\b|subway|\btrain\b|fence|\bom \d{4}\b/i; // 악센트 제거한 제목에 적용.
export function normalizeForMatch(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function distinctiveTokens(name) {
  return normalizeForMatch(name).split(' ').filter((t) => t.length > 1 && !GENERIC.has(t));
}
const STADIUM_WORD_RE = /stadium|stadion|stade|stadio|estadio|arena|ballpark|coliseum|cancha|park|field|bowl/;
export function isPlausibleCommonsFile(title, venueName) {
  const t = normalizeForMatch(title);
  if (BAD_FILE_RE.test(t)) return false;
  if (!STADIUM_WORD_RE.test(t) && /cropped/.test(t)) return false;
  const tokens = distinctiveTokens(venueName);
  if (tokens.length === 0) return false;
  return tokens.every((tok) => t.includes(tok));
}
export async function fetchVenuePhotoFromCommons(venueName, city, fetchFn = fetch) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${venueName} ${city || ''}`.trim(),
    gsrlimit: '8', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800', origin: '*',
  });
  let res;
  try {
    res = await fetchFn(url, { headers: { 'User-Agent': COMMONS_UA }, signal: AbortSignal.timeout(10000) });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  let j;
  try { j = await res.json(); } catch { return undefined; }
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png)$/.test(info.mime || '')) continue;
    if (isPlausibleCommonsFile(p.title || '', venueName)) return info.thumburl || info.url || null;
  }
  return null;
}

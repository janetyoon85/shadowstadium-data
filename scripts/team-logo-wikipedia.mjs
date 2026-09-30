// 팀 로고 3차 폴백(2026-09-30, "다른소스붙이자 무료로") — 사람이 확인한 영문 위키백과 문서 제목(team-logo-wiki-titles.json)으로
// 인포박스 로고를 가져온다. 오귀속 방지: 제목을 자동 추정하지 않고 수동 매핑만 사용, 이미지는 파일명이 로고류일 때만 채택,
// 아니면 Wikidata 로고 필드(P154)로 대체. 못 찾으면 null(확정), 네트워크 오류는 undefined(재시도).
export const WIKI_UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const LOGO_NAME_RE = /logo|crest|badge|emblem|symbol|escudo|wappen|blason|shield|insignia|seal/i;
async function getJson(url, fetchFn) {
  const res = await fetchFn(url, { headers: { 'User-Agent': WIKI_UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}
export async function fetchLogoByEnTitle(title, fetchFn = fetch) {
  try {
    const j = await getJson('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', titles: title, redirects: '1', prop: 'pageimages|pageprops',
      piprop: 'thumbnail|name', pithumbsize: '200', ppprop: 'wikibase_item', origin: '*',
    }), fetchFn);
    const p = Object.values(j.query?.pages || {})[0];
    if (!p || p.missing !== undefined) return null;
    if (p.thumbnail?.source && LOGO_NAME_RE.test(p.pageimage || '')) return p.thumbnail.source;
    const qid = p.pageprops?.wikibase_item;
    if (!qid) return null;
    const e = await getJson('https://www.wikidata.org/w/api.php?' + new URLSearchParams({
      action: 'wbgetentities', format: 'json', ids: qid, props: 'claims', origin: '*',
    }), fetchFn);
    const file = e.entities?.[qid]?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
    return file ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file.replace(/ /g, '_')) + '?width=200' : null;
  } catch {
    return undefined;
  }
}

// 우승 이력 중첩 목록("* 대회 / :: Winners (2): 2001–02, 2015–16 / :: Runners-up …") → [대회, 횟수, 연도들].
// 위키 HTML은 대회명 <li>와 Winners <dd>가 형제(<ul>…</ul><dl>…)이거나 중첩이라, 문서 순서로 "직전 대회명"에 붙임.
const clean = (h) => h.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/&#\d+;|&\w+;/g, ' ').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();

export function parseWinnerLists(html0) {
  const html = html0.replace(/<\/?(b|i|strong|em|a|span|small)\b[^>]*>/g, '');
  const names = [];
  for (const m of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const cut = m[1].search(/<(dl|ul|dd)\b/);
    const name = clean(cut < 0 ? m[1] : m[1].slice(0, cut));
    if (name && name.length <= 80) names.push({ i: m.index, name });
  }
  const rows = [];
  const seen = new Set();
  for (const m of html.matchAll(/(?:Winners?|Champions?)\s*\((\d{1,3})\)\s*:?\s*([\s\S]*?)(?=Runners?-?up|Third|<\/dd>|<\/li>|$)/gi)) {
    const prev = names.filter((n) => n.i < m.index).pop();
    if (!prev || seen.has(prev.name)) continue;
    seen.add(prev.name);
    const years = clean(m[2]).replace(/^[:\s]+/, '').replace(/\s+,/g, ',').replace(/[,;\s]+$/, '').slice(0, 90);
    rows.push([prev.name, Number(m[1]), years]);
  }
  return rows;
}

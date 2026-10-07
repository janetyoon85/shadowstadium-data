// 국가대표팀 "대륙/월드컵 우승 직후 선수들" Commons 사진 → team-celebration.json (이미 있는 팀은 건너뜀)
import fs from 'fs';
const UA = { 'User-Agent': 'ShadeSideBot/1.0 (https://github.com/janetyoon85/shadowstadium-data)' };
const OUT = 'team-celebration.json';
const out = JSON.parse(fs.readFileSync(OUT, 'utf8'));
// 대회별 최근 우승국(고정 사실). [대회 검색어, 연도, 우승국 영문]
const WINS = [
  ['FIFA World Cup', 2022, 'Argentina'], ['FIFA World Cup', 2018, 'France'], ['FIFA World Cup', 2014, 'Germany'], ['FIFA World Cup', 2010, 'Spain'], ['FIFA World Cup', 2006, 'Italy'], ['FIFA World Cup', 2002, 'Brazil'],
  ['UEFA Euro', 2024, 'Spain'], ['UEFA Euro', 2020, 'Italy'], ['UEFA Euro', 2016, 'Portugal'], ['UEFA Euro', 2012, 'Spain'], ['UEFA Euro', 2008, 'Spain'], ['UEFA Euro', 2004, 'Greece'],
  ['Copa América', 2024, 'Argentina'], ['Copa América', 2021, 'Argentina'], ['Copa América', 2019, 'Brazil'], ['Copa América', 2016, 'Chile'], ['Copa América', 2015, 'Chile'],
  ['Africa Cup of Nations', 2023, 'Ivory Coast'], ['Africa Cup of Nations', 2021, 'Senegal'], ['Africa Cup of Nations', 2019, 'Algeria'], ['Africa Cup of Nations', 2017, 'Cameroon'], ['Africa Cup of Nations', 2015, 'Ivory Coast'],
  ['AFC Asian Cup', 2023, 'Qatar'], ['AFC Asian Cup', 2019, 'Qatar'], ['AFC Asian Cup', 2015, 'Australia'], ['AFC Asian Cup', 2011, 'Japan'], ['AFC Asian Cup', 2007, 'Iraq'],
  ['CONCACAF Gold Cup', 2023, 'Mexico'], ['CONCACAF Gold Cup', 2021, 'United States'], ['CONCACAF Gold Cup', 2019, 'Mexico'], ['CONCACAF Gold Cup', 2017, 'United States'],
  ['UEFA Nations League', 2023, 'Spain'], ['UEFA Nations League', 2025, 'Portugal'], ['Finalissima', 2022, 'Argentina'],
];
const BAD = /goles|goals|festej|logo|crest|badge|flag|map|kit|shirt|jersey|ticket|stamp|poster|coat|emblem|stadium|stadion|arena|museum|statue|icon|silhouette|\.svg|\bvs\b|_v_|protest|ultras|banner|graffiti|bus|train|plane|cheerlead|qualif|draw|fans?\b|supporters/i;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const byCountry = {};
for (const [comp, year, country] of WINS) {
  const pics = [];
  for (const q of [`${country} ${year} ${comp} champions celebration`, `${country} national football team ${year} ${comp} trophy`]) {
    if (pics.length >= 3) break;
    const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: '25', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800' });
    try {
      const r = await (await fetch(u, { headers: UA })).json();
      for (const p of Object.values(r.query?.pages || {})) {
        const t = (p.title || '').replace(/^File:/, '');
        const ii = p.imageinfo?.[0];
        if (!ii || ii.mime !== 'image/jpeg' || BAD.test(t)) continue;
        const nt = norm(t);
        if (!nt.includes(norm(country).split(' ')[0])) continue;
        if (!/campe|champion|winner|celebrat|trophy|trofeo|cup|copa|lift|title|final|victory|win/.test(nt) && !nt.includes(String(year))) continue;
        const pu = ii.thumburl || ii.url;
        if (!pics.includes(pu)) pics.push(pu);
      }
    } catch (e) { console.log('err', country, year, e.message); }
    await new Promise((s) => setTimeout(s, 3000));
  }
  console.log(country, comp, year, pics.length);
  if (pics.length) (byCountry[country] ||= []).push(...pics.slice(0, 2));
}
// 영문 국가명 → 팀키(team-info의 wiki "X national football team")
const keyOf = {};
for (const f of fs.readdirSync('team-info')) {
  if (!/^[0-9a-f]+\.json$/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync('team-info/' + f, 'utf8'));
  for (const [k, v] of Object.entries(j)) {
    const m = v?.wiki?.match(/^(.+?) national football team$/i);
    if (m) keyOf[m[1]] = keyOf[m[1]] || k;
  }
}
let n = 0;
for (const [c, pics] of Object.entries(byCountry)) {
  const k = keyOf[c];
  if (!k) { console.log('no key', c); continue; }
  const prev = Array.isArray(out[k]) ? out[k] : [];
  out[k] = [...new Set([...pics, ...prev])].slice(0, 5);
  n++;
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('updated teams', n);

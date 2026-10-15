// 새 구장 자동 등록(2026-10-15): 일정 수집기는 구장 ID 매핑만 하고, 사진·구장정보 백필은 venues-meta.json / venue-name-en.json 에 있는 구장만 처리한다.
// 새 구장이 일정에 나타났는데 두 목록에 없으면 영영 사진이 비어 있었다 — 이 스크립트가 games.json 에서 목록에 없는 구장을 찾아 자동으로 추가한다.
//  - venues-meta.json: { id, name(일정의 구장명), teams(가장 많이 홈으로 나온 팀), sport } — 사진 검색에 쓰인다.
//  - venue-name-en.json: 구장명이 영문(라틴 글자만)일 때만 { name } 으로 추가한다(한글뿐인 구장은 영문명을 알 수 없어 건너뜀 → 운영 점검이 알려준다).
// 앱의 구장 등록(좌표 포함)은 별개다. 이 스크립트는 좌표를 만들지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ADD = Number(process.env.VENUE_SYNC_MAX || 40);
const EXTRA_BASEBALL = new Set(['WBC', 'CARIBBEANSERIES', 'LIDOM', 'LMP', 'LVBP', 'LMB', 'PWL', 'ABL', 'AFL', 'AAA', 'PREMIER12']);
export const isBaseballLeague = (lg) => lg === 'KBO' || lg === 'MLB' || lg === 'NPB' || EXTRA_BASEBALL.has(lg) || /BASEBALL/.test(lg || '');
const hasHangul = (s) => /[가-힣]/.test(s || '');
const latinOnly = (s) => !!s && /[A-Za-z]/.test(s) && !hasHangul(s);

// games.json 에서 meta/en 목록에 없는 구장을 찾는다(순수 함수 — 테스트 대상).
export function findNewVenues(games, metaIds, enMap) {
  const by = new Map();
  for (const g of games) {
    if (!g.venueId) continue;
    const e = by.get(g.venueId) ?? { names: new Map(), teams: new Map(), base: 0, n: 0 };
    if (g.stadium) e.names.set(g.stadium, (e.names.get(g.stadium) || 0) + 1);
    if (g.home) e.teams.set(g.home, (e.teams.get(g.home) || 0) + 1);
    if (isBaseballLeague(g.league)) e.base++;
    e.n++;
    by.set(g.venueId, e);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const addMeta = [], addEn = {};
  for (const [id, e] of by) {
    const name = top(e.names);
    if (!metaIds.has(id)) addMeta.push({ id, name: name || id, teams: top(e.teams) || '', sport: e.base * 2 >= e.n ? 'baseball' : 'football' });
    if (!enMap[id]) {
      const lat = [...e.names.keys()].find(latinOnly);
      if (lat) addEn[id] = { name: lat };
    }
  }
  return { addMeta, addEn };
}

const fmt = (raw, o) => {
  const crlf = raw.includes('\r\n');
  let out = JSON.stringify(o, null, 2);
  if (crlf) out = out.replace(/\n/g, '\r\n');
  return out + (/\n$/.test(raw) ? (crlf ? '\r\n' : '\n') : '');
};

async function main() {
  const dry = process.argv.includes('--dry');
  const rd = async (f) => { const raw = await fs.readFile(path.join(ROOT, f), 'utf8'); return [raw, JSON.parse(raw)]; };
  const games = JSON.parse(await fs.readFile(path.join(ROOT, 'games.json'), 'utf8'));
  const [metaRaw, meta] = await rd('venues-meta.json');
  const [enRaw, en] = await rd('venue-name-en.json');
  const { addMeta, addEn } = findNewVenues(Array.isArray(games) ? games : games.games || [], new Set(meta.map((m) => m.id)), en);
  const metaAdd = addMeta.slice(0, MAX_ADD);
  const enIds = Object.keys(addEn).slice(0, MAX_ADD);
  console.log(`[venue-sync] 새 구장 meta +${metaAdd.length}(전체 ${addMeta.length}) en +${enIds.length}`);
  for (const m of metaAdd) console.log(`  meta ${m.id} | ${m.name} | ${m.teams} | ${m.sport}`);
  for (const id of enIds) console.log(`  en ${id} | ${addEn[id].name}`);
  if (dry) return;
  if (metaAdd.length) await fs.writeFile(path.join(ROOT, 'venues-meta.json'), fmt(metaRaw, [...meta, ...metaAdd]), 'utf8');
  if (enIds.length) { for (const id of enIds) en[id] = addEn[id]; await fs.writeFile(path.join(ROOT, 'venue-name-en.json'), fmt(enRaw, en), 'utf8'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

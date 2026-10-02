// 영문명으로만 인덱싱된 축구 선수(players.json)의 한글 이름을 Wikidata로 채워 player-name-ko.json(한글=영문)에 적립(fetch-schedule이 쓰는 player-name-auto.json과 분리해 git 충돌 방지)
// (2026-10-01, "훌리안 알바레스 검색안됨"). 오매칭 방지: ESPN displayDOB와 Wikidata 생년월일(P569)이 정확히 같고
// 사람(Q5)이며 한글 라벨/kowiki 제목이 있는 후보가 정확히 1명일 때만 채택. 시도 결과는 player-ko-tried.json에 기록.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const BUDGET = Number(process.env.KO_BUDGET || 200);
const LANGS = ['ko', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-hans', 'zh-hant', 'hi', 'tr', 'nl'];
const sleep =(ms) => new Promise((r) => setTimeout(r, ms));
const loadJson = async (f, d) => { try { return JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8')); } catch { return d; } };

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return undefined;
    return await res.json();
  } catch { return undefined; }
}

function parseDob(s) {
  const m = typeof s === 'string' && s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

async function lookup(player) {
  const bk = /^espnbk:(nba|wnba):(\d+)$/.exec(player.id);
  const esp = bk
    ? await getJson(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/${bk[1]}/athletes/${bk[2]}`)
    : await getJson(`https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/${player.id.replace(/^espn:/, '')}`);
  if (esp === undefined) return undefined; // 일시 오류 → 재시도
  const dob = parseDob(esp.athlete?.displayDOB);
  if (!dob) return null;
  const names = [...new Set([player.name, player.name.normalize('NFD').replace(/[̀-ͯ]/g, '')])];
  const cand = new Set();
  for (const n of names) {
    const s = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(n)}&language=en&limit=10&format=json`);
    if (s === undefined) return undefined;
    for (const x of s.search || []) cand.add(x.id);
    await sleep(250);
  }
  if (!cand.size) return null;
  const ents = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...cand].join('|')}&props=labels|sitelinks|claims&languages=${LANGS.join('|')}&sitefilter=kowiki&format=json`);
  if (ents === undefined) return undefined;
  const hits = [];
  for (const e of Object.values(ents.entities || {})) {
    const isHuman = (e.claims?.P31 || []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5');
    const born = (e.claims?.P569 || []).map((c) => (c.mainsnak?.datavalue?.value?.time || '').replace(/^\+/, '').slice(0, 10));
    if (!isHuman || !born.includes(dob)) continue;
    const ko = (e.labels?.ko?.value || e.sitelinks?.kowiki?.title || '').replace(/\s*\(.*\)\s*$/, '').trim();
    const labels = {};
    for (const l of LANGS) { const v = e.labels?.[l]?.value; if (v && v !== player.name) labels[l] = v; }
    hits.push({ ko: /[가-힣]/.test(ko) ? ko : '', labels });
  }
  return hits.length === 1 ? hits[0] : null;
}

async function main() {
  const players = await loadJson('players.json', []);
  const auto = await loadJson('player-name-ko.json', {});
const autoOther = await loadJson('player-name-auto.json', {});
  const manual = await loadJson('player-name-en.json', {});
  const i18n = await loadJson('player-name-i18n.json', {});
  const tried = await loadJson('player-ko-tried.json', {});
  try { players.push(...(await loadJson('basketball/players.json', []))); } catch {}
  const isBk = (p) => /^espnbk:(nba|wnba):/.test(p.id || '');
  const todo = players.filter((p) => ((p.sport === 'soccer' && p.id?.startsWith('espn:')) || isBk(p)) && !/[가-힣]/.test(p.name) && !(p.id in tried)).sort((a, b) => (isBk(b) ? 1 : 0) - (isBk(a) ? 1 : 0) || (b.lastSeenDate || '').localeCompare(a.lastSeenDate || ''));
  console.log(`[ko-names] candidates=${todo.length} budget=${BUDGET}`);
  let used = 0, added = 0, none = 0, conflict = 0;
  const save = async () => {
    await fs.writeFile(path.join(ROOT, 'player-name-ko.json'), JSON.stringify(auto, null, 2) + '\n', 'utf8');
    await fs.writeFile(path.join(ROOT, 'player-ko-tried.json'), JSON.stringify(tried) + '\n', 'utf8');
    await fs.writeFile(path.join(ROOT, 'player-name-i18n.json'), JSON.stringify(i18n) + '\n', 'utf8');
  };
  const wd = await loadJson('basketball/player-wd.json', {});
  let wdAdded = 0;
  for (const p of players) {
    const w = wd[p.id];
    if (!w?.labels || !/^(espnbk|nbk):/.test(p.id)) continue;
    if (!(p.id in i18n)) i18n[p.id] = { ...w.labels };
    const ko = (w.labels.ko || '').replace(/s*(.*)s*$/, '').trim();
    if (!ko || !/[가-힣]/.test(ko) || /[가-힣]/.test(p.name) || tried[p.id]) continue;
    if (auto[ko] !== p.name && (ko in auto || ko in autoOther || ko in manual)) { tried[p.id] = 'conflict'; continue; }
    auto[ko] = p.name; tried[p.id] = ko; wdAdded++;
  }
  console.log(`[ko-names] wd 농구 반영 ${wdAdded}`);
  for (const p of todo) {
    if (used >= BUDGET) break;
    used++;
    if (used % 25 === 0) await save();
    const r = await lookup(p);
    await sleep(250);
    if (r === undefined) continue;
    if (!r) { tried[p.id] = 0; none++; continue; }
    if (Object.keys(r.labels).length) i18n[p.id] = r.labels;
    const ko = r.ko;
    if (!ko) { tried[p.id] = 0; none++; continue; }
    if (auto[ko] !== p.name && (ko in auto || ko in autoOther || ko in manual)) { tried[p.id] = 'conflict'; conflict++; continue; }
    auto[ko] = p.name;
    tried[p.id] = ko;
    added++;
  }
  await save();
  console.log(`[ko-names] used=${used} added=${added} none=${none} conflict=${conflict} remaining=${todo.length - used}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

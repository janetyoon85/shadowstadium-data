// 농구 팀명 다국어(2026-10-02) — Wikidata 라벨로 basketball/team-i18n.json {teamKey: {lang: name}} 생성.
// 클럽: 후보 중 종목(P641)=농구 또는 P31=농구팀. 대표팀: 국가(Q6256/Q3624078) 항목 라벨. 못 찾으면 null(앱은 영문 폴백).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'basketball');
const OUT = path.join(DIR, 'team-i18n.json');
const UA = 'ShadeSideCrawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const BUDGET = Number(process.env.BK_TEAM_BUDGET || 400);
const LANGS = ['ko', 'ja', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'ar', 'id', 'th', 'vi', 'zh-hans', 'zh-hant', 'hi', 'tr', 'nl'];
const NATIONAL = new Set(['FIBA', 'OLYMPICS_M', 'OLYMPICS_W', 'ASIAD_M', 'ASIAD_W', 'ASIAD3_M', 'ASIAD3_W']);
const BL_EN = { ir: 'Ibaraki Robots', sn: 'San-en NeoPhoenix', lh: 'Levanga Hokkaido', sm: 'Seahorses Mikawa', se: 'Sendai 89ers', an: 'Akita Northern Happinets', ns: 'Kobe Storks', oe: 'Osaka Evessa', bw: 'Shinshu Brave Warriors', tg: 'Toyama Grouses', sg: 'Saga Ballooners', hd: 'Hiroshima Dragonflies', kh: 'Kyoto Hannaryz', ls: 'Shiga Lakestars', ub: 'Utsunomiya Brex', yb: 'Yokohama B-Corsairs', kb: 'Kawasaki Brave Thunders', dd: 'Nagoya Diamond Dolphins', cj: 'Chiba Jets Funabashi', at: 'Alvark Tokyo', ss: 'Shimane Susanoo Magic', ac: 'Altiri Chiba', sr: 'Sunrockers Shibuya', rg: 'Ryukyu Golden Kings', nv: 'Nagasaki Velca', gc: 'Gunma Crane Thunders',
  ib: 'Iwate Big Bulls', yw: 'Yamagata Wyverns', rk: 'Kagoshima Rebnise', rf: 'Fukuoka Rizing Zephyr', na: 'Niigata Albirex BB', ks: 'Kanazawa Samuraiz', gs: 'Gifu Swoops', fb: 'Fukui Blowinds', vs: 'Veltex Shizuoka', fe: 'Fighting Eagles Nagoya', bn: 'Bambitious Nara', ff: 'Fukushima Firebonds', eo: 'Ehime Orange Vikings', aw: "Aomori Wat's", kv: 'Kumamoto Volters', fa: 'Kagawa Five Arrows', sb: 'Saitama Broncos', tu: 'Tokyo United', ez: 'Earthfriends Tokyo Z', td: 'Tachikawa Dice', to: 'Tryhoop Okayama', ka: 'Koshigaya Alphas', gb: 'Tokushima Gambats', hb: 'Hachioji Bee Trains', ex: 'Yokohama Excellence', yp: 'Yamaguchi Patriots', cr: 'Shinagawa City', vm: 'Vert Mie', su: 'Shonan United' };
const ALIAS = { 'AX Armani Exchange Milan': 'EA7 Emporio Armani Milan', 'Baskonia Vitoria-Gasteiz': 'Saski Baskonia', 'Crvena Zvezda Mts Belgrade': 'KK Crvena zvezda', 'Dubai': 'Dubai Basketball', 'Fenerbahce Ulker Istanbul': 'Fenerbahçe Basketball', 'LDLC Asvel Villeurbanne': 'ASVEL Basket', 'Panathinaikos Athens': 'Panathinaikos B.C.', 'Puerto Rico': 'Puerto Rico national basketball team', '안양 정관장': 'Anyang Jung Kwan Jang Red Boosters', '홍콩': 'Hong Kong', '마카오': 'Macau' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const getJson = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : undefined;
  } catch { return undefined; }
};
const ids = (e, p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const FIX = { 'Islamic Republic of Iran': 'Iran', 'Republic of Korea': 'South Korea', 'Chinese Taipei': 'Taiwan', "People's Republic of China": 'China', 'USA': 'United States', 'Hong Kong, China': 'Hong Kong' };

async function lookup(tm, enName) {
  const national = NATIONAL.has(tm.lg);
  const base = enName || tm.ko || tm.ja;
  const name = ALIAS[base] || (national ? (FIX[enName] || enName) : base);
  const lang = ALIAS[base] ? 'en' : !enName && tm.ja && !tm.ko ? 'ja' : !enName && tm.ko ? 'ko' : 'en';
  const s = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&limit=8&format=json`);
  if (s === undefined) return undefined;
  const cand = (s.search || []).map((x) => x.id);
  if (!cand.length) return null;
  const e = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${cand.join('|')}&props=labels|claims&languages=${['en', ...LANGS].join('|')}&format=json`);
  if (e === undefined) return undefined;
  for (const id of cand) {
    const en = e.entities?.[id];
    if (!en) continue;
    const p31 = ids(en, 'P31');
    const ok = ALIAS[base] ? (ids(en, 'P641').includes('Q5372') || p31.some((x) => ['Q6256','Q3624078','Q13393265','Q4438121','Q20639847','Q1190554','Q46395','Q107390','Q15304003'].includes(x)) || cand[0] === id) : national
      ? p31.some((x) => ['Q6256', 'Q3624078', 'Q107390', 'Q46395', 'Q15304003'].includes(x))
      : ids(en, 'P641').includes('Q5372') || p31.some((x) => ['Q13393265', 'Q20639847', 'Q4438121'].includes(x));
    if (!ok) continue;
    const out = {};
    for (const l of LANGS) { const v = en.labels?.[l]?.value; if (v) out[l] = v; }
    if (en.labels?.en?.value) out.en = en.labels.en.value;
    return out;
  }
  return null;
}

const teams = await readJson(path.join(DIR, 'teams.json'), {});
const enMap = await readJson(path.join(DIR, 'team-name-en.json'), {});
const out = await readJson(OUT, {});
let n = 0;
for (const [k, tm] of Object.entries(teams)) {
  if (out[k]) continue;
  if (n >= BUDGET) break;
  const enName = tm.en || enMap['bk:' + k] || (tm.src === 'bl' ? BL_EN[tm.code] : undefined);
  if (!enName && !tm.ko && !tm.ja) continue;
  const r = await lookup(tm, enName);
  if (r === undefined) continue;
  out[k] = r || (enName ? { en: enName } : null);
  if (r && enName && !r.en) r.en = enName;
  n++;
  await sleep(250);
}
await fs.writeFile(OUT, JSON.stringify(out));
console.log('team-i18n', Object.keys(out).length, 'found', Object.values(out).filter(Boolean).length, 'of', Object.keys(teams).length);

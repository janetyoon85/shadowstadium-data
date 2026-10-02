// 농구 선수 프로필 백필(2026-10-02, 사용자: "국적표시도") — ESPN athlete API에서 출생국(국적 근사)/생일/신장/체중/
// 포지션/드래프트 등을 basketball/player-info.json({pid: {...}})에 영구 캐시. 앱 런타임 호출 0회.
// 대상: espnbk:nba|wnba|fiba (nbl은 ESPN에 프로필 없음, KBL(nbk:)은 네이버에 국적 필드 없음 → 제외).
// nat은 축구 scorers.nat과 같은 형식(영문 국가명, 예 'USA','Slovenia') — 앱 scorerNationalityFlag 재사용.
// null=프로필 없음(확정), 일시 오류는 캐시 안 함.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'basketball');
const OUT = path.join(DIR, 'player-info.json');
const BUDGET = Number(process.env.BK_INFO_BUDGET || 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const COUNTRY_FIX = { 'United States': 'USA', 'United States of America': 'USA', 'U.S.': 'USA', 'Czech Republic': 'Czechia', 'Turkey': 'Türkiye' };

function natFromBirthplace(s) {
  if (!s) return undefined;
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return undefined;
  if (/^(VIC|QLD|NSW|TAS|ACT|SA|NT)$/.test(last)) return 'Australia';
  if (/^(ON|BC|QC|AB|MB|SK|NS|NB|NL|PE)$/.test(last)) return 'Canada';
  if (/^[A-Z]{2}$/.test(last) || /^(District of Columbia|Washington, D\.?C\.?)$/i.test(last)) return 'USA';
  return COUNTRY_FIX[last] || last;
}

async function lookup(slug, id) {
  try {
    const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/${slug}/athletes/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    const a = (await res.json()).athlete;
    if (!a) return null;
    const dob = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(a.displayDOB || '');
    const o = {
      nat: natFromBirthplace(a.displayBirthPlace),
      bp: a.displayBirthPlace || undefined,
      dob: dob ? `${dob[3]}-${dob[2].padStart(2, '0')}-${dob[1].padStart(2, '0')}` : undefined,
      ht: a.displayHeight || undefined,
      wt: a.displayWeight || undefined,
      pos: a.position?.abbreviation || undefined,
      no: a.jersey || undefined,
      exp: a.displayExperience || undefined,
      draft: a.displayDraft || undefined,
      col: a.college?.name || undefined,
    };
    return Object.values(o).some((v) => v) ? o : null;
  } catch { return undefined; }
}

async function main() {
  const players = await readJson(path.join(DIR, 'players.json'), []);
  const cache = await readJson(OUT, {});
  for (const v of Object.values(cache)) if (v && v.bp) v.nat = natFromBirthplace(v.bp);
  const todo = players
    .filter((p) => /^espnbk:(nba|wnba|fiba):\d+$/.test(p.id) && !(p.id in cache))
    .sort((a, b) => (/^espnbk:fiba/.test(a.id) ? 1 : 0) - (/^espnbk:fiba/.test(b.id) ? 1 : 0) || (b.lastSeenDate || '').localeCompare(a.lastSeenDate || ''));
  console.log(`[bk-info] cached=${Object.keys(cache).length} todo=${todo.length} budget=${BUDGET}`);
  let used = 0, got = 0;
  for (const p of todo) {
    if (used >= BUDGET) break;
    used++;
    const [, slug, id] = p.id.split(':');
    const r = await lookup(slug, id);
    await sleep(150);
    if (r === undefined) continue;
    cache[p.id] = r;
    if (r) got++;
  }
  await fs.writeFile(OUT, JSON.stringify(cache) + '\n', 'utf8');
  console.log(`[bk-info] used=${used} got=${got} remaining=${todo.length - used}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

// 팀 소개 텍스트(lead/hist/rival/legends)와 우승대회명을 크롤러가 미리 18개 언어로 번역해 둠(2026-10-05).
// 앱 런타임 무료 번역API(MyMemory 일일한도)에 사용자 수만큼 의존하지 않기 위함. 앱은 이걸 먼저 읽고 없을 때만 런타임 번역.
// 출력: team-info-i18n/<lang>/<샤드>.json {팀키:{lead?,hist?,rival?,legends?,h}}, team-info-i18n/<lang>/comps.json {영문대회명:번역}
// h = 원문 해시(원문이 바뀌면 재번역). 해당 언어 위키판이 있는 팀의 lead는 앱이 위키 원문을 쓰므로 건너뜀.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1a32 } from './topic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'team-info');
const OUT = path.join(ROOT, 'team-info-i18n');
const BUDGET = Number(process.env.TI_I18N_BUDGET || 2500);
const LANGS = [['ko', 'ko', 'ko'], ['ja', 'ja', 'ja'], ['es', 'es', 'es'], ['pt', 'pt', 'pt'], ['fr', 'fr', 'fr'], ['de', 'de', 'de'], ['it', 'it', 'it'], ['ru', 'ru', 'ru'], ['ar', 'ar', 'ar'], ['id', 'id', 'id'], ['th', 'th', 'th'], ['vi', 'vi', 'vi'], ['zh-Hans', 'zh-CN', 'zh'], ['zh-Hant', 'zh-TW', 'zh'], ['hi', 'hi', 'hi'], ['tr', 'tr', 'tr'], ['nl', 'nl', 'nl']];
const HONOUR_RE = /^(.+?)\s+(Winners|Champions|Runners-up|Runner-up|Third place|Fourth place|Promoted|Promotion)\s*(?:\((\d+)\))?\s*:\s*(.*)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };

let used = 0, blocked = false, strikes = 0;
async function gtx(text, tl) {
  if (blocked) return null;
  used++;
  const cut = text.length > 1500 ? (text.slice(0, 1500).replace(/[^.!?]*$/, '') || text.slice(0, 1500)) : text;
  for (let a = 0; a < 2; a++) {
    try {
      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(cut)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { if (++strikes >= 3) { blocked = true; return null; } await sleep(30000 * strikes); a--; continue; }
      if (!res.ok) { await sleep(1000); continue; }
      const j = await res.json();
      const out = Array.isArray(j?.[0]) ? j[0].map((x) => String(x?.[0] ?? '')).join('').trim() : '';
      await sleep(250);
      return out || null;
    } catch { await sleep(1000); }
  }
  return null;
}

async function main() {
  const shards = {};
  const compNames = new Set();
  for (let i = 0; i < 16; i++) {
    const s = i.toString(16);
    shards[s] = await readJson(path.join(SRC, `${s}.json`), {});
    for (const v of Object.values(shards[s])) {
      for (const h of v?.honours || []) {
        const x = typeof h === 'string' ? h : h[0];
        const m = HONOUR_RE.exec(x);
        compNames.add(m ? m[1] : x);
      }
    }
  }
  compNames.delete('');
  let langDone = 0;
  for (const [lang, tl, wl] of LANGS) {
    if (used >= BUDGET || blocked) break;
    const dir = path.join(OUT, lang);
    await fs.mkdir(dir, { recursive: true });
    const compF = path.join(dir, 'comps.json');
    const comps = await readJson(compF, {});
    const pending = [...compNames].filter((c) => !(c in comps) && !c.includes('\n'));
    for (let i = 0; i < pending.length && used < BUDGET && !blocked;) {
      const chunk = [];
      let len = 0;
      while (i < pending.length && len + pending[i].length < 1200) { chunk.push(pending[i]); len += pending[i].length + 1; i++; }
      if (!chunk.length) { i++; continue; }
      const t = await gtx(chunk.join('\n'), tl);
      const lines = t ? t.split('\n').map((x) => x.trim()) : [];
      if (lines.length === chunk.length) chunk.forEach((c, j) => { if (lines[j]) comps[c] = lines[j]; });
    }
    await fs.writeFile(compF, JSON.stringify(comps) + '\n');
    for (const s of Object.keys(shards)) {
      const f = path.join(dir, `${s}.json`);
      const cur = await readJson(f, {});
      let ch = false;
      for (const [k, v] of Object.entries(shards[s])) {
        if (!v || used >= BUDGET || blocked) continue;
        const src = { lead: v.sl?.[wl] ? undefined : v.lead, hist: v.hist, rival: v.rival, legends: typeof v.legends === 'string' ? v.legends : undefined };
        const h = fnv1a32(JSON.stringify(src));
        if (cur[k]?.h === h) continue;
        const e = { h };
        let fail = false;
        for (const [f2, txt] of Object.entries(src)) {
          if (!txt) continue;
          const t = await gtx(txt, tl);
          if (t) e[f2] = t; else fail = true;
        }
        if (fail) { if (Object.keys(e).length > 1) { e.h = 'partial'; cur[k] = e; ch = true; } continue; }
        cur[k] = e; ch = true;
      }
      if (ch) await fs.writeFile(f, JSON.stringify(cur) + '\n');
    }
    langDone++;
  }
  console.log(`[ti-i18n] used=${used} blocked=${blocked} langsVisited=${langDone}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

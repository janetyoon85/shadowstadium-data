// 네이버(KBL·WKBL) 박스스코어의 필드골 시도수 일괄 보정(1회성, 2026-10-26).
// 네이버가 선수 fgA 를 성공수와 같게(9/9) 내려주고 팀 fg/fgA 는 2점 기록만 줘서, 저장된 박스스코어의 FG 시도수·팀 FG 가 틀렸다.
// 새 크롤러(fetch-basketball.mjs naverDetail)는 올바르게 저장하므로 이 스크립트는 이미 저장된 경기만 /record 를 다시 받아 fg 필드만 고친다(다른 값은 건드리지 않음).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'basketball');
const UA = 'Mozilla/5.0 (compatible; shadowstadium; +https://github.com/janetyoon85/shadowstadium-data)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = (await fs.readdir(DIR)).filter((f) => /^box-\d{4}-\d{2}\.json$/.test(f));
let fixed = 0, tried = 0, failed = 0;
for (const f of files) {
  const box = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8'));
  let changed = false;
  for (const [id, b] of Object.entries(box)) {
    if (!id.startsWith('nv:') || !b?.pl) continue;
    // 이미 보정된 박스(선수 fgA 가 성공수보다 크거나 3점시도가 FG 시도를 넘지 않음)는 건너뛴다
    const bad = ['h', 'a'].some((s) => (b.pl[s] || []).some((p) => p.fg && p.fg[1] <= p.fg[0] && p.fg[0] > 0 && (p.tp?.[1] || 0) > 0));
    const allEq = ['h', 'a'].every((s) => (b.pl[s] || []).every((p) => !p.fg || p.fg[1] === p.fg[0]));
    if (!bad && !allEq) continue;
    tried++;
    let rec;
    try {
      const r = await fetch(`https://api-gw.sports.naver.com/schedule/games/${id.slice(3)}/record`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      rec = r.ok ? (await r.json()).result?.recordData : null;
    } catch { rec = null; }
    if (!rec) { failed++; continue; }
    for (const [s, side] of [['h', 'home'], ['a', 'away']]) {
      const byId = new Map((rec[`${side}PlayerStats`] || []).map((p) => [String(p.playerId), p]));
      for (const p of b.pl[s] || []) {
        const raw = byId.get(String(p.pid).split(':').pop());
        if (raw) p.fg = [raw.fg, (raw.twoPA ?? 0) + (raw.threePA ?? 0)];
      }
      const x = rec[side];
      if (x && b.tm?.[s]) b.tm[s].fg = [x.normalFg ?? x.fg + x.threep, x.normalFgA ?? x.fgA + x.threepA];
    }
    changed = true; fixed++;
    await sleep(150);
  }
  if (changed) await fs.writeFile(path.join(DIR, f), JSON.stringify(box) + '\n', 'utf8');
}
console.log(`[backfill-naver-box-fg] tried=${tried} fixed=${fixed} failed=${failed}`);

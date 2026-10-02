// 농구 즐겨찾기 선수 "경기 종료 기록 요약" 알림. 박스스코어(basketball/box-YYYY-MM.json)가 있는
// 종료 경기만 대상 — 선수 고유ID(pid)로 player_<hash> 토픽에 발송(구독자 0이면 FCM no-op).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendPlayerEvent } from './send-player-alert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENT_FILE = path.join(ROOT, 'sent-bk-alerts.json');
const load = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };

const games = (await load(path.join(ROOT, 'basketball/games.json'), {})).games || [];
const teams = await load(path.join(ROOT, 'basketball/teams.json'), {});
const names = await load(path.join(ROOT, 'basketball/team-name-en.json'), {});
const koRaw = await load(path.join(ROOT, 'player-name-ko.json'), {});
const ko = {};
for (const [k, v] of Object.entries(koRaw)) if (!(v in ko)) ko[v] = k;
const sent = await load(SENT_FILE, {});
const tn = (k) => teams[k]?.ko || teams[k]?.en || names['bk:' + k] || '';

const cutoff = Date.now() - 36 * 3600e3;
const boxCache = {};
let n = 0;
for (const g of games) {
  if (g.st !== 'final' || !g.boxed || g.t < cutoff) continue;
  const f = `basketball/box-${g.date.slice(0, 7)}.json`;
  boxCache[f] ??= await load(path.join(ROOT, f), {});
  const box = boxCache[f][g.id];
  if (!box?.pl) continue;
  const score = `${tn(g.a.k)} ${g.a.s}-${g.h.s} ${tn(g.h.k)}`;
  for (const side of ['h', 'a']) {
    for (const p of box.pl[side] || []) {
      const key = `${g.id}:${p.pid}`;
      if (!p.pid || sent[key] || !(parseInt(p.min) > 0)) continue;
      const stats = [`${p.pts ?? 0}점`, p.reb ? `${p.reb}리바운드` : '', p.ast ? `${p.ast}어시스트` : '', p.stl >= 3 ? `${p.stl}스틸` : '', p.blk >= 3 ? `${p.blk}블록` : ''].filter(Boolean).join(' ');
      const nm = ko[p.n] || p.n;
      try {
        await sendPlayerEvent(p.pid, { title: `🏀 ${nm} ${stats}`, body: `${score}${g.lg ? ' · ' + g.lg : ''}`, gameId: g.id, displayName: nm });
        sent[key] = new Date().toISOString();
        n++;
      } catch (e) { console.error('[bk-alerts] FAIL', key, e?.message ?? e); }
    }
  }
}
for (const k of Object.keys(sent)) if (Date.parse(sent[k]) < Date.now() - 14 * 86400e3) delete sent[k];
await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 1) + '\n');
console.log(`[bk-alerts] sent=${n} state=${Object.keys(sent).length}`);

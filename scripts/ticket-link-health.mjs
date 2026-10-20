// 예매 링크(ticket-links.json) 자동 점검·복구(2026-10-21) — 구단 홈페이지 개편으로 주소가 죽는 일이 반복돼(삼성·포르투·리가 데 키토·카리베스·우니베르시타리오) 매일 점검한다.
// 원칙(보수적):
//  1) "확실히 죽은" 경우만 센다 — HTTP 404/410 이거나, 200 이어도 본문 첫머리가 "페이지를 찾을 수 없음/404 Not Found" 류. 봇 차단(403·401·429·Cloudflare·대기열)·접속 오류·5xx 는 판정 불가(unknown)라 건드리지 않는다.
//  2) 연속 2회(12시간 주기면 약 12시간 간격) 죽어 있어야 고친다 — 일시 장애로 멀쩡한 링크를 바꾸지 않기 위해.
//  3) 고치는 순서: 같은 사이트 첫 화면에서 "티켓/예매/bilhetes/entradas…" 링크를 찾아 점검을 통과하면 그걸로 교체 → 없으면 사이트 첫 화면(origin)으로 후퇴 → 그것도 안 되면 그대로 두고 알림만.
//  4) 바꾼 내용·고치지 못한 죽은 링크는 Discord 로 알린다(자동 교체가 틀릴 수 있어 사람이 확인).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINKS_FILE = path.join(ROOT, 'ticket-links.json');
const STATE_FILE = path.join(ROOT, 'ticket-link-state.json');
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const NOTFOUND_RE = /(\b404\b[^.]{0,40}(not found|não encontrad|no encontrad|introuvable|nicht gefunden|non trovat|niet gevonden|bulunamadı|не найден))|page not found|página não encontrada|página no encontrada|page introuvable|seite nicht gefunden|pagina non trovata|pagina niet gevonden|페이지를 찾을 수 없|요청하신 페이지(를|가)|페이지가 존재하지 않|존재하지 않는 페이지|ページが見つかりません|找不到(该|此)?页面|找不到頁面/i;
const BLOCK_TITLE_RE = /just a moment|attention required|access denied|forbidden|checkpoint|queue|waiting room|captcha|robot|security/i;
const TICKET_RE = /ticket|티켓|예매|bilhet|entrad|boleto|billet|biglietti|karten|kaartjes|チケット|门票|票务/i;
const GOOD_VENDOR_RE = /ticketlink|ticketmaster|ticketone|eventim|ticketing|tickets\.|entradas\.|bilhetes\./i;

// 응답 하나를 판정: 'ok' | 'dead' | 'unknown'
export function classify({ status, title = '', visibleText = '' }) {
  if (status === 404 || status === 410) return 'dead';
  if (status === 0 || status === 401 || status === 403 || status === 429 || status >= 500) return 'unknown'; // 접속 오류·봇 차단·서버 장애
  if (BLOCK_TITLE_RE.test(title)) return 'unknown';
  const head = visibleText.slice(0, 1500);
  if (NOTFOUND_RE.test(title) || NOTFOUND_RE.test(head)) return 'dead';
  return 'ok';
}

export const visibleOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const titleOf = (html) => (/<title[^>]*>([^<]*)/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim();

// 첫 화면 HTML 에서 예매 링크 후보를 찾는다(점수순).
export function findCandidates(html, baseUrl) {
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const out = new Map();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const text = visibleOf(m[2]).slice(0, 60);
    if (!TICKET_RE.test(href + ' ' + text)) continue;
    let abs;
    try { abs = new URL(href, base).toString(); } catch { continue; }
    if (!/^https?:/i.test(abs)) continue;
    const u = new URL(abs);
    if (/\.(pdf|jpe?g|png|gif|zip)$/i.test(u.pathname) || /facebook|instagram|twitter|youtube|x\.com/i.test(u.host)) continue;
    let score = 0;
    if (u.host.replace(/^www\./, '') === base.host.replace(/^www\./, '')) score += 2;
    else if (GOOD_VENDOR_RE.test(u.host)) score += 1;
    else score -= 1;
    if (/ticket|bilhet|entrad|boleto|billet|티켓|예매/i.test(u.pathname + u.host)) score += 2;
    if (/^(tickets?|bilhetes?|entradas?|boletos?|티켓|예매)/i.test(text)) score += 1;
    if (u.pathname === '/' && !u.search) score -= 2;
    out.set(abs, Math.max(out.get(abs) ?? -9, score));
  }
  return [...out.entries()].filter(([, s]) => s >= 2).sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 5);
}

// 링크(문자열 URL)만 모아 [{ path:[...keys], url }] 로 — 중첩 구조 허용, 'onsite' 같은 표기·버전 숫자는 제외.
export function collectLinks(obj, trail = []) {
  const res = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) res.push({ path: [...trail, k], url: v });
    else if (v && typeof v === 'object' && !Array.isArray(v)) res.push(...collectLinks(v, [...trail, k]));
  }
  return res;
}
export const keyOf = (p) => p.join('/');

export async function probe(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ko,en;q=0.8,es;q=0.6' }, signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await res.arrayBuffer());
    let html = buf.toString('utf8');
    if (/charset=["']?euc-kr/i.test(html.slice(0, 2000))) html = new TextDecoder('euc-kr').decode(buf);
    const verdict = classify({ status: res.status, title: titleOf(html), visibleText: visibleOf(html) });
    return { verdict, status: res.status, html, finalUrl: res.url };
  } catch { return { verdict: 'unknown', status: 0, html: '', finalUrl: url }; }
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function tryFix(url) {
  let origin;
  try { origin = new URL(url).origin + '/'; } catch { return null; }
  const home = await probe(origin);
  if (home.verdict === 'ok') {
    for (const cand of findCandidates(home.html, home.finalUrl)) {
      if (cand === url) continue;
      const r = await probe(cand);
      if (r.verdict === 'ok') return { url: cand, kind: '첫 화면의 예매 링크' };
    }
    return { url: origin, kind: '사이트 첫 화면으로 후퇴(예매 링크를 못 찾음)' };
  }
  return null;
}

async function notify(lines) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  const content = `🟡 ShadeSide — 예매 링크 점검\n${lines.join('\n')}`.slice(0, 1900);
  console.log(content);
  if (!hook || process.env.DRY_RUN) return;
  try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); } catch { /* 알림 실패는 무시 */ }
}

function setAt(obj, p, v) { let o = obj; for (const k of p.slice(0, -1)) o = o[k]; o[p[p.length - 1]] = v; }

async function main() {
  const dry = !!process.env.DRY_RUN;
  const rawLinks = await fs.readFile(LINKS_FILE, 'utf8');
  const links = JSON.parse(rawLinks);
  const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8').catch(() => '{}'));
  const all = collectLinks(links);
  const results = await mapLimit(all, 6, async (l) => ({ ...l, ...(await probe(l.url)) }));
  const now = new Date().toISOString();
  const fixed = [], stuck = [];
  let dead = 0, unknown = 0;
  for (const r of results) {
    const key = keyOf(r.path);
    const st = (state[key] ||= { fails: 0 });
    st.checked = now;
    if (r.verdict === 'ok') { st.fails = 0; st.lastOk = now; delete st.url; continue; }
    if (r.verdict === 'unknown') { unknown++; continue; } // 판정 불가는 연속 실패로 세지 않고 그대로 둔다
    dead++;
    if (st.url !== r.url) { st.url = r.url; st.fails = 0; } // 주소가 바뀌었으면 처음부터 다시 센다
    st.fails++;
    if (st.fails < 2) continue;
    const fix = await tryFix(r.url);
    if (fix) { setAt(links, r.path, fix.url); fixed.push(`• ${keyOf(r.path)}: ${r.url} → ${fix.url} (${fix.kind})`); delete state[key]; }
    else if (!st.notified || Date.now() - Date.parse(st.notified) >= 24 * 3600e3) { stuck.push(`• ${keyOf(r.path)}: ${r.url} (죽어 있는데 대체 주소를 못 찾음)`); st.notified = now; } // 같은 알림은 24시간에 한 번만
  }
  console.log(`[ticket-links] 총 ${all.length}개 · 정상 ${all.length - dead - unknown} · 죽은 의심 ${dead} · 판정 불가 ${unknown} · 교체 ${fixed.length}`);
  if (!dry) {
    if (fixed.length) {
      const crlf = rawLinks.includes('\r\n');
      let out = JSON.stringify(links, null, rawLinks.replace(/\r\n/g, '\n').match(/\n( +)"/)?.[1].length || 2);
      if (crlf) out = out.replace(/\n/g, '\r\n');
      await fs.writeFile(LINKS_FILE, out + (/\n$/.test(rawLinks) ? (crlf ? '\r\n' : '\n') : ''), 'utf8');
    }
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 1) + '\n', 'utf8');
  }
  const lines = [...(fixed.length ? ['**자동으로 교체함(확인 필요)**', ...fixed] : []), ...(stuck.length ? ['**죽은 링크(수동 조치 필요)**', ...stuck] : [])];
  if (lines.length) await notify(lines);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

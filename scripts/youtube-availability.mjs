// 저장된 YouTube 영상(하이라이트·응원가)의 "지역별 재생 가능 여부"를 videos.list 로 확인해 video-availability.json 에 기록한다(2026-10-13).
// 계기: NBC Sports 의 리버풀-맨시티 하이라이트가 한국에서 "업로더가 해당 국가에서 볼 수 없도록 설정하지 않았습니다"로 재생이 안 됐다 — 앱이 지역을 안 보고 링크를 걸었다.
// videos.list 는 50개당 1유닛. 응답의 contentDetails.regionRestriction(allowed|blocked)으로 지역별 차단을 판정하고, 삭제·비공개 영상은 gone 으로 표시한다.
// 이 작업은 YouTube API 정책의 "저장한 API 데이터는 30일 안에 다시 확인"도 같이 충족한다(여기서는 7일마다 갱신).
// 출력(영상 ID 키): { b?: ["KR",…](지원 지역 중 차단된 곳), g?: 1(삭제/비공개), t: 확인 시각(ms) }. 앱은 이 파일만 읽는다(런타임 API 호출 0회).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'video-availability.json');
const API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_CALLS = Number(process.env.AVAIL_MAX_CALLS || 30); // 실행당 videos.list 호출 상한(1호출=50개=1유닛)
const REFRESH_MS = Number(process.env.AVAIL_REFRESH_DAYS || 7) * 86400000;

// 앱이 지원하는 언어권의 대표 지역 — 여기에 해당하는 차단만 기록한다(전 세계 국가 목록을 저장하면 파일이 커진다).
// 2026-10-15 확대(25 → 58곳): 목록에 없는 나라는 실제로 막혀 있어도 "열린다"로 처리돼 눌러도 안 열리는 버튼이 보일 수 있었다 — 사용자가 있을 만한 나라를 더 넣었다.
export const REGIONS = ['KR', 'JP', 'US', 'GB', 'ES', 'MX', 'BR', 'PT', 'FR', 'DE', 'IT', 'RU', 'SA', 'EG', 'AE', 'ID', 'TH', 'VN', 'CN', 'TW', 'HK', 'IN', 'TR', 'NL', 'AU', 'CA',
  'SG', 'PH', 'MY', 'NZ', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'UY', 'PL', 'CZ', 'SE', 'NO', 'DK', 'FI', 'IE', 'CH', 'AT', 'BE', 'GR', 'RO', 'HU', 'UA', 'IL', 'QA', 'KW', 'ZA', 'NG', 'PK', 'BD'];
// 기록 버전 — 지역 목록을 바꾸면 올려서, 옛 목록으로 확인한 기록(v 없음/낮음)을 7일을 기다리지 않고 다시 확인한다.
export const REGIONS_VER = 2;

// regionRestriction → 지원 지역 중 차단된 지역 목록. allowed 가 있으면 거기 없는 지역이 차단, blocked 가 있으면 거기 있는 지역이 차단. 둘 다 없으면 제한 없음([]).
export function blockedRegions(rr, regions = REGIONS) {
  if (!rr) return [];
  if (Array.isArray(rr.allowed)) { const ok = new Set(rr.allowed); return regions.filter((r) => !ok.has(r)); }
  if (Array.isArray(rr.blocked)) { const no = new Set(rr.blocked); return regions.filter((r) => no.has(r)); }
  return [];
}

// videos.list 항목 하나 → 기록 값. 비공개·업로드 실패·삭제 상태면 gone.
export function entryFromItem(item, now) {
  const st = item?.status || {};
  if (!item || (st.privacyStatus && st.privacyStatus === 'private') || st.uploadStatus === 'deleted' || st.uploadStatus === 'rejected' || st.uploadStatus === 'failed') return { g: 1, t: now, v: REGIONS_VER };
  const b = blockedRegions(item?.contentDetails?.regionRestriction);
  return b.length ? { b, t: now, v: REGIONS_VER } : { t: now, v: REGIONS_VER };
}

// 2026-10-20 YouTube 심사 지적(III.E.4a, "저장한 API 데이터를 얼마나 자주 갱신·삭제하는가") 대응 — 저장하는 영상 정보(ID·제목)도 이 확인 때 같이 갱신한다:
//  · 제목: videos.list 가 돌려준 최신 제목으로 덮어쓴다.
//  · 삭제·비공개·업로드 실패 영상: 하이라이트 항목에서 빼고(대표 영상이면 다음 후보를 올림, 후보가 없으면 항목 삭제), 응원가 항목은 null 로 비운다.
// 모든 저장 영상은 REFRESH_MS(기본 7일)마다 이 경로를 지나므로 30일 기준을 넘기지 않는다.
export function applyRefresh(hl, cs, checks) {
  // checks: Map<videoId, { title?: string, gone: boolean }>
  let titles = 0, removed = 0;
  const upd = (o) => { const c = checks.get(o.v); if (c?.title && o.t !== c.title) { o.t = c.title; titles++; } };
  for (const key of Object.keys(hl)) {
    const e = hl[key];
    if (!e || typeof e !== 'object') continue;
    const all = [e, ...(Array.isArray(e.alts) ? e.alts : [])].filter((o) => o?.v);
    const alive = all.filter((o) => !checks.get(o.v)?.gone);
    removed += all.length - alive.length;
    if (alive.length === all.length) { for (const o of all) upd(o); continue; }
    if (alive.length === 0) { delete hl[key]; continue; }
    const [first, ...rest] = alive;
    const next = { ...e, v: first.v, t: first.t };
    if (rest.length) next.alts = rest.map((o) => ({ v: o.v, t: o.t })); else delete next.alts;
    upd(next); for (const a of next.alts || []) upd(a);
    hl[key] = next;
  }
  for (const key of Object.keys(cs)) {
    const e = cs[key];
    if (!e || typeof e !== 'object' || !e.v) continue;
    if (checks.get(e.v)?.gone) { cs[key] = null; removed++; continue; }
    upd(e);
  }
  return { titles, removed };
}

// 원본 파일의 줄바꿈(CRLF)·들여쓰기를 유지해 저장(불필요한 대량 diff 방지).
function formatLike(raw, obj) {
  const crlf = raw.includes('\r\n');
  const ind = raw.replace(/\r\n/g, '\n').match(/\n( +)"/)?.[1].length;
  let out = JSON.stringify(obj, null, ind);
  if (crlf) out = out.replace(/\n/g, '\r\n');
  return out + (/\n$/.test(raw) ? (crlf ? '\r\n' : '\n') : '');
}

async function collectIds() {
  const ids = new Set();
  const hl = JSON.parse(await fs.readFile(path.join(ROOT, 'highlights-video.json'), 'utf8').catch(() => '{}'));
  for (const v of Object.values(hl)) {
    if (v?.v) ids.add(v.v);
    for (const a of v?.alts || []) if (a?.v) ids.add(a.v);
  }
  const cs = JSON.parse(await fs.readFile(path.join(ROOT, 'cheer-songs.json'), 'utf8').catch(() => '{}'));
  for (const v of Object.values(cs)) if (v?.v) ids.add(v.v);
  return [...ids];
}

async function main() {
  if (!API_KEY) { console.error('YOUTUBE_API_KEY required'); process.exit(1); }
  const now = Date.now();
  let avail = {};
  try { avail = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }
  const ids = await collectIds();
  // 새 영상 먼저, 그다음 가장 오래 확인 안 한 순서. 7일 안에 확인한 영상은 건너뜀. 더 이상 쓰이지 않는 ID 는 기록에서 제거.
  const used = new Set(ids);
  for (const k of Object.keys(avail)) if (!used.has(k)) delete avail[k];
  const stale = (id) => !avail[id] || (avail[id].v || 1) < REGIONS_VER;
  const todo = ids.filter((id) => stale(id) || now - (avail[id].t || 0) >= REFRESH_MS).sort((a, b) => (stale(b) - stale(a)) || ((avail[a]?.t || 0) - (avail[b]?.t || 0)));
  console.log(`[avail] ids=${ids.length} todo=${todo.length} maxCalls=${MAX_CALLS}`);
  let calls = 0, checked = 0, gone = 0, blocked = 0, stop = '';
  const checks = new Map();
  for (let i = 0; i < todo.length && calls < MAX_CALLS; i += 50) {
    const batch = todo.slice(i, i + 50);
    const url = 'https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({
      part: 'snippet,contentDetails,status', id: batch.join(','), maxResults: '50',
      fields: 'items(id,snippet/title,contentDetails/regionRestriction,status/privacyStatus,status/uploadStatus)', key: API_KEY,
    });
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch { stop = '네트워크 오류 — 중단'; break; }
    calls++;
    if (res.status === 403 || res.status === 429) { stop = `HTTP ${res.status} (쿼터/제한) — 중단`; break; }
    if (!res.ok) { stop = `HTTP ${res.status} — 중단`; break; }
    const j = await res.json().catch(() => null);
    if (!j || !Array.isArray(j.items)) { stop = '응답 형식 오류 — 중단'; break; }
    if (j.items.length === 0 && batch.length >= 10) { stop = `빈 응답(${batch.length}건 요청) — 이상 응답으로 보고 중단`; break; }
    const byId = new Map(j.items.map((it) => [it.id, it]));
    for (const id of batch) {
      const e = entryFromItem(byId.get(id), now); // 응답에 없으면 삭제된 영상
      const prevGone = !!avail[id]?.g;
      avail[id] = e; checked++;
      // 저장 파일에서 지우는 건 연속 두 번 gone 으로 확인됐을 때만(API 일시 오류로 멀쩡한 항목이 영구 삭제되는 것 방지). 한 번 gone 이면 앱은 숨기기만 한다.
      checks.set(id, { title: byId.get(id)?.snippet?.title, gone: !!e.g && prevGone });
      if (e.g) gone++; else if (e.b) blocked++;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await fs.writeFile(OUT, JSON.stringify(avail) + '\n', 'utf8');
  if (checks.size) {
    const HL = path.join(ROOT, 'highlights-video.json'), CS = path.join(ROOT, 'cheer-songs.json');
    const rawH = await fs.readFile(HL, 'utf8').catch(() => '{}'), rawC = await fs.readFile(CS, 'utf8').catch(() => '{}');
    const hl = JSON.parse(rawH), cs = JSON.parse(rawC);
    const r = applyRefresh(hl, cs, checks);
    if (r.titles || r.removed) {
      await fs.writeFile(HL, formatLike(rawH, hl), 'utf8');
      await fs.writeFile(CS, formatLike(rawC, cs), 'utf8');
    }
    console.log(`[avail] 저장 영상 정보 갱신: 제목 ${r.titles}건 수정, 삭제/비공개 ${r.removed}건 제거`);
  }
  console.log(`[avail] calls=${calls} checked=${checked} gone=${gone} blockedSomewhere=${blocked}${stop ? ' STOP: ' + stop : ''}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

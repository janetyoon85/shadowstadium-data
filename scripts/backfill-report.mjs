// 백필 현황 보고(2026-10-09, 사용자: "백필 현황 4시간마다 보고해줘") — 저장소의 백필 결과 파일을 집계해 Discord로 보낸다.
// 실행: node scripts/backfill-report.mjs [--dry]   (DISCORD_WEBHOOK_URL 환경변수, 없으면 출력만)
// - 직전 보고와의 증감은 backfill-report-state.json 에 저장한 수치로 계산(수치가 안 바뀌면 파일도 안 바뀌어 커밋 노이즈 없음).
// - 24시간 이상 증가가 없는 항목은 "정체"로 따로 표시 — Actions 로그를 안 열어도 백필이 멈춘 걸 알 수 있게.
// - 최근·예정 기준(-7일~+14일)과 제외 목록(중국 구장·올스타·국가대표 로고)은 ops-health-check 와 동일(ops-shared.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHINA_VENUES, ALLSTAR_TEAMS, NATIONAL_LEAGUES } from './ops-shared.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');
const STATE_FILE = path.join(ROOT, 'backfill-report-state.json');
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const readDirJson = (dir) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.json')).map((f) => J(path.join(dir, f), {})); } catch { return []; } };
const truthy = (o) => Object.values(o || {}).filter(Boolean).length;
const STALE_MS = 24 * 3600e3;

const now = Date.now();
const kst = new Date(now + 9 * 3600e3);
const kstToday = kst.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const lo = addDays(kstToday, -7), hi = addDays(kstToday, 14);

// ── 데이터 로드 ──
const gamesRaw = J('games.json', []);
const games = Array.isArray(gamesRaw) ? gamesRaw : gamesRaw.games || [];
const venuePhotos = J('venue-photos.json', {});
const venueEn = J('venue-name-en.json', {});
const venueInfo = J('venue-info.json', {});
const venuesMeta = J('venues-meta.json', []);
const logos = J('team-logos.json', {});
const teamEn = J('team-name-en.json', {});
const trophy = J('trophy-photos.json', {});
const celebration = J('team-celebration.json', {});
const players = J('players.json', []);
const playerPhotos = J('player-photos.json', {});
const cheer = J('cheer-songs.json', {});
const highlights = J('highlights-video.json', {});

// ── 최근·예정 구장 / 전체 팀 ──
const winVenues = new Set();
const teamLeague = new Map();
for (const g of games) {
  if (g.date && g.date >= lo && g.date <= hi && g.venueId && !CHINA_VENUES.has(g.venueId)) winVenues.add(g.venueId);
  for (const n of [g.home, g.away]) if (n) teamLeague.set(n, g.league);
}
const baseOf = (n) => n.replace(/\s*\((남자|여자)\)$/, '');
const hasLogo = (n) => { const b = baseOf(n); return !!(logos[n] || logos[b] || logos[`${b}|Baseball`] || logos[`${b}|Soccer`]); };
const logoTeams = [...teamLeague].filter(([n, lg]) => !ALLSTAR_TEAMS.has(n) && !NATIONAL_LEAGUES.has(lg)).map(([n]) => n);
const enTeams = [...teamLeague.keys()].filter((n) => !ALLSTAR_TEAMS.has(n));

// ── 팀 소개(위키 기반) ──
let ti = 0, tiPhotos = 0, tiHist = 0, tiHon = 0;
for (const shard of readDirJson('team-info')) {
  for (const v of Object.values(shard)) {
    if (!v || typeof v !== 'object') continue;
    ti++; if (v.photos?.length) tiPhotos++; if (v.hist) tiHist++; if (v.honours?.length) tiHon++;
  }
}
// ── 팀 소개 다국어(언어별 폴더) ──
let i18nLangs = 0, i18nSum = 0;
try {
  for (const d of fs.readdirSync(path.join(ROOT, 'team-info-i18n'))) {
    const dir = path.join('team-info-i18n', d);
    if (!fs.statSync(path.join(ROOT, dir)).isDirectory()) continue;
    i18nLangs++;
    for (const shard of readDirJson(dir)) i18nSum += truthy(shard);
  }
} catch {}

// ── 응원가: 소스별 시도/성공 ──
const cheerBy = {};
for (const [id, v] of Object.entries(cheer)) {
  const src = id.startsWith('nbk:') || id.startsWith('espnbk:') ? id.split(':').slice(0, 2).join(':') : id.split(':')[0];
  const s = (cheerBy[src] ??= { n: 0, h: 0 });
  s.n++; if (v) s.h++;
}
const cheerSum = Object.values(cheerBy).reduce((a, s) => ({ n: a.n + s.n, h: a.h + s.h }), { n: 0, h: 0 });

// ── 지표 정의: key → { label, value, total?, grow(정체 감시 대상) } ──
const M = {};
const put = (key, label, value, total, grow = false, group = '') => { M[key] = { label, value, total, grow, group }; };
put('venuePhotoWin', '사진(최근·예정)', [...winVenues].filter((i) => venuePhotos[i]).length, winVenues.size, true, '구장');
put('venuePhotoAll', '사진(전체)', truthy(venuePhotos), venuesMeta.length || Object.keys(venuePhotos).length, true, '구장');
put('venueEnWin', '영문명', [...winVenues].filter((i) => venueEn[i]).length, winVenues.size);
put('venueInfoWin', '정보', [...winVenues].filter((i) => i in venueInfo).length, winVenues.size);
put('teamLogo', '로고', logoTeams.filter(hasLogo).length, logoTeams.length, true, '팀');
put('teamEn', '영문명', enTeams.filter((n) => teamEn[n] || teamEn[baseOf(n)]).length, enTeams.length, true, '팀');
put('teamInfo', '문서', ti, undefined, true, '팀 소개');
put('teamInfoPhoto', '사진', tiPhotos, ti, true, '팀 소개');
put('teamInfoHist', '연혁', tiHist, ti);
put('teamInfoHon', '우승이력', tiHon, ti);
put('teamInfoI18n', '다국어 문장(언어평균)', i18nLangs ? Math.round(i18nSum / i18nLangs) : 0, undefined);
put('playerPhoto', '사진', truthy(playerPhotos), players.length, true, '선수');
put('playerI18n', '다국어명', Object.keys(J('player-name-i18n.json', {})).length, undefined, true, '선수');
put('playerNameKo', '한글명', Object.keys(J('player-name-ko.json', {})).length, undefined);
put('cheer', '찾음', cheerSum.h, cheerSum.n, true, '응원가');
put('trophy', '트로피 사진', truthy(trophy), Object.keys(trophy).length);
put('celebration', '응원문화 사진', truthy(celebration), Object.keys(celebration).length);
put('highlight', '영상', Object.keys(highlights).length, undefined, true, '하이라이트');
const bk = (f) => { const d = J(`basketball/${f}`, null); return Array.isArray(d) ? d.length : d && typeof d === 'object' ? Object.keys(d).length : 0; };
put('bkPlayers', '선수', bk('players.json'), undefined);
put('bkPlayerInfo', '선수정보', bk('player-info.json'), undefined);
put('bkWd', '위키데이터', bk('player-wd.json'), undefined);

// ── 직전 보고 대비 ──
const prev = J('backfill-report-state.json', null);
const first = !prev;
const next = { metrics: {}, changedAt: {} };
const delta = {};
const stale = [];
for (const [k, m] of Object.entries(M)) {
  const before = prev?.metrics?.[k];
  next.metrics[k] = m.value;
  const changed = before === undefined || before !== m.value;
  next.changedAt[k] = changed ? new Date(now).toISOString() : prev.changedAt?.[k] || new Date(now).toISOString();
  if (before !== undefined) delta[k] = m.value - before;
  // 정체: 증가가 기대되는(grow) 항목 중 24시간 이상 수치가 안 바뀌고, 아직 목표(total)에 못 미친 것
  const done = m.total !== undefined && m.value >= m.total;
  if (m.grow && !done && !first && now - Date.parse(next.changedAt[k]) >= STALE_MS) {
    stale.push(`${m.group ? m.group + ' ' : ''}${m.label} ${Math.floor((now - Date.parse(next.changedAt[k])) / 3600e3)}시간`);
  }
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const d = (k) => (delta[k] > 0 ? ` (+${fmt(delta[k])})` : delta[k] < 0 ? ` (${fmt(delta[k])})` : '');
const line = (k) => { const m = M[k]; return `${m.label} ${fmt(m.value)}${m.total !== undefined ? '/' + fmt(m.total) : ''}${d(k)}`; };
const cheerSrc = ['kbo', 'nbk:kbl', 'naver', 'mlb', 'espn', 'espnbk:nba']
  .filter((s) => cheerBy[s]).map((s) => `${s} ${cheerBy[s].h}/${cheerBy[s].n}`).join(' · ');

const stamp = `${kst.toISOString().slice(5, 10)} ${kst.toISOString().slice(11, 16)} KST`;
let msg = `📊 **ShadeSide 백필 현황** · ${stamp}${first ? ' (첫 보고 — 다음부터 증감 표시)' : ' (직전 보고 대비)'}\n`;
msg += `\n**구장** ${['venuePhotoWin', 'venuePhotoAll', 'venueEnWin', 'venueInfoWin'].map(line).join(' · ')}`;
msg += `\n**팀** ${['teamLogo', 'teamEn'].map(line).join(' · ')}`;
msg += `\n**팀 소개** ${['teamInfo', 'teamInfoPhoto', 'teamInfoHist', 'teamInfoHon', 'teamInfoI18n'].map(line).join(' · ')}`;
msg += `\n**선수** ${['playerPhoto', 'playerI18n', 'playerNameKo'].map(line).join(' · ')}`;
msg += `\n**응원가** ${line('cheer')}${cheerSrc ? '\n  └ 소스별 ' + cheerSrc : ''}`;
msg += `\n**기타** ${['highlight', 'trophy', 'celebration'].map(line).join(' · ')}`;
msg += `\n**농구** ${['bkPlayers', 'bkPlayerInfo', 'bkWd'].map(line).join(' · ')}`;
msg += stale.length ? `\n\n⏸ **24시간 이상 변화 없음**: ${stale.join(' · ')}` : '\n\n✅ 정체된 백필 없음';

console.log(msg);
const sendDiscord = async (hook, text) => {
  let ok = true;
  let buf = '';
  const flush = async () => {
    if (!buf.trim()) return;
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: buf }) });
    if (!r.ok) { ok = false; console.error('discord 발송 실패', r.status); }
    buf = '';
  };
  for (const l of text.split('\n')) { if (buf.length + l.length + 1 > 1800) await flush(); buf += (buf ? '\n' : '') + l.slice(0, 1500); }
  await flush();
  return ok;
};
const hook = process.env.DISCORD_WEBHOOK_URL;
if (!dry) {
  if (hook) await sendDiscord(hook, msg); else console.log('[report] DISCORD_WEBHOOK_URL 없음 — 발송 생략');
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 1) + '\n');
}

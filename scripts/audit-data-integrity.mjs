// 데이터 정합성 전수 점검(2026-10-26, "전 세계에서 받는 앱이라 데이터 정합성이 틀리면 안 된다") — 읽기 전용. 결과는 콘솔 + audit-integrity-report.json.
// 사용: node scripts/audit-data-integrity.mjs [앱 App.tsx 경로(구장 좌표 대조용, 없으면 생략)]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const games = rj('games.json', []);
const manual = rj('manual_games.json', []);
const players = rj('players.json', []);
const bk = rj('basketball/games.json', { games: [] }).games || [];
const bkTeams = rj('basketball/teams.json', {});
const venueCountry = rj('venue-country.json', {});
const report = { checks: {} };
const add = (id, title, items, note = '') => { report.checks[id] = { title, count: items.length, note, examples: items.slice(0, 8) }; };
const KST = 9 * 3600e3;
const ts = (g) => Date.parse(`${g.date}T${/^\d\d:\d\d$/.test(g.time) ? g.time : '12:00'}:00Z`) - KST;
const now = Date.now();
const BASEBALL = /BASEBALL|^(KBO|MLB|NPB|LMB|LMP|LVBP|LIDOM|AFL|PWL|ABL|AAA|CARIBBEANSERIES|PREMIER12)$/;

// ── 경기 ────────────────────────────────────────────────
// G1 필수 필드·형식
add('G1', '필수 필드/날짜·시간 형식 오류', games.filter((g) => !g.gameId || !/^\d{4}-\d\d-\d\d$/.test(g.date || '') || !/^\d\d:\d\d$/.test(g.time || '') || !g.league || !g.home || !g.away || !g.venueId).map((g) => `${g.gameId} ${g.date} ${g.time} ${g.league} ${g.home}-${g.away} venue=${g.venueId}`));
// G2 gameId 중복
{ const c = new Map(); for (const g of games) c.set(g.gameId, (c.get(g.gameId) || 0) + 1); add('G2', 'gameId 중복', [...c].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`)); }
// G3 같은 경기가 다른 gameId 로 이중 등록(같은 리그·날짜·두 팀)
{ const m = new Map(); for (const g of games) { const k = `${g.league}|${g.date}|${[g.home, g.away].sort().join('~')}`; (m.get(k) ?? m.set(k, []).get(k)).push(g); }
  const dup = [...m].filter(([, a]) => a.length > 1 && a.some((x, i) => a.some((y, j) => i < j && Math.abs(ts(x) - ts(y)) <= 30 * 60e3 && (x.homeScore ?? null) === (y.homeScore ?? null) && (x.awayScore ?? null) === (y.awayScore ?? null))));
  add('G3', '같은 경기 이중 등록(리그·날짜·팀쌍 동일)', dup.map(([k, a]) => `${k} ids=${a.map((x) => x.gameId).join(',')}`), '같은 리그·날짜·팀쌍이면서 킥오프 30분 이내·같은 스코어인 것만(더블헤더 제외)'); }
// G4 상태·점수 모순
add('G4a', '종료인데 점수 없음', games.filter((g) => g.status === 'completed' && (g.homeScore == null || g.awayScore == null) && !BASEBALL.test(g.league) ).map((g) => `${g.date} ${g.league} ${g.home}-${g.away} ${g.gameId}`));
add('G4b', '예정/취소인데 점수 있음', games.filter((g) => ['scheduled', 'cancelled', 'postponed'].includes(g.status) && (g.homeScore > 0 || g.awayScore > 0)).map((g) => `${g.date} ${g.league} ${g.home} ${g.homeScore}-${g.awayScore} ${g.away} [${g.status}]`));
add('G4c', '진행중인데 킥오프 후 8시간 초과', games.filter((g) => g.status === 'live' && now - ts(g) > 8 * 3600e3).map((g) => `${g.date} ${g.time} ${g.league} ${g.home}-${g.away} ${g.gameId}`));
add('G4d', '예정인데 날짜가 지남(어제 이전)', games.filter((g) => g.status === 'scheduled' && g.date < new Date(now - 36 * 3600e3 + KST).toISOString().slice(0, 10) && now - ts(g) < 7 * 86400e3).map((g) => `${g.date} ${g.league} ${g.home}-${g.away} ${g.gameId}`), '7일 넘은 건 소스 미제공으로 앱이 숨김');
add('G4e', '점수 비정상(음수·50 초과)', games.filter((g) => [g.homeScore, g.awayScore].some((s) => s != null && (!Number.isFinite(s) || s < 0 || s > 50))).map((g) => `${g.date} ${g.league} ${g.home} ${g.homeScore}-${g.awayScore} ${g.away}`));
// G5 팀명 이상: 자기 자신과 경기, 빈 이름
add('G5', '홈=원정 이거나 팀명이 숫자/기호뿐', games.filter((g) => g.home === g.away || /^[0-9 .,()+-]+$/.test(g.home) || /^[0-9 .,()+-]+$/.test(g.away)).map((g) => `${g.gameId} ${g.home}/${g.away}`));
// G6 득점자·카드 이상
{ const bad = []; for (const g of games) for (const side of ['home', 'away']) { for (const s of g.scorers?.[side] || []) if (s.m != null && (s.m < 0 || s.m > 135)) bad.push(`${g.gameId} 득점 ${s.n} ${s.m}'`); for (const c of g.cards?.[side] || []) if (c.m != null && (c.m < 0 || c.m > 135)) bad.push(`${g.gameId} 카드 ${c.n} ${c.m}'`); } add('G6a', '득점·카드 분(minute)이 범위 밖', bad); }
{ const bad = []; for (const g of games) { if (g.status !== 'completed' || BASEBALL.test(g.league)) continue; const hs = (g.scorers?.home || []).length, as = (g.scorers?.away || []).length; if (g.scorers && (hs > (g.homeScore ?? 99) + 0 || as > (g.awayScore ?? 99) + 0)) bad.push(`${g.date} ${g.league} ${g.home} ${g.homeScore}-${g.awayScore} ${g.away} (득점자 ${hs}+${as})`); } add('G6b', '득점자 수가 스코어보다 많음(자책골 반영 시 오류 가능)', bad, '자책골은 수혜팀에 실려 일치해야 정상'); }
add('G6c', '득점자 수가 스코어보다 적음(최근 14일 종료 축구)', games.filter((g) => g.status === 'completed' && !BASEBALL.test(g.league) && g.homeScore != null && g.date >= new Date(now - 14 * 86400e3).toISOString().slice(0, 10) && ((g.scorers?.home || []).length < g.homeScore || (g.scorers?.away || []).length < g.awayScore) && /_ESPN_|^[A-Za-z0-9]{15}$/.test(g.gameId) ).map((g) => `${g.date} ${g.league} ${g.home} ${g.homeScore}-${g.awayScore} ${g.away} (득점자 ${(g.scorers?.home || []).length}+${(g.scorers?.away || []).length})`));
// G7 같은 선수가 같은 경기에서 양 팀 득점(동일 pid)
{ const bad = []; for (const g of games) { const h = new Set((g.scorers?.home || []).filter((s) => s.pid && !s.og).map((s) => s.pid)); for (const s of g.scorers?.away || []) if (s.pid && !s.og && h.has(s.pid)) bad.push(`${g.gameId} ${s.n}`); } add('G7', '같은 선수가 한 경기에서 양 팀 득점', bad); }
// G8 구장
{ const used = new Map(); for (const g of games) (used.get(g.venueId) ?? used.set(g.venueId, new Set()).get(g.venueId)).add(g.league);
  const metaIds = new Set((rj('venues-meta.json', [])).map((v) => v.id));
  add('G8a', '경기가 쓰는 구장 ID 가 앱 구장 목록(venues-meta)에 없음', [...used].filter(([id]) => !metaIds.has(id)).map(([id, l]) => `${id} (${[...l].join('/')})`));
  add('G8b', '경기가 쓰는 구장에 국가(venue-country) 없음', [...used].filter(([id, l]) => !venueCountry[id] && ![...l].every((x) => BASEBALL.test(x) && false)).map(([id, l]) => `${id} (${[...l].join('/')})`), '구장 정보 카드의 위치(국기) 행이 비는 구장'); }
// G10 같은 구단의 표기 변형(리그 안에서 공백·접미사만 다른 이름)
{ const by = new Map(); for (const g of games) for (const t of [g.home, g.away]) { const k = g.league + '|' + t.replace(/s/g, '').toLowerCase(); (by.get(k) ?? by.set(k, new Set()).get(k)).add(t); } add('G10', '같은 리그에서 공백만 다른 팀명 변형', [...by].filter(([, s]) => s.size > 1).map(([k, s]) => `${k.split('|')[0]}: ${[...s].join(' / ')}`)); }

// ── 선수 ────────────────────────────────────────────────
{ const c = new Map(); for (const p of players) c.set(p.id, (c.get(p.id) || 0) + 1); add('P1', '선수 id 중복', [...c].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`)); }
{ const by = new Map(); for (const p of players) if (/^(espn|naver):/.test(p.id)) (by.get(p.id) ?? by.set(p.id, new Set()).get(p.id)).add(p.name); add('P2', '같은 pid 에 이름이 여러 개', [...by].filter(([, s]) => s.size > 1).map(([id, s]) => `${id}: ${[...s].join(' / ')}`)); }
{ const natSet = new Map(); for (const p of players) for (const a of p.appearances || []) if (a.nat) natSet.set(a.nat, (natSet.get(a.nat) || 0) + 1); const odd = [...natSet].filter(([n, c]) => c <= 2 || /[가-힣]|\d/.test(n)); add('P3', '국적 값이 드물거나 이상(희소 값)', odd.map(([n, c]) => `${n} (${c})`)); }
add('P4', '소속(appearances) 없는 선수', players.filter((p) => !p.appearances || !p.appearances.length).map((p) => `${p.id} ${p.name}`));

// ── 농구 ────────────────────────────────────────────────
add('B1', '농구: 팀 키가 팀 목록에 없음', bk.filter((g) => !bkTeams[g.h?.k] || !bkTeams[g.a?.k]).map((g) => `${g.id} ${g.h?.k} / ${g.a?.k}`));
{ const m = new Map(); for (const g of bk) { const gid = (k) => { const t = bkTeams[k]; return t ? `${t.lg}|${(t.en || t.ko || k).toLowerCase()}` : k; }; const k = `${g.lg}|${g.date}|${[gid(g.h.k), gid(g.a.k)].sort().join('~')}`; (m.get(k) ?? m.set(k, []).get(k)).push(g); } add('B2', '농구: 같은 경기 이중 등록(리그·날짜·팀쌍)', [...m].filter(([, a]) => a.length > 1 && Math.max(...a.map((x) => x.t)) - Math.min(...a.map((x) => x.t)) < 6 * 3600e3).map(([k, a]) => `${k} ids=${a.map((x) => x.id).join(',')}`)); }
add('B3', '농구: 종료인데 점수 없음/동점(연장 없는 비정상)', bk.filter((g) => g.st === 'final' && (g.h?.s == null || g.a?.s == null || g.h.s === g.a.s)).map((g) => `${g.date} ${g.lg} ${g.h?.k} ${g.h?.s}-${g.a?.s} ${g.a?.k} ${g.id}`));
add('B4', '농구: 팀에 영문/한글 이름이 모두 없음', Object.entries(bkTeams).filter(([, t]) => !t.en && !t.ko && !t.ja).map(([k]) => k));
add('B5', '농구: 진행중인데 5시간 초과', bk.filter((g) => g.st === 'live' && now - g.t > 5 * 3600e3).map((g) => `${g.date} ${g.lg} ${g.id}`));

// ── 요약 ────────────────────────────────────────────────
fs.writeFileSync(path.join(ROOT, 'audit-integrity-report.json'), JSON.stringify(report, null, 1) + '\n');
let bad = 0;
for (const [id, c] of Object.entries(report.checks)) { console.log(`${c.count === 0 ? '✓' : '✗'} ${id.padEnd(4)} ${String(c.count).padStart(5)}  ${c.title}`); if (c.count) { bad++; for (const e of c.examples.slice(0, 3)) console.log('        ·', String(e).slice(0, 150)); } }
console.log(`\n이상 항목 ${bad}개 / 점검 ${Object.keys(report.checks).length}개 (경기 ${games.length}, 선수 ${players.length}, 농구경기 ${bk.length})`);

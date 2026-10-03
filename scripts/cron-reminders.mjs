// Phase 4B cron — 매 */5 min UTC 실행(2026-09-19부터, 기존 15분 → 지연 완화), 발송 윈도우
// 도달한 (game, lead) 쌍을 FCM 토픽으로 push.
//
// 로직:
//   for each scheduled, non-TBD game g:
//     S = Date.parse(`${g.date}T${g.time}:00+09:00`)   // KST 고정 (DST 없음)
//     if (now >= S) skip                                 // 이미 시작
//     for L of [1,3,6,12,24]:
//       key = `${g.gameId}_h${L}`
//       if (sent[key]) skip                              // 이미 발송
//       if (now < S - L*3600000) skip                    // 윈도우 미도달
//       sendGame(g.gameId, L, {...})                     // → game_<id>_h<L>
//       sent[key] = ISO timestamp
//
// 가드:
//   - status !== 'scheduled' → skip
//   - timeTbd → skip
//   - 중복 gameId (예: K1_1 데이터 이슈) → 첫 occurrence만 처리, 두 번째는 warn + skip
//   - 알 수 없는 league → 기본 이모지
//
// 출력: sent-reminders.json (repo 커밋). 워크플로가 변경 있으면 push.
// 정리: 게임 시작 24h 지난 sent 엔트리는 자동 삭제 (파일 크기 관리).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendGame, sendGameLang } from './send-reminders.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const SENT_FILE = path.join(REPO_ROOT, 'sent-reminders.json');
const BK_GAMES_FILE = path.join(REPO_ROOT, 'basketball', 'games.json');
const BK_TEAMS_FILE = path.join(REPO_ROOT, 'basketball', 'teams.json');
const BK_VENUE_EN_FILE = path.join(REPO_ROOT, 'basketball', 'venue-name-en.json');
const BK_TEAM_I18N_FILE = path.join(REPO_ROOT, 'basketball', 'team-i18n.json');
const BK_VENUE_I18N_FILE = path.join(REPO_ROOT, 'basketball', 'venue-i18n.json');
const BK_TEAM_EN_FILE = path.join(REPO_ROOT, 'basketball', 'team-name-en.json');
const LEAD_PHRASE = {
  ko: (L) => `${L}시간 전`, en: (L) => `Tip-off in ${L}h`, ja: (L) => `試合${L}時間前`, es: (L) => `Faltan ${L} h`, pt: (L) => `Faltam ${L} h`,
  fr: (L) => `Dans ${L} h`, de: (L) => `In ${L} Std.`, it: (L) => `Tra ${L} h`, ru: (L) => `Через ${L} ч`, ar: (L) => `بعد ${L} ساعات`,
  id: (L) => `${L} jam lagi`, th: (L) => `อีก ${L} ชม.`, vi: (L) => `Còn ${L} giờ`, 'zh-Hans': (L) => `${L}小时后开赛`, 'zh-Hant': (L) => `${L}小時後開賽`,
  hi: (L) => `${L} घंटे बाद`, tr: (L) => `${L} saat sonra`, nl: (L) => `Over ${L} uur`,
};

const LEAD_HOURS = [1, 3, 6, 12, 24];
const SPORT_ICON = { KBO: '⚾', 'K리그1': '⚽', 'K리그2': '⚽' };
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

function startMs(date, time) {
  // KST = UTC+9, 한국은 DST 없음.
  return Date.parse(`${date}T${time}:00+09:00`);
}

async function loadJson(file, fallback) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function buildContent(g, leadHours) {
  const icon = SPORT_ICON[g.league] ?? '🏟️';
  const dh = g.doubleheaderNum ? ` (${g.doubleheaderNum}차전)` : '';
  const stadium = g.stadium ? ` · ${g.stadium}` : '';
  // 발송일(=오늘 KST) ≠ 경기일이면 본문에 경기 날짜 명시. 같은 날(예: 1·3·6·12h) 은 생략.
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const sendDate = `${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, '0')}-${String(nowKst.getUTCDate()).padStart(2, '0')}`;
  let dateLabel = '';
  if (g.date !== sendDate) {
    const [yy, mm, dd] = g.date.split('-').map(Number);
    const wd = WEEKDAYS_KO[new Date(yy, mm - 1, dd).getDay()];
    dateLabel = `${mm}/${dd}(${wd}) `;
  }
  return {
    title: `${icon} ${g.away} vs ${g.home}${stadium}`,
    body: `${leadHours}시간 전 · ${dateLabel}${g.time} 경기${dh} · 그늘·날씨 확인`,
  };
}

async function main() {
  const games = await loadJson(GAMES_FILE, []);
  const sent = await loadJson(SENT_FILE, {});
  const now = Date.now();

  if (!Array.isArray(games) || games.length === 0) {
    console.error('[reminders] games.json empty/invalid');
    process.exit(1);
  }

  const seenGameIds = new Set();
  const sends = [];

  for (const g of games) {
    if (g.status !== 'scheduled') continue;
    if (g.timeTbd) continue;
    if (!g.gameId) continue;
    if (seenGameIds.has(g.gameId)) {
      console.warn(`[reminders] dup gameId, skip 2nd: ${g.gameId} ${g.date} ${g.away}@${g.home}`);
      continue;
    }
    seenGameIds.add(g.gameId);

    const S = startMs(g.date, g.time);
    if (Number.isNaN(S)) {
      console.warn(`[reminders] invalid datetime: ${g.gameId} ${g.date} ${g.time}`);
      continue;
    }
    if (now >= S) continue;

    for (const L of LEAD_HOURS) {
      const key = `${g.gameId}_h${L}`;
      if (sent[key]) continue;
      if (now < S - L * 3600000) continue;
      sends.push({ g, L, key });
    }
  }

  // 농구(2026-10-03): 앱에서 경기 ⭐ 누르면 game_<id>_h6 토픽 구독 — basketball/games.json 의 예정 경기도 같은 방식으로 발송.
  const bkStart = new Map();
  try {
    const bkRaw = await loadJson(BK_GAMES_FILE, {});
    const bkTeams = await loadJson(BK_TEAMS_FILE, {});
    const bkTm = bkTeams;
    const bkVen = await loadJson(BK_VENUE_EN_FILE, {});
    const bkTi = await loadJson(BK_TEAM_I18N_FILE, {});
    const bkVi = await loadJson(BK_VENUE_I18N_FILE, {});
    const bkTe = await loadJson(BK_TEAM_EN_FILE, {});
    const lk = (lang) => lang.toLowerCase();
    const tnL = (lang, k) => (lang === 'ko' ? tn(k) : bkTi[k]?.[lk(lang)] || bkTe['bk:' + k] || bkTm[k]?.en || tn(k));
    const vnL = (lang, g) => (lang === 'ko' ? g.venue || bkVen[g.vid]?.name : bkVi[g.vid]?.[lk(lang)] || bkVen[g.vid]?.name || g.venue);
    const tn = (k) => { const tm = bkTeams[k]; return tm?.ko || tm?.en || tm?.name || String(k).split(':').pop(); };
    for (const g of bkRaw.games || []) {
      if (!g.id || !g.t) continue;
      bkStart.set(g.id, g.t);
      if (g.st !== 'scheduled' || now >= g.t) continue;
      if (seenGameIds.has(g.id)) continue;
      seenGameIds.add(g.id);
      for (const L of LEAD_HOURS) {
        const key = `${g.id}_h${L}`;
        if (sent[key]) continue;
        if (now < g.t - L * 3600000) continue;
        const kst = new Date(g.t + 9 * 3600 * 1000);
        const hhmm = `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
        const ymd = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
        const nowKst = new Date(now + 9 * 3600 * 1000);
        const sendYmd = `${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, '0')}-${String(nowKst.getUTCDate()).padStart(2, '0')}`;
        const dl = ymd !== sendYmd ? `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}(${WEEKDAYS_KO[kst.getUTCDay()]}) ` : '';
        const venue = g.venue || bkVen[g.vid]?.name;
        sends.push({
          g: { gameId: g.id, venueId: g.vid || '', date: ymd },
          L,
          key,
          content: { title: `🏀 ${tn(g.a.k)} vs ${tn(g.h.k)}${venue ? ` · ${venue}` : ''}`, body: `${L}시간 전 · ${dl}${hhmm} 경기` },
          byLang: Object.fromEntries(Object.keys(LEAD_PHRASE).map((lang) => {
            const vn = vnL(lang, g);
            const dlL = ymd !== sendYmd ? `${kst.getUTCMonth() + 1}/${kst.getUTCDate()} ` : '';
            return [lang, lang === 'ko'
              ? { title: `🏀 ${tn(g.a.k)} vs ${tn(g.h.k)}${vn ? ` · ${vn}` : ''}`, body: `${L}시간 전 · ${dl}${hhmm} 경기` }
              : { title: `🏀 ${tnL(lang, g.a.k)} vs ${tnL(lang, g.h.k)}${vn ? ` · ${vn}` : ''}`, body: `${LEAD_PHRASE[lang](L)} · ${dlL}${hhmm} KST` }];
          })),
        });
      }
    }
  } catch (e) {
    console.error(`[reminders] basketball pass failed: ${e?.message ?? e}`);
  }

  // 발송
  let sentCount = 0;
  for (const s of sends) {
    const { title, body } = s.content || buildContent(s.g, s.L);
    try {
      const id = await sendGame(s.g.gameId, s.L, {
        title,
        body,
        venueId: s.g.venueId,
        date: s.g.date,
        doubleheaderNum: s.g.doubleheaderNum,
      });
      if (s.byLang) {
        for (const [lang, c] of Object.entries(s.byLang)) {
          try { await sendGameLang(s.g.gameId, s.L, lang, { title: c.title, body: c.body, venueId: s.g.venueId, date: s.g.date }); } catch (e) { console.error(`[reminders] lang ${lang} FAIL ${s.key}: ${e?.message ?? e}`); }
        }
      }
      sent[s.key] = new Date().toISOString();
      sentCount++;
      console.log(`[reminders] sent ${s.key} → ${id}`);
    } catch (e) {
      console.error(`[reminders] FAIL ${s.key}: ${e?.message ?? e}`);
    }
  }

  // Cleanup: 24h+ 지난 게임의 sent 엔트리 제거 (파일 크기 관리).
  // gameId가 games 데이터에서 사라진 경우는 보존 (안전).
  const gameById = new Map(games.map((g) => [g.gameId, g]).filter(([k]) => k));
  let cleaned = 0;
  for (const key of Object.keys(sent)) {
    const gameId = key.slice(0, key.lastIndexOf('_h'));
    const g = gameById.get(gameId);
    const bkT = bkStart.get(gameId);
    if (bkT != null) {
      if (bkT + CLEANUP_AFTER_MS < now) { delete sent[key]; cleaned++; }
      continue;
    }
    if (!g || g.timeTbd) continue;
    const S = startMs(g.date, g.time);
    if (Number.isNaN(S)) continue;
    if (S + CLEANUP_AFTER_MS < now) {
      delete sent[key];
      cleaned++;
    }
  }

  await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 2) + '\n', 'utf8');
  console.log(`[reminders] sent=${sentCount} cleaned=${cleaned} total_state=${Object.keys(sent).length}`);
}

main().catch((err) => {
  console.error('[reminders] FATAL:', err);
  process.exit(1);
});

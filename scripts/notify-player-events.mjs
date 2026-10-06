// 즐겨찾기 선수 알림(2026-09-28) 감지+발송 cron. 5분 주기(cron-job.org 트리거).
//
// cron-reminders.mjs 와 동일 철학: "새 스냅샷 vs 이전 스냅샷 diff"가 아니라 "이미 보낸 키
// 집합에 없는 것만 보낸다" — 배열 인덱스를 dedup 키에 포함하므로 scorers 배열이 append-only로
// 유지된다는 가정에 의존(기존 enrichEuroAssists의 index-zip 방식과 동급 리스크, 수용됨).
//
// 1차: 축구 골(scorers[].n)/어시(scorers[].a)/카드(cards[].n). 2차(2026-09-28): 야구
// 하이라이트(highlights[].player — 홈런/도루/2루타/3루타/실책/병살타/결승타 등, how 필드
// 그대로 라벨로 사용 — 종류가 많아 축구처럼 kind별 하드코딩 대신 icon/label을 push 시점에
// 직접 계산). 3차(2026-09-29, "투수즐겨찾기했는데 선발투수 등록되면은 알람주는거추가해줘"):
// 경기 전 선발투수 발표(homePitcher/awayPitcher, KBO는 전날 밤~당일 확정) — 다른 이벤트와
// 달리 "경기가 이미 일어남"이 아니라 "앞으로 나올 예정"이라 스코어/득점 라인 대신
// 상대팀+경기 일시를 body에 넣음(아래 sendPreGame 분기).
//
// 서버는 누가 그 선수를 즐겨찾기했는지 모름 — 구독자 0인 토픽에 발송해도 FCM에서 무해한
// no-op이라, 매 경기의 모든 스코어러에 대해 그냥 다 발송한다(팀 리마인더와 동일 설계).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendPlayerEvent } from './send-player-alert.mjs';
import { canonicalPlayerName } from './player-name-canon.mjs';
import { LANGS, eventLabel, minuteLabel, localTeam, localPlayer, localLeague } from './push-i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GAMES_FILE = path.join(REPO_ROOT, 'games.json');
const SENT_FILE = path.join(REPO_ROOT, 'sent-player-alerts.json');

const CLEANUP_AFTER_DAYS = 14;

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function scoreLine(g) {
  if (typeof g.homeScore !== 'number' || typeof g.awayScore !== 'number') return '';
  return ` · ${g.away} ${g.awayScore}-${g.homeScore} ${g.home}`;
}

// 득점자 정정(이강인→손흥민) 시 새 이름으로 알람이 가도록 dedup 키 끝에 선수명 포함. 구키(이름 없음)는
// 발송 없이 신키로 이관 후 삭제(중복 알람 방지).
// 2026-10-01: 배열 인덱스 기반 키는 경기 종료 시 scorers/highlights가 재구성·재정렬되면 같은 이벤트가
// 새 키로 보여 알람이 한 번 더 감(사용자 리포트). 인덱스 대신 "같은 선수의 n번째 이벤트"로 키를 잡고,
// 구형 키(…:타입:인덱스:이름)는 같은 경기·편·타입·이름의 개수로 이관 판정.
function makeIsSent(sent) {
  const oldCount = {};
  for (const k of Object.keys(sent)) {
    const m = /^([^:]+):(home|away):(scorer|assist|card|highlight):\d+:(.+)$/.exec(k);
    if (m) { const kk = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`; oldCount[kk] = (oldCount[kk] || 0) + 1; }
  }
  return (gid, side, type, nm, n) => {
    const k = `${gid}:${side}:${type}:${nm}#${n}`;
    return { k, sent: !!sent[k] || (oldCount[`${gid}:${side}:${type}:${nm}`] || 0) >= n };
  };
}
const nth = (m, nm) => { const n = (m.get(nm) || 0) + 1; m.set(nm, n); return n; };

async function main() {
  const games = await loadJson(GAMES_FILE, []);
  const sent = await loadJson(SENT_FILE, {});
  if (!Array.isArray(games) || games.length === 0) {
    console.error('[player-alerts] games.json empty/invalid');
    process.exit(1);
  }

  const isSent = makeIsSent(sent);
  const pending = [];
  // 2026-09-30: 14일 정리로 sent 키가 지워진 옛 경기가 매번 미발송으로 재집계돼 수천 건을 순차 발송하다
  // 10분 타임아웃에 걸려 상태 저장 전에 취소되던 사고 — 최근 경기(어제~오늘 36시간 이내)만 대상으로 한정.
  const recentCutoff = Date.now() - 36 * 3600000;
  for (const g of games) {
    const gMs = Date.parse(`${g.date}T00:00:00+09:00`);
    if (!Number.isNaN(gMs) && gMs < recentCutoff) continue;
    if (!g.gameId || (!g.scorers && !g.cards && !g.highlights && !g.homePitcher && !g.awayPitcher && !g.liveState)) continue;
    const sides = [
      { key: 'home', team: g.home },
      { key: 'away', team: g.away },
    ];
    if (g.scorers) {
      for (const { key, team } of sides) {
        const list = g.scorers[key];
        if (!Array.isArray(list)) continue;
        const cntS = new Map(), cntA = new Map();
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          // 득점자(한글, 네이버원문)/어시스트(영문, ESPN원문)가 같은 선수여도 문자열이 갈라지는
          // 문제 발견(2026-09-28) — canonicalPlayerName으로 정규화해서 토픽을 계산해야 "손흥민"으로
          // 즐겨찾기한 사람이 어시스트("Son Heung-Min")에도 알림을 받음(build-player-index.mjs와
          // 동일 정규화 재사용, 두 스크립트가 다른 이름으로 정규화하면 다시 어긋나므로 반드시 동기화).
          if (s.n) {
            { const nm = canonicalPlayerName(s.n); const r = isSent(g.gameId, key, 'scorer', nm, nth(cntS, nm)); if (!r.sent) pending.push({ dedupKey: r.k, name: nm, pid: s.pid, game: g, team, icon: '⚽', label: '골', labelKey: 'goal', minute: s.m }); }
          }
          if (s.a) {
            { const nm = canonicalPlayerName(s.a); const r = isSent(g.gameId, key, 'assist', nm, nth(cntA, nm)); if (!r.sent) pending.push({ dedupKey: r.k, name: nm, pid: s.apid, game: g, team, icon: '🅰️', label: '어시스트', labelKey: 'assist', minute: s.m }); }
          }
        }
      }
    }
    // 카드(경고/퇴장) 알림(2026-09-28, 사용자 요청) — cards[].n도 리그마다 원문 언어가 달라
    // 골/어시와 동일하게 canonicalPlayerName으로 정규화.
    if (g.cards) {
      for (const { key, team } of sides) {
        const list = g.cards[key];
        if (!Array.isArray(list)) continue;
        const cntC = new Map();
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c.n) continue;
          const isRed = c.type === 'R';
          { const nm = canonicalPlayerName(c.n); const r = isSent(g.gameId, key, 'card', nm, nth(cntC, nm)); if (!r.sent) pending.push({ dedupKey: r.k, name: nm, pid: c.pid, game: g, team, icon: isRed ? '🟥' : '🟨', label: isRed ? '퇴장' : '경고', labelKey: isRed ? 'red' : 'yellow', minute: c.m }); }
        }
      }
    }
    // 야구 하이라이트(홈런/도루/2루타/3루타/실책/병살타/결승타 등, 2026-09-28 2차) — 전부
    // 네이버 원문(한글)이라 canonicalPlayerName(ESPN 영문 매칭용) 불필요. how 필드를 라벨로
    // 그대로 사용(종류가 많아 하드코딩 매핑 대신 원문 재사용). 야구는 아직 pid 미지원.
    if (g.highlights) {
      for (const { key, team } of sides) {
        const list = g.highlights[key];
        if (!Array.isArray(list)) continue;
        const cntH = new Map();
        for (let i = 0; i < list.length; i++) {
          const h = list[i];
          if (!h.player) continue;
          { const nm = h.player; const r = isSent(g.gameId, key, 'highlight', nm, nth(cntH, nm)); if (!r.sent) pending.push({ dedupKey: r.k, name: nm, pid: h.pid, game: g, team, icon: '⚾', label: h.how === '도루자' ? '도루 실패' : h.how, labelKey: undefined, detail: h.text }); }
        }
      }
    }
    // 선발투수 발표 알림(2026-09-29) — homePitcher/awayPitcher는 배열이 아니라 경기당 값 1개뿐이라
    // 인덱스 없이 side만으로 dedup(발표 후 변경되는 경우는 드물고, 바뀌어도 재알림보단 안전 우선).
    // 아직 pid 미지원(homePitcher/awayPitcher는 국적/pid enrichment 대상이 아님) — 이름으로만 매칭.
    for (const { key, team, opp } of [
      { key: 'home', team: g.home, opp: g.away },
      { key: 'away', team: g.away, opp: g.home },
    ]) {
      const name = key === 'home' ? g.homePitcher : g.awayPitcher;
      if (!name) continue;
      const dedupKey = `${g.gameId}:${key}:startingPitcher`;
      if (!sent[dedupKey]) pending.push({ dedupKey, name, pid: undefined, game: g, team, opp, icon: '⚾', label: '선발 등판', labelKey: 'sp', preGame: true });
    }
    // 구원 등판(2026-10-07): 진행중 경기 liveState.pitcher가 수비팀 선발이 아닌 새 투수로 바뀌면 1회 알림.
    // 1회 MLB/NPB는 첫 관측 투수를 선발로 기록해 교체만 감지. 선발과 이름/pid가 같으면 제외.
    if (g.status === 'live' && g.liveState?.pitcher && typeof g.inningInfo === 'string') {
      const m = /^(\d+)회(초|말)$/.exec(g.inningInfo);
      if (m) {
        const defSide = m[2] === '초' ? 'home' : 'away';
        const team = defSide === 'home' ? g.home : g.away, opp = defSide === 'home' ? g.away : g.home;
        const starter = defSide === 'home' ? g.homePitcher : g.awayPitcher;
        const nm = g.liveState.pitcher;
        const starterPid = defSide === 'home' ? g.homePitcherPid : g.awayPitcherPid;
        const same = (starter && (starter === nm || starter.includes(nm) || nm.includes(starter))) || (starterPid && starterPid === g.liveState.pitcherPid);
        const dedupKey = `${g.gameId}:${defSide}:relief:${nm}`;
        let skip = false;
        if (Number(m[1]) === 1 && g.league !== 'KBO') {
          // 1회 MLB/NPB: 선발 표기 불일치 오탐 방지 — 처음 본 투수는 선발로 기록만 하고, 이후 다른 투수가 보이면 교체로 판단.
          const p0 = `${g.gameId}:${defSide}:p0:`;
          const first = Object.keys(sent).find((k) => k.startsWith(p0));
          if (!first) { sent[p0 + nm] = new Date().toISOString(); skip = true; }
          else if (first === p0 + nm) skip = true;
        }
        if (!skip && !same && !sent[dedupKey]) pending.push({ dedupKey, name: nm, pid: g.liveState.pitcherPid, game: g, team, opp, icon: '⚾', label: '구원 등판', labelKey: 'rp' });
      }
    }
  }

  let sentCount = 0;
  for (const item of pending) {
    const { dedupKey, name, pid, game: g, team, opp, icon, label, minute, preGame, detail } = item;
    const byLang = {};
    for (const lang of LANGS) {
      const nm = localPlayer(lang, name, pid);
      const lb = item.labelKey ? eventLabel(lang, null, item.labelKey) : eventLabel(lang, label === '도루 실패' ? '도루자' : label);
      const tm = localTeam(lang, team), op = localTeam(lang, opp), lg = localLeague(lang, g.league);
      const sc = typeof g.homeScore === 'number' && typeof g.awayScore === 'number' ? `${localTeam(lang, g.away)} ${g.awayScore}-${g.homeScore} ${localTeam(lang, g.home)}` : '';
      const ctx = [lg, g.inningInfo].filter(Boolean).join(' · ');
      byLang[lang] = {
        title: `${icon} ${nm} ${lb}!`,
        body: preGame
          ? `${tm} vs ${op} · ${g.date} ${g.time}${lg ? ' · ' + lg : ''}`
          : [`${tm}${minuteLabel(lang, minute)}${ctx ? ' · ' + ctx : ''}`, sc, lang === 'ko' ? detail : ''].filter(Boolean).join('\n'),
      };
    }
    const { title, body } = byLang.ko;
    // 동명이인 구분용 고유ID가 있으면 그 ID 전용 토픽으로도 보냄(정확한 매칭) — 이름 토픽도
    // 항상 같이 보내서 이 기능이 ID 도입 전부터 "이름"으로 즐겨찾기해둔 기존 구독이 계속
    // 작동하게 함(2026-09-28, 무마이그레이션 하위호환). ID가 없으면(아직 못 붙인 소스) 기존과
    // 완전히 동일하게 이름 토픽 1건만.
    const targets = pid && pid !== name ? [pid, name] : [name];
    let anyOk = false;
    for (const target of targets) {
      try {
        await sendPlayerEvent(target, { title, body, gameId: g.gameId, displayName: name, byLang });
        anyOk = true;
      } catch (e) {
        console.error(`[player-alerts] FAIL ${dedupKey} (${target}): ${e?.message ?? e}`);
      }
    }
    if (anyOk) {
      sent[dedupKey] = new Date().toISOString();
      sentCount++;
      if (sentCount % 20 === 0) await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 2) + '\n', 'utf8');
    }
  }

  // Cleanup: games.json에서 사라졌거나 오래된(14일+) 경기의 sent 엔트리 제거.
  const gameById = new Map(games.map((g) => [g.gameId, g]).filter(([k]) => k));
  const now = Date.now();
  let cleaned = 0;
  for (const key of Object.keys(sent)) {
    const gameId = key.split(':')[0];
    const g = gameById.get(gameId);
    if (!g) continue; // 데이터에서 사라진 경우는 보존(안전) — 리마인더와 동일 방침.
    const gameMs = Date.parse(`${g.date}T00:00:00+09:00`);
    if (!Number.isNaN(gameMs) && now - gameMs > CLEANUP_AFTER_DAYS * 24 * 3600000) {
      delete sent[key];
      cleaned++;
    }
  }

  await fs.writeFile(SENT_FILE, JSON.stringify(sent, null, 2) + '\n', 'utf8');
  console.log(`[player-alerts] sent=${sentCount} cleaned=${cleaned} total_state=${Object.keys(sent).length}`);
}

main().catch((err) => {
  console.error('[player-alerts] FATAL:', err);
  process.exit(1);
});

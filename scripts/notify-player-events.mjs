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
import { fnv1a32 } from './topic.mjs';
import { canonicalPlayerName } from './player-name-canon.mjs';
import { LANGS, eventLabel, minuteLabel, localTeam, flagTeam, localPlayer, localLeague } from './push-i18n.mjs';

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
  for (const k of Object.keys(sent)) if (k.includes(':cand:') && Date.now() - Date.parse(sent[k]) > 6 * 3600e3) delete sent[k]; // 구원 등판 확인용 임시 기록 정리
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
        const cntS = new Map(), cntA = new Map(), cntARaw = new Map();
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
            // 2026-10-16: 정규화 사전이 넓어져(영문 표기 변형 추가) 예전엔 영문 그대로였던 이름이 한글로 바뀐다 — 영문 이름 키로 이미 보낸 알림이면 다시 보내지 않는다.
            { const nm = canonicalPlayerName(s.a); const r = isSent(g.gameId, key, 'assist', nm, nth(cntA, nm)); const rawN = nth(cntARaw, s.a); if (!r.sent && nm !== s.a && sent[`${g.gameId}:${key}:assist:${s.a}#${rawN}`]) r.sent = true; if (!r.sent) pending.push({ dedupKey: r.k, name: nm, pid: s.apid, game: g, team, icon: '🅰️', label: '어시스트', labelKey: 'assist', minute: s.m }); }
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
        const cntC = new Map(), cntCRaw = new Map();
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c.n) continue;
          const isRed = c.type === 'R';
          { const nm = canonicalPlayerName(c.n); const r = isSent(g.gameId, key, 'card', nm, nth(cntC, nm)); const rawN = nth(cntCRaw, c.n); if (!r.sent && nm !== c.n && sent[`${g.gameId}:${key}:card:${c.n}#${rawN}`]) r.sent = true; if (!r.sent) pending.push({ dedupKey: r.k, name: nm, pid: c.pid, game: g, team, icon: isRed ? '🟥' : '🟨', label: isRed ? '퇴장' : '경고', labelKey: isRed ? 'red' : 'yellow', minute: c.m }); }
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
        // 2026-10-07: 키를 (선수, 종류)별 n번째로 — 이름만으로 세면 경기 종료 후 최종본(결승타+홈런 순)이 라이브
        // 누적본(홈런)과 순서가 달라 같은 홈런이 한 번 더 알림("오스틴 홈런" 경기 끝나고 재발송). 구형 키(이름#n)는
        // 이름 기준 개수로 이관 판정(구키가 있는 옛 경기만 해당).
        const cntH = new Map(), cntOld = new Map();
        const hrOf = new Set(list.filter((x) => x.how === '홈런' && x.player).map((x) => x.player));
        for (let i = 0; i < list.length; i++) {
          const h = list[i];
          if (!h.player) continue;
          // 주자·타자가 폭투/포일/보크/실책으로 진루한 줄은 이름이 진루한 선수다 — "박해민 폭투"로 알리면 박해민이 폭투를 던진 것처럼 읽힌다(2026-10-14).
          // 그래서 원문 그대로 "박해민 폭투로 2루까지 진루"로 알린다(advance). 다른 언어는 "진루(폭투)" 형태.
          const advance = !!(h.advance || /(폭투|포일|보크|실책).*(진루|출루)/.test(h.text || ''));
          const nm = h.player;
          const oldN = nth(cntOld, nm);
          // 결승타가 홈런이면 같은 타구의 홈런 항목과 중복 — 홈런 알림만.
          if (h.how === '결승타' && /홈런/.test(h.text || '') && hrOf.has(nm)) continue;
          // 중복 방지 키는 예전 그대로(이름|종류) — 키를 바꾸면(|adv) 이미 보낸 이벤트가 새 키로 인식돼 전부 재발송된다(2026-10-14 12:41 실제로 3건 재발송).
          const r = isSent(g.gameId, key, 'highlight', `${nm}|${h.how}`, nth(cntH, `${nm}|${h.how}`));
          const legacy = isSent(g.gameId, key, 'highlight', nm, oldN);
          if (!r.sent && !legacy.sent) pending.push({ dedupKey: r.k, name: nm, pid: h.pid, game: g, team, icon: '⚾', label: h.how === '도루자' ? '도루 실패' : h.how, labelKey: undefined, detail: h.text, advance, inn: h.inn });
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
      // 2026-10-17 "임찬규 선발인데 알람 안온듯" — 이름 토픽으로만 보내서, 선수 화면에서 pid로 즐겨찾기한 사람(토픽=pid)은 선발 알림을 못 받았다.
      // 선발 pid가 있으면 그 pid 토픽으로도 보낸다. KBO는 같은 사람이 투수(kbo:p:)·타자(kbo:b:) 두 id로 색인돼 있어 짝 id 토픽에도 보낸다.
      const spPid = key === 'home' ? g.homePitcherPid : g.awayPitcherPid;
      const altPids = typeof spPid === 'string' ? [spPid.replace(/^kbo:([bp]):/, (_, c) => `kbo:${c === 'b' ? 'p' : 'b'}:`)].filter((x) => x !== spPid) : [];
      if (!sent[dedupKey]) pending.push({ dedupKey, name, pid: spPid || undefined, altPids, game: g, team, opp, icon: '⚾', label: '선발 등판', labelKey: 'sp', preGame: true });
    }
    // 구원 등판(2026-10-07): 진행중 경기 liveState.pitcher가 수비팀 선발이 아닌 새 투수로 바뀌면 1회 알림.
    // 1회 MLB/NPB는 첫 관측 투수를 선발로 기록해 교체만 감지. 선발과 이름/pid가 같으면 제외.
    if (g.status === 'live' && g.liveState?.pitcher && !g.liveState.inningBreak && typeof g.inningInfo === 'string') {
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
        // 이닝 전환 직후 중계의 현재 투수는 직전 이닝 반대편 투수로 남아 있을 수 있다(2026-10-12 "양현종 선발 아님?" — KIA(홈) 선발 양현종이 1회말 시작 순간
        // 원정팀 LG 의 '구원 등판'으로 알림). 그 투수가 반대편 팀 선발이면 구원이 아니다.
        const oppStarter = defSide === 'home' ? g.awayPitcher : g.homePitcher;
        const oppStarterPid = defSide === 'home' ? g.awayPitcherPid : g.homePitcherPid;
        const isOppStarter = (oppStarter && (oppStarter === nm || oppStarter.includes(nm) || nm.includes(oppStarter))) || (oppStarterPid && oppStarterPid === g.liveState.pitcherPid);
        if (isOppStarter) skip = true;
        if (Number(m[1]) === 1 && g.league !== 'KBO') {
          // 1회 MLB/NPB: 선발 표기 불일치 오탐 방지 — 처음 본 투수는 선발로 기록만 하고, 이후 다른 투수가 보이면 교체로 판단.
          const p0 = `${g.gameId}:${defSide}:p0:`;
          const first = Object.keys(sent).find((k) => k.startsWith(p0));
          if (!first) { sent[p0 + nm] = new Date().toISOString(); skip = true; }
          else if (first === p0 + nm) skip = true;
        }
        // 반대편 구원투수가 전환 직후 남아 있는 경우까지 막기 위해 같은 (경기·수비측·투수·이닝)이 이후 실행에서 한 번 더 관측될 때만 알린다(첫 관측은 기록만).
        if (!skip && !same && !sent[dedupKey]) {
          const candKey = `${g.gameId}:${defSide}:cand:${nm}:${g.inningInfo}`;
          if (!sent[candKey]) sent[candKey] = new Date().toISOString();
          else if (Date.now() - Date.parse(sent[candKey]) >= 30000) pending.push({ dedupKey, name: nm, pid: g.liveState.pitcherPid, game: g, team, opp, icon: '⚾', label: '구원 등판', labelKey: 'rp' });
        }
      }
    }
  }

  let sentCount = 0;
  for (const item of pending) {
    const { dedupKey, name, pid, game: g, team, opp, icon, label, minute, preGame, detail } = item;
    const byLang = {};
    for (const lang of LANGS) {
      const nm = localPlayer(lang, name, pid);
      let lb = item.labelKey ? eventLabel(lang, null, item.labelKey) : eventLabel(lang, label === '도루 실패' ? '도루자' : label);
      // 진루 알림: 한국어는 원문("폭투로 2루까지 진루"), 그 외 언어는 "진루(폭투)".
      if (item.advance) lb = lang === 'ko' ? (detail || '').replace(name, '').trim() || eventLabel(lang, null, 'adv') : `${eventLabel(lang, null, 'adv')} (${lb})`;
      const tm = flagTeam(lang, team, g.league), op = flagTeam(lang, opp, g.league), lg = localLeague(lang, g.league);
      const sc = typeof g.homeScore === 'number' && typeof g.awayScore === 'number' ? `${flagTeam(lang, g.away, g.league)} ${g.awayScore}-${g.homeScore} ${flagTeam(lang, g.home, g.league)}` : '';
      // 하이라이트 알림은 그 이벤트가 난 이닝(h.inn)을 쓴다 — 현재 이닝(g.inningInfo)을 쓰면 7회말 사건이 "8회말"로 알려진다.
      const ctx = [lg, item.inn || g.inningInfo].filter(Boolean).join(' · ');
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
    // KBO 는 같은 사람이 타자(kbo:b:N)·투수(kbo:p:N) 두 id 로 색인돼 있어, 어느 쪽으로 즐겨찾기했든 모든 이벤트(홈런·승리투수·선발 등)를 받도록 짝 id 토픽에도 보낸다(2026-10-26 선수단 중복 표기 점검에서 보강).
    const pairPid = typeof pid === 'string' && /^kbo:[bp]:/.test(pid) ? pid.replace(/^kbo:([bp]):/, (_, c) => `kbo:${c === 'b' ? 'p' : 'b'}:`) : null;
    const targets = [...new Set([pid && pid !== name ? pid : null, pairPid, ...(item.altPids || []), name].filter(Boolean))];
    let anyOk = false;
    for (const target of targets) {
      try {
        // 같은 이벤트의 알림은 tag 로 한 기기에서 하나로 합친다(2026-10-12 "아직 와" — 기기에 예전 언어 구독이 남아 있으면 한 이벤트가 5개 언어로 따로 쌓였다. tag 가 없었다).
        // dedupKey 에서 만든 같은 tag 면 안드로이드가 기존 알림을 교체하고 iOS 는 collapse-id 로 합친다. 선수 ID 토픽과 이름 토픽에서 둘 다 와도 한 개.
        await sendPlayerEvent(target, { title, body, gameId: g.gameId, displayName: name, byLang, tag: 'pe_' + fnv1a32(dedupKey), nav: { venueId: g.venueId, date: g.date, doubleheaderNum: g.doubleheaderNum } });
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

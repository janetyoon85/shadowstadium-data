// 농구 박스스코어(선수 기록) 원본 대조 — 순수 함수 모음(verify-against-source.mjs 가 호출, 테스트 대상).
// 박스스코어 형태(basketball/box-YYYY-MM.json): { ls:{h:[쿼터별],a:[]}, tm:{h,a}, pl:{h:[{pid,n,min,pts,reb,ast,stl,blk,to,pf,fg:[made,att],tp,ft}], a:[]} }
// 앱이 실제로 보여주는 항목은 min·pts·reb·ast·stl·blk·to·pm 이므로 비교도 이 항목(+pf)에 한정한다 — FG/3P 시도수는 네이버가 선수별 fgA 를 성공수와 같게 내려주는 등
// 제공처 자체가 불안정하고 앱에도 안 쓰여서, 알림 소음을 피하려고 대조하지 않는다.
const STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'to'];
const STAT_LABEL = { pts: '득점', reb: '리바운드', ast: '어시스트', stl: '스틸', blk: '블록', to: '턴오버', pf: '파울' };

// ── ① 내부 정합성(독립 원본 없이도 되는 규칙; ESPN·네이버·B.LEAGUE·아시안게임 전부) ──────────────────
// game: { id, lg, src, date, h:{s}, a:{s} }, box: 위 형태. ESPN·네이버·B.LEAGUE 는 선수 필드골 구성으로도 득점을 검산한다(아시안게임 PDF 파싱·3x3 은 열 구성이 달라 제외).
export function boxInternalCheck(game, box, label = `${game.date} ${game.lg} ${game.id}`) {
  const out = [];
  if (!box || !box.pl) return out;
  for (const s of ['h', 'a']) {
    const rows = box.pl[s] || [];
    if (!rows.length) continue;
    const sum = rows.reduce((a, p) => a + (Number.isFinite(p.pts) ? p.pts : 0), 0);
    if (Number.isFinite(game[s]?.s) && sum !== game[s].s) out.push({ key: `sum|${s}`, kind: '농구 박스스코어 득점 합계 불일치', text: `${label} — ${s === 'h' ? '홈' : '원정'} 선수 득점 합 ${sum} / 경기 점수 ${game[s].s} (선수 ${rows.length}명)` });
    if (/^(espn|naver|bl|el)$/.test(game.src)) {
      for (const p of rows) {
        if (!Array.isArray(p.fg) || !Array.isArray(p.tp) || !Array.isArray(p.ft)) continue;
        // 시도수가 성공수보다 적거나, 빗나간 3점(3점시도−3점성공)이 빗나간 필드골 전체(FGA−FGM)보다 많으면 불가능한 기록(네이버가 fgA 를 성공수로 내려주던 오류가 이 규칙으로 잡힌다)
        if (p.fg[1] < p.fg[0] || p.fg[1] - p.fg[0] < p.tp[1] - p.tp[0] || p.ft[1] < p.ft[0]) out.push({ key: `shot|${p.pid || p.n}`, kind: '농구 선수 슛 기록 모순', text: `${label} — ${p.n} FG ${p.fg[0]}/${p.fg[1]}, 3P ${p.tp[0]}/${p.tp[1]}, FT ${p.ft[0]}/${p.ft[1]}` });
        const calc = 2 * p.fg[0] + p.tp[0] + p.ft[0];
        if (Number.isFinite(p.pts) && calc !== p.pts) out.push({ key: `pl|${p.pid || p.n}`, kind: '농구 선수 득점 구성 불일치', text: `${label} — ${p.n} 득점 ${p.pts} / 필드골·3점·자유투로 계산 ${calc}` });
      }
    }
  }
  // 쿼터별 점수 합 = 최종 점수. 일부 제공처(B.LEAGUE)는 연장 점수를 ls 에 안 담으므로, 정규 4쿼터가 동점이면(=연장 진행) 건너뛴다.
  const sumLs = (x) => (Array.isArray(x) ? x.reduce((p, q) => p + q, 0) : NaN);
  const tiedAfterReg = box.ls && box.ls.h?.length === 4 && box.ls.a?.length === 4 && sumLs(box.ls.h) === sumLs(box.ls.a);
  for (const s of tiedAfterReg ? [] : ['h', 'a']) {
    const ls = box.ls?.[s];
    if (Array.isArray(ls) && ls.length >= 4 && ls.every(Number.isFinite) && Number.isFinite(game[s]?.s)) {
      const t = ls.reduce((a, b) => a + b, 0);
      if (t !== game[s].s) out.push({ key: `ls|${s}`, kind: '농구 쿼터 점수 합 불일치', text: `${label} — ${s === 'h' ? '홈' : '원정'} 쿼터 합 ${t} / 최종 ${game[s].s}` });
    }
  }
  return out;
}

// ── ② 새로 받은 같은 제공처 박스스코어와 비교(우리가 오래된 값/부분 값을 쥐고 있는지) ────────────────
// fresh: 같은 형태(parseEspnBox / parseNaverBox 결과). 선수는 pid 끝 id 로 맞춘다. 팀당 선수 수·합계도 비교.
const pidTail = (pid) => String(pid || '').split(':').pop();
export function compareBoxFresh(game, ours, fresh, label = `${game.date} ${game.lg} ${game.id}`) {
  const out = [];
  if (!ours?.pl || !fresh?.pl) return out;
  for (const s of ['h', 'a']) {
    const o = ours.pl[s] || [], f = fresh.pl[s] || [];
    if (!f.length) continue;
    if (o.length !== f.length) out.push({ key: `n|${s}`, kind: '농구 박스스코어 선수 수 불일치', text: `${label} — ${s === 'h' ? '홈' : '원정'} 우리 ${o.length}명 / 원본 ${f.length}명` });
    const fm = new Map(f.map((p) => [pidTail(p.pid), p]));
    for (const p of o) {
      const q = fm.get(pidTail(p.pid));
      if (!q) continue;
      const diffs = [...STAT_KEYS, 'pf'].filter((k) => Number.isFinite(p[k]) && Number.isFinite(q[k]) && p[k] !== q[k]).map((k) => `${STAT_LABEL[k]} ${p[k]}→${q[k]}`);
      if (diffs.length) out.push({ key: `pl|${s}|${pidTail(p.pid)}`, kind: '농구 선수 기록 불일치', text: `${label} — ${p.n}: ${diffs.join(', ')} (우리→원본)` });
    }
  }
  return out;
}

// ESPN summary JSON → 박스스코어 형태(선수는 pid 대신 athlete id 만 필요). homeTeamId: 우리 경기의 홈팀 ESPN id.
export function parseEspnBox(summary, homeTeamId) {
  const b = summary?.boxscore;
  if (!b) return null;
  const pl = { h: [], a: [] };
  for (const t of b.players || []) {
    const side = String(t.team?.id) === String(homeTeamId) ? 'h' : 'a';
    const grp = t.statistics?.[0];
    if (!grp) continue;
    const idx = Object.fromEntries((grp.keys || []).map((k, i) => [k, i]));
    const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : undefined; };
    for (const a of grp.athletes || []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const s = a.stats;
      pl[side].push({ pid: `espn:${a.athlete.id}`, n: a.athlete.displayName, pts: n(s[idx.points]), reb: n(s[idx.rebounds]), ast: n(s[idx.assists]), stl: n(s[idx.steals]), blk: n(s[idx.blocks]), to: n(s[idx.turnovers]), pf: n(s[idx.fouls]) });
    }
  }
  return { pl };
}

// 네이버 /record recordData → 박스스코어 형태. 출전(playTimeSec>0 또는 득점) 선수만 — 크롤러(naverDetail)와 같은 기준.
export function parseNaverBox(rec) {
  if (!rec) return null;
  const pl = {};
  for (const [s, side] of [['h', 'home'], ['a', 'away']]) {
    pl[s] = (rec[`${side}PlayerStats`] || []).filter((p) => p.playTimeSec > 0 || p.scoreTot > 0).map((p) => ({ pid: `naver:${p.playerId}`, n: p.playerName, pts: p.scoreTot, reb: p.reboundTot, ast: p.as, stl: p.st, blk: p.bs, to: p.to, pf: p.foulTot }));
  }
  return { pl };
}

// ── ③ NBA: 네이버(독립) ↔ ESPN 선수 기록. 선수 이름이 한글/영문이라 이름 없이 "팀별 득점 분포(정렬한 득점 배열)"와 합계로 비교한다 ───
// ourEspn: 우리(ESPN 출처) 박스, naver: parseNaverBox 결과. sides: 우리 홈/원정 ↔ 네이버 홈/원정이 뒤집혔으면 flip=true.
export function compareNbaNaverVsOurs(game, ours, naver, flip = false, label = `${game.date} ${game.lg} ${game.id}`) {
  const out = [];
  if (!ours?.pl || !naver?.pl) return out;
  for (const s of ['h', 'a']) {
    const ns = flip ? (s === 'h' ? 'a' : 'h') : s;
    const o = (ours.pl[s] || []).map((p) => p.pts).filter(Number.isFinite).sort((a, b) => b - a);
    const n = (naver.pl[ns] || []).map((p) => p.pts).filter(Number.isFinite).sort((a, b) => b - a);
    if (!n.length) continue;
    // 0점 선수는 출전 판정 기준 차이로 갈릴 수 있어 득점자(>0)만 비교한다.
    const oo = o.filter((x) => x > 0), nn = n.filter((x) => x > 0);
    if (oo.join(',') !== nn.join(',')) out.push({ key: `pts|${s}`, kind: '농구 NBA 선수 득점 분포 불일치(네이버/ESPN)', text: `${label} — ${s === 'h' ? '홈' : '원정'} 우리(ESPN) [${oo.slice(0, 8).join(',')}] / 네이버 [${nn.slice(0, 8).join(',')}]` });
  }
  return out;
}

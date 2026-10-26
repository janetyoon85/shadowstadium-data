// 유로리그 공식 API(api-live.euroleague.net) 공용 — 농구 크롤러(fetch-basketball.mjs)와 통계(fetch-basketball-stats.mjs)가 같이 쓴다.
// ESPN 은 유로리그 경기를 제공하지 않아(2026-10-26 확인) 일정·박스스코어·순위·통계 전부 공식 API 로 받는다.
export const EL_SEASON = process.env.EUROLEAGUE_SEASON || 'E2026';
export const EL_API = 'https://api-live.euroleague.net';
// 공식 클럽 코드 → 이미 등록된 ESPN 유로리그 팀 id(번역·로고 데이터가 붙어 있어 같은 키를 재사용)
export const EL_TEAM = { BAR: 125618, PAR: 126416, OLY: 125614, PAM: 126418, BES: 133462, VIR: 126417, DUB: 133463, ASV: 125706, PRS: 130149, MUN: 125617, PAN: 125632, MAD: 125611, TEL: 125613, BAS: 125621, RED: 125633, MIL: 125615, IST: 125612, HTA: 132589, ZAL: 125610, ULK: 125631 };
export const elTeamKey = (code) => (EL_TEAM[code] ? `espn:EUROLEAGUE:${EL_TEAM[code]}` : null);
// "AYAYI, JOEL" → "Joel Ayayi" (Mc·로마숫자·아포스트로피·하이픈 처리)
export const elName = (raw) => {
  const [sur, giv] = String(raw || '').split(',').map((x) => x.trim());
  return String(giv ? giv + ' ' + sur : sur)
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
};

// ── 순수 파싱 함수(크롤러가 부르고 단위 테스트가 직접 검증) ─────────────────────────────
export const titleCase = (t) => String(t || '').toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
// 홈 클럽 연고 도시(주소에 도시가 없을 때 쓰는 보조값)
export const EL_HOME_CITY = { BAR: 'Barcelona', PAR: 'Belgrade', OLY: 'Piraeus', PAM: 'Valencia', BES: 'Istanbul', VIR: 'Bologna', DUB: 'Dubai', ASV: 'Villeurbanne', PRS: 'Paris', MUN: 'Munich', PAN: 'Athens', MAD: 'Madrid', TEL: 'Tel Aviv', BAS: 'Vitoria-Gasteiz', RED: 'Belgrade', MIL: 'Milan', IST: 'Istanbul', HTA: 'Tel Aviv', ZAL: 'Kaunas', ULK: 'Istanbul' };
// 이스라엘 팀의 임시 홈구장 — 주소 파싱이 안 되거나 연고지와 다른 곳
const EL_COUNTRY_WORD = /^(france|spain|italy|greece|serbia|germany|turkiye|turkey|bulgaria|lithuania|israel|united arab emirates|uae)$/i;
export const EL_VENUE_CITY = { AUF4: 'Belgrade', AVK1: 'Sofia', AVN2: 'Botevgrad' };

// 마지막으로 경기가 끝난 라운드(순위표 조회용)
export const elLastPlayedRound = (games) => Math.max(0, ...(games || []).filter((x) => x.played === true).map((x) => Number(x.round) || 0));

// v2 games 항목 1건 → 우리 경기 필드(팀 키 변환·구장 등록 같은 부수효과는 호출부). 날짜가 깨졌으면 null.
// 진행 중 판정: 킥오프 후 3.5시간 안 + 득점 > 0(공식 일정 응답에 별도 라이브 상태가 없어서). 쿼터는 득점이 잡힌 쿼터 수(Q1~Q4, 연장이면 OT).
export function parseElGame(x, now) {
  const t = Date.parse(x.utcDate);
  if (!Number.isFinite(t)) return null;
  const played = x.played === true;
  const hs = Number(x.local?.score), as = Number(x.road?.score);
  const live = !played && now >= t && now < t + 3.5 * 3600e3 && (hs > 0 || as > 0);
  const ls = (o) => { const p = o?.partials || {}; return [p.partials1, p.partials2, p.partials3, p.partials4, ...Object.values(p.extraPeriods || {})].filter(Number.isFinite); };
  const ot = Object.keys(x.local?.partials?.extraPeriods || {}).length;
  // 주소 끝 도시에서 "Paris, France"·"Belgrade - Serbia" 같은 국가 꼬리를 떼고, 주소에 도시가 없으면 홈 클럽 연고 도시로 채운다(중립경기는 비움).
  const rawCity = /\d{4,6},?\s+(.+)$/.exec(x.venue?.address || '')?.[1]?.trim();
  const rawFirst = rawCity ? rawCity.split(/\s+-\s+|,\s*/)[0].trim() : '';
  const cityOfAddr = EL_COUNTRY_WORD.test(rawFirst) ? '' : rawFirst; // 우편번호 뒤가 국가명뿐이면("…, 2140, Bulgaria") 도시가 아니다
  const city = EL_VENUE_CITY[x.venue?.code] || cityOfAddr || (x.isNeutralVenue ? undefined : EL_HOME_CITY[x.local?.club?.code]);
  const show = played || live;
  return {
    identifier: x.identifier, t, played, live,
    st: played ? 'final' : live ? 'live' : 'scheduled',
    per: played ? (ot ? 'Final/OT' : 'Final') : live ? (ot ? 'OT' : `Q${Math.min(4, Math.max(1, ls(x.local).filter((v) => v > 0).length || 1))}`) : undefined,
    h: { s: show ? hs : undefined, ls: show ? ls(x.local) : undefined }, a: { s: show ? as : undefined, ls: show ? ls(x.road) : undefined },
    localClub: x.local?.club, roadClub: x.road?.club,
    venueName: x.venue?.name ? titleCase(x.venue.name) : undefined, city,
    att: x.audienceConfirmed ? x.audience || undefined : undefined,
  };
}

// v2 rounds/{N}/standings 응답 → ESPN 순위표와 같은 행(k, rank, w, l, gp, pct, gb, pf, pa)
export function elStandingsRows(j) {
  const rows = j?.[0]?.standings;
  if (!rows?.length) return null;
  const lead = rows.find((r) => r.data.position === 1)?.data || rows[0].data;
  const out = [];
  for (const r of rows) {
    const k = elTeamKey(r.club.code);
    if (!k) continue;
    const d = r.data, gp = d.gamesWon + d.gamesLost;
    out.push({ k, rank: d.position, w: d.gamesWon, l: d.gamesLost, gp, pct: gp ? Math.round((d.gamesWon / gp) * 1000) / 1000 : 0, gb: String(((lead.gamesWon - d.gamesWon) + (d.gamesLost - lead.gamesLost)) / 2 || '-'), pf: String(d.pointsFavour), pa: String(d.pointsAgainst), ...(d.qualified ? { q: 1 } : {}) });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// v2 games/{code}/stats 응답 → 박스스코어 { tm, pl }. onPlayer(side, pid, name) 는 선수 색인 등록용 부수효과 콜백(선택).
export function elBoxFromStats(j, onPlayer) {
  if (!j?.local?.players?.length) return null;
  const mmss = (sec) => (Number.isFinite(sec) ? String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0') : undefined);
  const team = (o) => { const x = o?.total; return x && { pts: x.points, reb: x.totalRebounds, ast: x.assistances, stl: x.steals, blk: x.blocksFavour, to: x.turnovers, pf: x.foulsCommited, fg: [x.fieldGoalsMadeTotal, x.fieldGoalsAttemptedTotal], tp: [x.fieldGoalsMade3, x.fieldGoalsAttempted3], ft: [x.freeThrowsMade, x.freeThrowsAttempted] }; };
  const pl = (o, side) => (o.players || []).filter((p) => p.stats?.timePlayed > 0 || p.stats?.points > 0).map((p) => {
    const x = p.stats, pe = p.player.person, pid = `elbk:${pe.code}`, name = elName(pe.name);
    if (onPlayer) onPlayer(side, pid, name);
    return { pid, n: name, no: String(x.dorsal ?? p.player.dorsal ?? ''), pos: p.player.positionName, img: p.player.images?.headshot, min: mmss(x.timePlayed), pts: x.points, reb: x.totalRebounds, ast: x.assistances, stl: x.steals, blk: x.blocksFavour, to: x.turnovers, pf: x.foulsCommited, fg: [x.fieldGoalsMadeTotal, x.fieldGoalsAttemptedTotal], tp: [x.fieldGoalsMade3, x.fieldGoalsAttempted3], ft: [x.freeThrowsMade, x.freeThrowsAttempted], pm: Number.isFinite(x.plusMinus) ? (x.plusMinus > 0 ? '+' : '') + x.plusMinus : undefined, gs: x.startFive ? 1 : 0 };
  });
  return { tm: { h: team(j.local), a: team(j.road) }, pl: { h: pl(j.local, 'h'), a: pl(j.road, 'a') } };
}

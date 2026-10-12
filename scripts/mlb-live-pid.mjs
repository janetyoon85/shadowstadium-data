// 라이브 MLB 경기(네이버 소스)의 현재 투수 pid 를 MLB StatsAPI 로 확정한다(2026-10-12 "유리베 정보를 찾을 수 없어요").
// 네이버 중계는 투수를 성(한글)만 주고, 레지스트리·영문 성 매핑에 없는 구원투수는 pid 를 못 붙였다.
// StatsAPI linescore 의 현재 투수 id 를 쓰되, 틀린 사람이 붙는 것(교체 시점 지연)을 막기 위해
// 네이버가 준 투구수(pitchCount)와 StatsAPI 박스스코어의 투수 투구수가 일치할 때만 채택한다(아래 규칙).
// 네이버 pitchCount 가 없으면 검증 불가라 채택하지 않는다. 실패·불일치는 전부 undefined(= 기존 동작).
import { MLB_TEAM_ID, addDaysYmd } from './mlb-nationality.mjs';

const UA = { 'User-Agent': 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)' };
const cache = new Map(); // key → Promise (실행당 1회)

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function liveGameFor(homeId, awayId, dateYmd) {
  const key = `${homeId}|${awayId}|${dateYmd}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      // games.json 날짜는 KST, StatsAPI 는 ET 날짜 — 당일과 전날 둘 다 본다.
      for (const d of [dateYmd, addDaysYmd(dateYmd, -1)]) {
        const j = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${d}&hydrate=linescore`);
        for (const g of j?.dates?.[0]?.games || []) {
          if (g.teams?.home?.team?.id === homeId && g.teams?.away?.team?.id === awayId && g.status?.abstractGameState === 'Live') return g;
        }
      }
      return null;
    })());
  }
  return cache.get(key);
}

export async function mlbLivePitcherPid(homeKo, awayKo, dateYmd, naverPitchCount) {
  const homeId = MLB_TEAM_ID[homeKo];
  const awayId = MLB_TEAM_ID[awayKo];
  if (!homeId || !awayId || typeof naverPitchCount !== 'number') return undefined;
  const g = await liveGameFor(homeId, awayId, dateYmd);
  if (!g) return undefined;
  const box = await getJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
  if (!box) return undefined;
  const thrownOf = (pl) => pl?.stats?.pitching?.pitchesThrown ?? pl?.stats?.pitching?.numberOfPitches;
  // 네이버 중계가 교체를 늦게 반영하면 직전 투수의 최종 투구수가 그대로 온다 — 그 경우는 박스스코어 투수 중
  // 투구수가 정확히 같은 투수가 양 팀을 통틀어 하나뿐일 때만 그 투수로 확정한다(동수면 모호하므로 포기).
  const exact = [];
  for (const side of ['home', 'away']) {
    for (const pid of box.teams?.[side]?.pitchers || []) {
      if (thrownOf(box.teams[side].players?.[`ID${pid}`]) === naverPitchCount) exact.push(pid);
    }
  }
  if (exact.length === 1) return `mlb:${exact[0]}`;
  const cur = g.linescore?.defense?.pitcher?.id;
  const curThrown = thrownOf(box.teams?.home?.players?.[`ID${cur}`] || box.teams?.away?.players?.[`ID${cur}`]);
  if (cur && typeof curThrown === 'number' && Math.abs(curThrown - naverPitchCount) <= 2 && exact.length === 0) return `mlb:${cur}`;
  return undefined;
}

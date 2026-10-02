// 선수 사진 백필(2026-09-30, 사용자: "선수사진도 크롤러가 받아놓는게 나을듯") — 지금까지는
// 앱이 선수 카드를 열 때마다 직접 MLB/ESPN/TheSportsDB/KBO/NPB/K리그를 조회했음(App.tsx
// PlayerInfoModal). 저빈도(탭당 1회)라 당장 위험하진 않았지만, 팀 로고/경기장 사진과 같은
// "크롤러가 미리 받아서 고정 URL만 제공" 방식으로 통일 — 앱 쪽은 이후 별도로 정리 예정.
//
// players.json(build-player-index.mjs가 만드는 검색 인덱스, pid 있는 선수만 4,300여 명)을
// 순회하며 소스별로 사진을 확정:
// - MLB: personId로 URL 직접 조합(네트워크 호출 없음, 공식 CDN이라 거의 항상 존재).
// - ESPN 축구: ESPN athlete API(영문 displayName+생일)로 TheSportsDB 검색 후 생일 연도 대조,
//   실패 시 ESPN 자체 헤드샷 CDN(커버리지 낮음, 최후 폴백)으로 대체.
// - KBO: koreabaseball.com에서 영문 이름+생일+자체 사진(94x118, 저해상도) 추출 후 TheSportsDB로
//   고해상도 대체 시도, 실패 시 자체 사진 사용.
// - NPB: baseball.yahoo.co.jp 자체 사진 추출(이미 충분한 해상도 — 430x560 실측, TheSportsDB 불필요).
// - K리그: kleague.com 자체 사진 추출(이미 고해상도 — 1500x2000 실측, TheSportsDB 불필요).
//
// TheSportsDB 무료 공유키를 쓰는 호출(ESPN/KBO 케이스)만 2.2초 간격(팀로고/경기장사진과 동일
// 이유), 나머지 소스 자체 페이지 호출은 훨씬 짧은 간격으로 처리.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLAYERS_PATH = path.join(REPO_ROOT, 'players.json');
const PHOTOS_PATH = path.join(REPO_ROOT, 'player-photos.json');
const TRIED_PATH = path.join(REPO_ROOT, 'player-photos-tried.json');
const RETRY_NULL_DAYS = Number(process.env.PLAYER_PHOTO_RETRY_DAYS || 7);
const USER_AGENT = 'shadowstadium-crawler/1.0 (+https://github.com/janetyoon85/shadowstadium-data)';
const SPORTSDB_DELAY_MS = 2200; // TheSportsDB 무료 공유키(분당 30회) 보호 — team-logos와 동일.
const OWN_SOURCE_DELAY_MS = 600; // KBO/NPB/K리그/ESPN 자체 API — 공유 한도 아니라 짧게.
const BUDGET = 300; // 1시간마다 실행(SportsDB 경로 최악 ~11분, 타임아웃 25분).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchTheSportsDb(name, sportLabel) {
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(name)}`);
    if (!res.ok) return [];
    const j = await res.json();
    const players = j?.player || [];
    return players.filter((p) => p.strSport === sportLabel);
  } catch {
    return [];
  }
}
function pickBySportsDbYear(candidates, knownBirthDate) {
  if (candidates.length === 0) return undefined;
  const knownYear = knownBirthDate?.slice(0, 4);
  const pick = knownYear ? candidates.find((p) => p.dateBorn?.slice(0, 4) === knownYear) : candidates[0];
  return pick?.strCutout || pick?.strThumb || undefined;
}

async function resolveEspnSoccer(athleteId) {
  let displayName;
  let birthDate;
  let espnFallback;
  try {
    const res = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/${athleteId}`);
    if (res.ok) {
      const j = await res.json();
      const a = j.athlete;
      if (a) {
        displayName = a.displayName;
        const dobM = typeof a.displayDOB === 'string' ? a.displayDOB.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) : null;
        if (dobM) birthDate = `${dobM[3]}-${dobM[2].padStart(2, '0')}-${dobM[1].padStart(2, '0')}`;
      }
    }
  } catch {}
  espnFallback = `https://a.espncdn.com/i/headshots/soccer/players/full/${athleteId}.png`;
  if (!displayName) return espnFallback;
  await sleep(SPORTSDB_DELAY_MS);
  const candidates = await searchTheSportsDb(displayName, 'Soccer');
  const photo = pickBySportsDbYear(candidates, birthDate);
  return photo || espnFallback;
}

async function resolveMlb(personId) {
  // 공식 CDN URL 직접 조합 — 네트워크 호출 불필요(App.tsx와 동일 패턴, 실측 거의 전 로스터 커버).
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/v1/people/${personId}/headshot/67/current`;
}

async function resolveKbo(role, code) {
  const pathSeg = role === 'p' ? 'Pitcher' : 'Hitter';
  let englishName;
  let birthDate;
  let ownPhoto;
  try {
    const res = await fetch(`https://eng.koreabaseball.com/Teams/PlayerInfo${pathSeg}/Summary.aspx?pcode=${code}`);
    if (res.ok) {
      const html = await res.text();
      const nameM = html.match(/<b>Name<\/b>\s*:\s*([^<]*)<\/span>/);
      if (nameM) englishName = nameM[1].trim();
      const bornM = html.match(/<b>Born<\/b>\s*:\s*(\d{2})\/(\d{2})\/(\d{4})<\/span>/);
      if (bornM) birthDate = `${bornM[3]}-${bornM[1]}-${bornM[2]}`;
      const photoM = html.match(/id="[^"]*imgPlayer"[^>]*\bsrc="([^"]+)"/);
      if (photoM) ownPhoto = photoM[1].replace(/^\/\//, 'https://');
    }
  } catch {}
  // 공식 사진 우선(2026-10-01, "화이트 모자부터 다른데 사진바꿔줘") — TheSportsDB 컷아웃은 MLB 시절 등 옛 소속 사진인 경우가 있음.
  if (ownPhoto && !/noimg/.test(ownPhoto)) return ownPhoto;
  if (!englishName) return ownPhoto;
  await sleep(SPORTSDB_DELAY_MS);
  const candidates = await searchTheSportsDb(englishName, 'Baseball');
  const photo = pickBySportsDbYear(candidates, birthDate);
  return photo || ownPhoto;
}

async function resolveNpb(playerId) {
  try {
    const res = await fetch(`https://baseball.yahoo.co.jp/npb/player/${playerId}/top`);
    if (!res.ok) return undefined;
    const html = await res.text();
    const m = html.match(/<img class="bb-profile__img"[^>]*\bsrc="([^"]+)"/);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

async function resolveKleague(playerId) {
  try {
    const res = await fetch(`https://www.kleague.com/record/playerDetail.do?playerId=${playerId}`);
    if (!res.ok) return undefined;
    const html = await res.text();
    const m = html.match(/<div class="img-box">\s*<img src="([^"]+)"/);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

// 농구(2026-10-02): ESPN 헤드샷/네이버 선수사진은 URL이 결정적 — HEAD로 존재만 확인.
async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r.ok && /image/.test(r.headers.get('content-type') || '') ? url : undefined;
  } catch { return undefined; }
}

async function main() {
  const players = JSON.parse(await fs.readFile(PLAYERS_PATH, 'utf-8'));
  try { players.push(...JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'basketball', 'players.json'), 'utf-8'))); } catch {}
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(PHOTOS_PATH, 'utf-8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[player-photos] no player-photos.json yet — backfilling from scratch');
  }

  let tried = {};
  try { tried = JSON.parse(await fs.readFile(TRIED_PATH, 'utf-8')); } catch {}
  const today = Math.floor(Date.now() / 86400000);
  for (const [id, v] of Object.entries(cache)) if (v === null && !(id in tried)) tried[id] = today;
  const retryDue = (id) => cache[id] === null && today - (tried[id] ?? today) >= RETRY_NULL_DAYS;

  // MLB는 네트워크 호출이 없어 예산과 무관하게 전부 한 번에 처리(2026-09-30 최초 실행 시
  // 1,234명 즉시 완료 확인).
  let mlbDone = 0;
  for (const p of players) {
    const m = /^mlb:(\d+)$/.exec(p.id || '');
    if (!m) continue;
    if (p.id in cache) continue;
    cache[p.id] = await resolveMlb(m[1]);
    mlbDone++;
  }

  let used = 0;
  let found = 0;
  // ESPN(5천+명)이 예산을 독식하지 않도록 KBO/NPB/K리그(자체 소스)를 앞에 둔다.
  const srcRank = (id) => (/^espn:/.test(id) ? 1 : /^(espnbk|nbk):/.test(id) ? 0.5 : 0);
  // 같은 소스끼리는 최근 등장·다경기 선수 우선(유명 선수 사진이 뒤로 밀리지 않게).
  const ordered = [...players].sort((x, y) => srcRank(x.id || '') - srcRank(y.id || '') || (y.lastSeenDate || '').localeCompare(x.lastSeenDate || '') || (y.appearances?.length || 0) - (x.appearances?.length || 0));
  ordered.sort((x, y) => (x.id in cache ? 1 : 0) - (y.id in cache ? 1 : 0));
  for (const p of ordered) {
    if (!p.id || p.id.startsWith('mlb:')) continue; // 위에서 이미 처리.
    if (p.id in cache && !retryDue(p.id)) continue;
    if (used >= BUDGET) break;

    let photo;
    const espnM = /^espn:(\d+)$/.exec(p.id);
    const kboM = /^kbo:(b|p):(.+)$/.exec(p.id);
    const npbM = /^npb:(.+)$/.exec(p.id);
    const naverM = /^naver:(.+)$/.exec(p.id);
    const espnBk = /^espnbk:([a-z-]+):([0-9]+)$/.exec(p.id);
    const naverBk = /^nbk:([a-z]+):([0-9]+)$/.exec(p.id);
    if (espnBk) {
      await sleep(200); // 정적 이미지 HEAD — 예산 소모 없음
      photo = await headOk(`https://a.espncdn.com/i/headshots/${espnBk[1]}/players/full/${espnBk[2]}.png`);
    } else if (naverBk) {
      await sleep(200);
      photo = await headOk(`https://sports-phinf.pstatic.net/player/${naverBk[1]}/default/${naverBk[2]}.png`);
    } else if (espnM) {
      used++;
      photo = await resolveEspnSoccer(espnM[1]);
    } else if (kboM) {
      used++;
      photo = await resolveKbo(kboM[1], kboM[2]);
    } else if (npbM) {
      used++;
      await sleep(OWN_SOURCE_DELAY_MS);
      photo = await resolveNpb(npbM[1]);
    } else if (naverM) {
      used++;
      await sleep(OWN_SOURCE_DELAY_MS);
      photo = await resolveKleague(naverM[1]);
    } else {
      continue; // pid 없는(이름만) 인덱스 항목 — 동명이인 위험 커서 스킵.
    }
    cache[p.id] = photo || null;
    if (photo) { found++; delete tried[p.id]; } else tried[p.id] = today;
  }

  await fs.writeFile(TRIED_PATH, JSON.stringify(tried) + '\n', 'utf-8');
  await fs.writeFile(PHOTOS_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  console.log(`[player-photos] totalPlayers=${players.length} cached=${Object.keys(cache).length} mlbDone=${mlbDone} thisRunUsed=${used} thisRunFound=${found}`);
}

main().catch((e) => {
  console.error('[player-photos] FATAL:', e);
  process.exit(1);
});

// WBSC/아시안게임 등 "대회 하나 끝나면 다음 대회는 URL을 새로 찾아야 하는" 소스들의 다음
// 에디션을 사람이 날짜 기억해뒀다가 시키는 방식 대신, 자동으로 감지해서 Discord로 알려주는
// 감시 스크립트. 매주 1회 실행(.github/workflows/check-future-editions.yml).
//
// 동작 방식 두 갈래:
// 1) kind:'wbsc' — 다음 대회 URL을 어느 정도 예측 가능(WBSC가 대회명/연도 패턴을 미리 공지하는
//    경우가 많음, 예: "2027 WBSC U-18 Baseball World Cup"은 뉴스로 먼저 나옴). candidateKeys에
//    적어둔 후보 tournamentkey들을 실제로 GET 쳐서 데이터가 실리기 시작했는지 확인 — 확인되면
//    "발견됨" 알림(등록 즉시 가능하다고 알려줌). scripts/fetch-wbsc-baseball.mjs 에 이미 그
//    tournamentkey가 등록돼 있으면(=내가 이미 처리함) 조용히 스킵.
// 2) kind:'unknown-vendor' — 아시안게임처럼 다음 대회가 어느 업체 사이트를 쓸지 전혀 예측 불가한
//    경우. 이건 자동 탐지가 원천적으로 불가능(스크립트는 웹서치를 못 함) — 그래서 approxDate
//    기준 리마인드 창(REMINDER_WINDOW_DAYS)에 들어오면 그냥 "지금 리서치해야 함" 알림만 쏨.
//    처리 완료되면 이 파일의 resolved:true 로 바꿔서 알림 끄기.
//
// 새 대회 정보 알게 되면(WBSC 뉴스에 날짜 공지된 것 등) FUTURE_EDITIONS 에 추가/갱신할 것.

const REMINDER_WINDOW_DAYS = 90; // 대회 시작 예정일 이 만큼 전부터 알림 시작
const REPEAT_EVERY_DAYS = 14; // 알림 창 안에서는 이 주기로 반복 알림(매주 돌아도 매주 안 쏘려고)

const FUTURE_EDITIONS = [
  {
    name: '2027 WBSC U-18 야구월드컵',
    approxDate: '2027-09-17', // 중국 핑탄, 뉴스로 이미 공지됨
    kind: 'wbsc',
    domain: 'www.wbsc.org',
    candidateKeys: ['2027-u18-baseball-world-cup'],
    registryFile: 'scripts/fetch-wbsc-baseball.mjs',
  },
  {
    name: '2028 WBSC U-15 야구월드컵(예상)',
    approxDate: '2028-09-01', // 격년 홀수년 개최 패턴 추정, 정확한 날짜/개최지 미확정
    kind: 'wbsc',
    domain: 'www.wbsc.org',
    candidateKeys: [], // 아직 tournamentkey 패턴을 추정할 근거(뉴스) 없음 — unknown-vendor처럼 리마인드만
    registryFile: 'scripts/fetch-wbsc-baseball.mjs',
  },
  {
    name: '2028 WBSC U-23 야구월드컵(예상)',
    approxDate: '2028-09-01',
    kind: 'wbsc',
    domain: 'www.wbsc.org',
    candidateKeys: [],
    registryFile: 'scripts/fetch-wbsc-baseball.mjs',
  },
  {
    name: 'BFA U-18 야구 아시아선수권(다음 회, 격년 추정)',
    approxDate: '2028-09-01',
    kind: 'wbsc',
    domain: 'www.wbscasia.org',
    candidateKeys: [],
    registryFile: 'scripts/fetch-wbsc-baseball.mjs',
  },
  {
    name: '2030 도하 아시안게임 야구',
    approxDate: '2030-09-01', // 정확한 날짜 미확정, 대략치
    kind: 'unknown-vendor',
    resolved: false,
  },
  {
    // 벤더(ESPN)는 이미 확정·자동화돼있음(fetch-espn-olympic-football.mjs, 롤링 윈도우라 대회
    // 일정이 뜨면 팀명은 자동 매칭됨) — 다만 개최지가 매 대회 바뀌어 VENUE_MAP이 비어있는 채라
    // 실제 경기가 뜨기 시작해도 구장 미매핑으로 스킵됨. 대회 임박 시 ESPN에 뜨는 실제 구장명을
    // 확인해 VENUE_MAP(앱·데이터 저장소 양쪽)을 채워야 함.
    name: '2028 LA 올림픽 축구 — 구장 매핑',
    approxDate: '2028-06-01', // 개막(7월 예정) 전 리허설/조편성 발표 시점 감안 여유 있게
    kind: 'venue-pending',
    registryFile: 'scripts/fetch-espn-olympic-football.mjs',
  },
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function probeWbscTournament(domain, tournamentkey) {
  try {
    const url = `https://${domain}/en/events/${tournamentkey}/schedule-and-results`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return { found: false };
    const html = await res.text();
    const m = html.match(/data-page="({.*?})"\s*>\s*<\/div>/s);
    if (!m) return { found: false };
    const data = JSON.parse(unescapeHtml(m[1]));
    const games = data.props?.games || [];
    return { found: true, gameCount: games.length };
  } catch {
    return { found: false };
  }
}

async function isAlreadyRegistered(registryFile, tournamentkey) {
  try {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(registryFile, 'utf-8');
    return content.includes(tournamentkey);
  } catch {
    return false;
  }
}

function daysUntil(dateStr) {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const now = Date.now();
  return Math.floor((target - now) / 86400000);
}

// 알림 창 안에서 REPEAT_EVERY_DAYS 주기로만 실제로 쏘기 위한 결정론적 게이트(별도 상태 파일 없이
// "오늘이 창 시작일로부터 며칠째인지 % 주기"로 판단 — cron이 주 1회라 대략 맞아떨어짐).
function shouldFireToday(daysLeft) {
  if (daysLeft > REMINDER_WINDOW_DAYS || daysLeft < -30) return false; // 대회 시작 한 달 지나면 자동 종료
  const daysIntoWindow = REMINDER_WINDOW_DAYS - daysLeft;
  return daysIntoWindow % REPEAT_EVERY_DAYS < 7; // 주 1회 cron 기준 여유
}

async function main() {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const messages = [];

  for (const ed of FUTURE_EDITIONS) {
    const daysLeft = daysUntil(ed.approxDate);
    if (!shouldFireToday(daysLeft)) continue;

    if (ed.kind === 'unknown-vendor') {
      if (ed.resolved) continue;
      messages.push(
        `📅 **${ed.name}** — 예정일 약 ${ed.approxDate} (D${daysLeft >= 0 ? '-' + daysLeft : '+' + -daysLeft})\n` +
        `벤더를 예측할 수 없는 대회라 자동 탐지가 안 됨 — 공식 결과 사이트부터 다시 찾아야 함 ` +
        `(방법: reference_multisport_games_data 메모리 참고, WebSearch로 "[대회명] official results" → ` +
        `서버렌더링이면 data-page류 속성, SPA면 JS 번들에서 백엔드 API 역추적).`
      );
      continue;
    }

    if (ed.kind === 'venue-pending') {
      messages.push(
        `📅 **${ed.name}** — 예정일 약 ${ed.approxDate} (D${daysLeft >= 0 ? '-' + daysLeft : '+' + -daysLeft})\n` +
        `크롤러는 이미 자동화돼있음(벤더 확정) — ESPN에 조편성/일정이 뜨면 팀명은 자동 매칭되지만 ` +
        `개최 구장이 VENUE_MAP에 없어서 경기가 스킵될 수 있음. ${ed.registryFile} 실행해서 실제 뜨는 ` +
        `구장명을 확인하고 VENUE_MAP(앱·데이터 저장소 양쪽)에 채워넣을 것.`
      );
      continue;
    }

    // kind: 'wbsc'
    if (ed.candidateKeys.length === 0) {
      messages.push(
        `📅 **${ed.name}** — 예정일 약 ${ed.approxDate} (D${daysLeft >= 0 ? '-' + daysLeft : '+' + -daysLeft})\n` +
        `아직 정확한 tournamentkey를 추정할 뉴스가 없음 — wbsc.org/wbscasia.org 뉴스에서 대회명 검색 후 ` +
        `scripts/check-future-editions.mjs 의 candidateKeys 채워넣을 것.`
      );
      continue;
    }
    for (const key of ed.candidateKeys) {
      if (await isAlreadyRegistered(ed.registryFile, key)) continue; // 이미 등록 완료 — 조용히 스킵
      const probe = await probeWbscTournament(ed.domain, key);
      if (probe.found) {
        messages.push(
          `✅ **${ed.name}** 발견됨! tournamentkey=\`${key}\` (${probe.gameCount}경기 공개됨)\n` +
          `${ed.registryFile} 의 TOURNAMENTS 배열에 등록하고 팀·구장 매핑 확인 필요.`
        );
      } else {
        messages.push(
          `📅 **${ed.name}** — 예정일 약 ${ed.approxDate} (D${daysLeft >= 0 ? '-' + daysLeft : '+' + -daysLeft})\n` +
          `후보 tournamentkey \`${key}\` 아직 미공개(404/데이터없음). 계속 감시 중.`
        );
      }
    }
  }

  if (messages.length === 0) {
    console.log('[check-future-editions] nothing to report today');
    return;
  }

  const content = `🔔 그늘각 — 다음 대회 감시 알림\n\n${messages.join('\n\n')}`;
  console.log(content);
  if (webhook) {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  }
}

main().catch((e) => {
  console.error('[check-future-editions] fatal:', e);
  process.exit(1);
});

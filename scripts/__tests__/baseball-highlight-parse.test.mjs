import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHighlightSide, parseBaseballHighlights, parseBaseballHighlightsFromBoxscore, parseKboRelayHighlights, parseMlbNpbRelayHighlights, extractPitcherDecisions } from '../baseball-highlight-parse.mjs';

test('classifyHighlightSide - home/away/unknown', () => {
  const home = new Set(['강백호']);
  const away = new Set(['이정후']);
  assert.equal(classifyHighlightSide('강백호', home, away), 'home');
  assert.equal(classifyHighlightSide('이정후', home, away), 'away');
  assert.equal(classifyHighlightSide('모르는선수', home, away), null);
});

test('parseBaseballHighlights - KBO 홈런 "N호"(시즌누적) 표기는 그대로 유지', () => {
  const rd = {
    etcRecords: [{ how: '홈런', result: '강백호33호(4회2점 구창모)' }],
    battersBoxscore: { home: [{ name: '강백호' }], away: [] },
    pitchersBoxscore: { home: [], away: [{ name: '구창모' }] },
  };
  const { home } = parseBaseballHighlights(rd);
  assert.equal(home.length, 1);
  assert.equal(home[0].player, '강백호');
  assert.equal(home[0].text, '강백호33호(4회2점 구창모)');
});

test('parseBaseballHighlights - 회귀 방지: 홈런 외 반복이벤트 "호 없는 숫자" 카운트도 이름에서 걷어냄 (2026-09-28 실사용 버그)', () => {
  // "이강민2(6 7회)" = 이강민이 6,7회에 실책 2개 — 예전엔 player가 "이강민2(6 7회)" 통째로
  // 잘못 뽑혔음(선수 검색에 그대로 노출된 실사용 버그).
  const rd = {
    etcRecords: [{ how: '실책', result: '이강민2(6 7회)' }],
    battersBoxscore: { home: [{ name: '이강민' }], away: [] },
    pitchersBoxscore: { home: [], away: [] },
  };
  const { home } = parseBaseballHighlights(rd);
  assert.equal(home.length, 1);
  assert.equal(home[0].player, '이강민');
  assert.notEqual(home[0].player, '이강민2(6 7회)');
});

test('parseBaseballHighlights - 파싱 실패(여러 토큰 섞인 자유텍스트)는 player 필드 없이 폴백', () => {
  const rd = {
    etcRecords: [{ how: '병살타', result: '심판 명단: 김주장 이부장' }],
    battersBoxscore: { home: [], away: [] },
    pitchersBoxscore: { home: [], away: [] },
  };
  const { away } = parseBaseballHighlights(rd);
  // "김주장 이부장" 안엔 괄호가 없어서 애초에 정규식 매치 자체가 안 됨 → 원문 그대로 폴백.
  assert.equal(away.length, 1);
  assert.equal(away[0].player, undefined);
  assert.equal(away[0].text, '심판 명단: 김주장 이부장');
});

test('parseBaseballHighlightsFromBoxscore - 홈런 1개면 개수 생략, 2개+면 표기 (2026-09-28 "다 1호" 버그 수정)', () => {
  const rd = {
    homeBatter: [{ name: '벤지', hr: 1, sb: 0 }],
    awayBatter: [{ name: '로우', hr: 2, sb: 1 }],
  };
  const { home, away } = parseBaseballHighlightsFromBoxscore(rd);
  assert.deepEqual(home, [{ how: '홈런', text: '벤지', player: '벤지' }]);
  assert.deepEqual(away, [
    { how: '홈런', text: '로우 2개', player: '로우' },
    { how: '도루', text: '로우', player: '로우' },
  ]);
});

test('parseBaseballHighlightsFromBoxscore - 무득점/무도루면 undefined 아닌 빈 배열 객체 반환 (재조회 무한루프 방지)', () => {
  const rd = { homeBatter: [{ name: '선수', hr: 0, sb: 0 }], awayBatter: [] };
  const result = parseBaseballHighlightsFromBoxscore(rd);
  assert.deepEqual(result, { home: [], away: [] });
});

// 2026-09-29 실측(/relay, 20260929KTHT02026·NCOB02026 등) 구조 그대로 축약한 픽스처 —
// "지금 경기중인 야구경기에 이벤트 하나도 안붙음" 리포트로 etcRecords가 경기 막판에야
// 한꺼번에 채워짐을 발견, 진행 중엔 이 /relay 기반 파서로 대체.
test('parseKboRelayHighlights - 하프이닝 타이틀로 타격팀 판정 + 안타/삼진은 하이라이트 제외', () => {
  const textRelayData = {
    textRelays: [
      { no: 93, titleStyle: '0', title: '9회초 KT 공격', textOptions: [{ seqno: 500, type: 0, text: '9회초 KT 공격' }] },
      { no: 94, titleStyle: '8', title: '3번타자 안현민', textOptions: [
        { seqno: 501, type: 8, text: '3번타자 안현민' },
        { seqno: 502, type: 13, text: '안현민 : 좌익수 앞 1루타' }, // 단타는 하이라이트 스코프 아님(etcRecords와 동일 스코프 유지).
      ] },
      { no: 95, titleStyle: '8', title: '4번타자 힐리어드', textOptions: [
        { seqno: 503, type: 8, text: '4번타자 힐리어드' },
        { seqno: 504, type: 13, text: '힐리어드 : 좌익수 앞 1루타' },
        { seqno: 505, type: 14, text: '1루주자 안현민 : 2루까지 진루' }, // 단순 진루도 스코프 아님.
      ] },
      { no: 96, titleStyle: '8', title: '5번타자 장성우', textOptions: [
        { seqno: 506, type: 8, text: '5번타자 장성우' },
        { seqno: 507, type: 13, text: '장성우 : 삼진 아웃' }, // 아웃도 스코프 아님.
      ] },
    ],
  };
  const { home, away, maxSeqno } = parseKboRelayHighlights(textRelayData, 'KIA', 'KT');
  assert.equal(home.length, 0);
  assert.equal(away.length, 0); // 단타/진루/삼진뿐이라 하이라이트 0건 — 정상.
  assert.equal(maxSeqno, 507);
});

test('parseKboRelayHighlights - 실책으로 인한 진루(type 14)를 하이라이트로 포착', () => {
  const textRelayData = {
    textRelays: [
      { no: 84, titleStyle: '0', title: '9회초 키움 공격', textOptions: [{ seqno: 300, type: 0, text: '9회초 키움 공격' }] },
      { no: 87, titleStyle: '8', title: '어준서', textOptions: [
        { seqno: 301, type: 13, text: '어준서 : 2루수 앞 땅볼로 출루' },
        { seqno: 302, type: 14, text: '1루주자 박주홍 : 2루수 실책으로 2루까지 진루 (2루수 송구 실책->유격수)' },
      ] },
    ],
  };
  const { away } = parseKboRelayHighlights(textRelayData, '롯데', '키움');
  assert.equal(away.length, 1);
  assert.equal(away[0].how, '실책');
  assert.equal(away[0].player, '박주홍');
  assert.equal(away[0].seqno, 302);
});

test('parseKboRelayHighlights - 홈/원정 타이틀 매칭 전(하프이닝 시작 놓침)엔 오귀속 대신 유실', () => {
  const textRelayData = {
    textRelays: [
      // 하프이닝 시작 타이틀(titleStyle:0)이 이번 poll 창에 아예 없는 경우 — 실제로 창이 하프이닝
      // 경계에서 갈릴 때 발생 가능(직전 poll이 이미 이 결과를 못 봤다면 다음 poll에서 타이틀까지
      // 같이 들어올 때 잡힘 — 이 테스트는 "그 전까지는 안전하게 스킵"만 확인).
      { no: 96, titleStyle: '8', title: '3번타자', textOptions: [{ seqno: 700, type: 13, text: '누군가 : 우중간 2루타' }] },
    ],
  };
  const { home, away, maxSeqno } = parseKboRelayHighlights(textRelayData, '삼성', '한화');
  assert.equal(home.length, 0);
  assert.equal(away.length, 0);
  assert.equal(maxSeqno, 700); // seqno는 여전히 추적(다음 poll에서 중복 처리 방지용).
});

test('parseKboRelayHighlights - 홈런/도루/2루타/병살타/폭투 키워드 분류', () => {
  const mk = (text) => ({ no: 90, titleStyle: '8', title: 'x', textOptions: [{ seqno: 1, type: 13, text }] });
  const withTitle = (entry) => ({ textRelays: [{ no: 1, titleStyle: '0', title: '9회초 한화 공격', textOptions: [] }, entry] });
  assert.equal(parseKboRelayHighlights(withTitle(mk('김성윤 : 우측 담장을 넘기는 홈런')), '삼성', '한화').away[0].how, '홈런');
  assert.equal(parseKboRelayHighlights(withTitle(mk('이원석 : 2루 도루 성공')), '삼성', '한화').away[0].how, '도루');
  assert.equal(parseKboRelayHighlights(withTitle(mk('최지훈 : 좌익수 2루타')), '삼성', '한화').away[0].how, '2루타');
  assert.equal(parseKboRelayHighlights(withTitle(mk('추재현 : 2루수 병살타 아웃')), '삼성', '한화').away[0].how, '병살타');
  assert.equal(parseKboRelayHighlights(withTitle(mk('톨허스트2 : 폭투')), '삼성', '한화').away[0].how, '폭투');
});

// 2026-09-30 실측(NPB 20260929HIYO0, KBO 20260312SSHH02026) 구조 그대로 축약한 픽스처 —
// "타마무라" 리포트("정보를 찾을 수 없어요")로 이름 매칭 실패를 발견, wls 코드 직접추출로 교체.
test('extractPitcherDecisions - NPB(homePitcher/awayPitcher) 실측: 이름 음역이 달라도(다마무라 vs 타마무라) 코드는 정확히 뽑힘', () => {
  const rd = {
    homePitcher: [
      { name: '도고', wls: '승', playerId: '1800028' },
      { name: '라이델', wls: '세', playerId: '1700010' },
    ],
    awayPitcher: [
      // schedule API 쪽 losePitcher 이름은 "타마무라"지만 이 record API boxscore엔 "다마무라"로
      // 표기됨(실측 확인) — 이름이 아니라 wls 코드로 뽑으므로 이 불일치와 무관하게 정확함.
      { name: '다마무라', wls: '패', playerId: '1900057' },
      { name: '모리', wls: '', playerId: '2103788' },
    ],
  };
  const r = extractPitcherDecisions(rd);
  assert.equal(r.winPitcherCode, '1800028');
  assert.equal(r.losePitcherCode, '1900057');
  assert.equal(r.savePitcherCode, '1700010');
  assert.equal(r.save, '라이델');
});

test('extractPitcherDecisions - KBO(pitchingResult) 실측: wls가 W/L/S(영문), pCode 필드', () => {
  const rd = {
    pitchingResult: [
      { name: '왕옌청', wls: 'L', pCode: '56719' },
      { name: '양창섭', wls: 'W', pCode: '68415' },
    ],
  };
  const r = extractPitcherDecisions(rd);
  assert.equal(r.winPitcherCode, '68415');
  assert.equal(r.losePitcherCode, '56719');
  assert.equal(r.savePitcherCode, null); // 이 경기는 세이브 없음(승/패만).
  assert.equal(r.save, null);
});

test('extractPitcherDecisions - 홀드 투수는 여전히 이름 목록(pitcherCodeByName 병행 유지)', () => {
  const rd = {
    pitchersBoxscore: {
      home: [{ name: '김택연', wls: '홀', pcode: '54263' }],
      away: [],
    },
  };
  const r = extractPitcherDecisions(rd);
  assert.deepEqual(r.holdHome, ['김택연']);
  assert.deepEqual(r.holdAway, []);
  assert.equal(r.pitcherCodeByName['김택연'], '54263');
});

test('extractPitcherDecisions - recordData 필드 자체가 없어도(undefined) 안전하게 빈 결과', () => {
  const r = extractPitcherDecisions({});
  assert.equal(r.winPitcherCode, null);
  assert.equal(r.losePitcherCode, null);
  assert.equal(r.savePitcherCode, null);
  assert.equal(r.save, null);
  assert.deepEqual(r.holdHome, []);
  assert.deepEqual(r.holdAway, []);
});

// 2026-09-30 실측(MLB 20260930PHAT0 /relay) 구조 그대로 축약한 픽스처 — "mlb도 경기중에
// 이벤트발생하면 추가해줘야지 모든야구경기 다마찬가지임" 리포트로 발견: MLB/NPB도 KBO와 동일하게
// etcRecords가 경기 막판에야 채워져 진행 중엔 하이라이트가 하나도 안 붙던 공백이 있었음.
// KBO와 달리 스키마가 평면(title+text, homeOrAway 필드 직접 존재)이라 별도 파서로 대응.
test('parseMlbNpbRelayHighlights - homeOrAway 필드로 직접 팀 판정 + 콜론 있는 줄만 파싱(병살타 포착, 안타/아웃은 스코프 밖)', () => {
  const textRelayData = {
    textRelays: [
      { no: 442, inn: 9, homeOrAway: '0', titleStyle: '8', title: '7번타자 스탯', text: '1구 스트라이크<br/>2구 헛스윙<br/>3구 볼<br/>4구 타격<br/>스탓 : 좌익수 플라이 아웃' },
      { no: 437, inn: 9, homeOrAway: '0', titleStyle: '8', title: '6번타자 데 라 크루즈', text: '1구 볼<br/>2구 타격<br/>데 라 크루즈 : 유격수 병살타 아웃<br/>1루주자 마쉬 : 아웃' },
      { no: 434, inn: 9, homeOrAway: '0', titleStyle: '8', title: '5번타자 마쉬', text: '1구 타격<br/>마쉬 : 우중간 안타' },
      { no: 429, inn: 9, homeOrAway: '0', titleStyle: '0', title: '9회초 필라델피아공격', text: '' },
    ],
  };
  const { home, away, maxSeqno } = parseMlbNpbRelayHighlights(textRelayData);
  assert.equal(home.length, 0);
  assert.equal(away.length, 1); // 안타/플라이아웃은 스코프 밖(KBO와 동일 기준) — 병살타만 포착.
  assert.equal(away[0].how, '병살타');
  assert.equal(away[0].player, '데 라 크루즈');
  assert.equal(maxSeqno, 442);
});

test('parseMlbNpbRelayHighlights - homeOrAway="1"이면 home으로 분류', () => {
  const textRelayData = {
    textRelays: [
      { no: 100, inn: 3, homeOrAway: '1', titleStyle: '8', title: '4번타자 오타니', text: '1구 타격<br/>오타니 : 좌월 홈런' },
    ],
  };
  const { home, away } = parseMlbNpbRelayHighlights(textRelayData);
  assert.equal(home.length, 1);
  assert.equal(away.length, 0);
  assert.equal(home[0].how, '홈런');
  assert.equal(home[0].player, '오타니');
});

test('parseMlbNpbRelayHighlights - 콜론 없는 주자 진루 줄("2루주자 이름 3루까지 진루")은 오귀속 방지로 스킵', () => {
  const textRelayData = {
    textRelays: [
      { no: 200, inn: 5, homeOrAway: '0', titleStyle: '8', title: '4번타자 오타 료', text: '1구 타격<br/>오타 료 유격수 앞 땅볼 아웃<br/>2루주자 와타나베 하루토 3루까지 진루' },
    ],
  };
  const { home, away } = parseMlbNpbRelayHighlights(textRelayData);
  assert.equal(home.length, 0);
  assert.equal(away.length, 0);
});

test('parseMlbNpbRelayHighlights - textRelays 자체가 없어도(undefined) 안전하게 빈 결과', () => {
  const r = parseMlbNpbRelayHighlights({});
  assert.deepEqual(r.home, []);
  assert.deepEqual(r.away, []);
  assert.equal(r.maxSeqno, 0);
});

// ── 홈런 맞은 투수(2026-10-09) ──
test('extractHomeRunPitcher - "(N회M점 투수)"에서 투수 이름 추출, 다른 형식은 null', async () => {
  const { extractHomeRunPitcher } = await import('../baseball-highlight-parse.mjs');
  assert.equal(extractHomeRunPitcher('문정빈18호(4회1점 김한결)'), '김한결');
  assert.equal(extractHomeRunPitcher('서건창1호(8회1점 타무라)'), '타무라');
  assert.equal(extractHomeRunPitcher('이강민2(6 7회)'), null);
  assert.equal(extractHomeRunPitcher('강백호'), null);
  assert.equal(extractHomeRunPitcher(''), null);
});

test('parseBaseballHighlights - 홈런 entry에 맞은 투수 이름과 pcode (상대 팀 투수 명단 우선)', () => {
  const rd = {
    etcRecords: [{ how: '홈런', result: '문정빈18호(4회1점 김한결)' }],
    battersBoxscore: { home: [{ name: '문정빈', playerCode: '111' }], away: [] },
    // 같은 이름 "김한결"이 홈 팀(타자 팀)에도 있다 — 홈런을 맞은 건 상대(원정) 팀 투수여야 한다.
    pitchersBoxscore: { home: [{ name: '김한결', pcode: '900' }], away: [{ name: '김한결', pcode: '222' }] },
  };
  const { home } = parseBaseballHighlights(rd);
  assert.equal(home.length, 1);
  assert.equal(home[0].player, '문정빈');
  assert.equal(home[0].playerCode, '111');
  assert.equal(home[0].pitcher, '김한결');
  assert.equal(home[0].pitcherCode, '222');
});

test('parseBaseballHighlights - 투수 명단에 없으면 이름만, 타자 팀 판정 실패 시 한쪽에만 있는 투수 코드 사용, 홈런 외엔 투수 필드 없음', () => {
  const rd = {
    etcRecords: [
      { how: '홈런', result: '모르는타자1호(2회1점 타무라)' }, // 타자 팀 판정 불가 → away 폴백
      { how: '2루타', result: '강백호(3회)' },
      { how: '홈런', result: '박찬호3호(5회2점 없는투수)' },
    ],
    battersBoxscore: { home: [{ name: '박찬호' }], away: [] },
    pitchersBoxscore: { home: [{ name: '타무라', pcode: '777' }], away: [] },
  };
  const { home, away } = parseBaseballHighlights(rd);
  const hr1 = away.find((e) => e.player === '모르는타자');
  assert.equal(hr1.pitcher, '타무라');
  assert.equal(hr1.pitcherCode, '777'); // 한쪽(home 명단)에만 있어 채택
  const hr2 = home.find((e) => e.player === '박찬호');
  assert.equal(hr2.pitcher, '없는투수');
  assert.equal(hr2.pitcherCode, undefined);
  const dbl = away.find((e) => e.how === '2루타') || home.find((e) => e.how === '2루타');
  assert.equal(dbl?.pitcher, undefined);
});

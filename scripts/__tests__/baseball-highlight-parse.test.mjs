import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHighlightSide, parseBaseballHighlights, parseBaseballHighlightsFromBoxscore, parseKboRelayHighlights } from '../baseball-highlight-parse.mjs';

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHighlightSide, parseBaseballHighlights, parseBaseballHighlightsFromBoxscore } from '../baseball-highlight-parse.mjs';

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

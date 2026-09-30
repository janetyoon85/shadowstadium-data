import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPlayerName } from '../player-name-canon.mjs';

// 실제 저장소 사전(player-name-en.json/player-name-auto.json)을 그대로 로드해서 검증 —
// 이 테스트가 깨지면 사전 자체가 바뀐 것(선수 개명·이적 등)이거나 정규화 로직이 깨진 것.

test('canonicalPlayerName - 한글 원문은 그대로(이미 정규 키)', () => {
  assert.equal(canonicalPlayerName('손흥민'), '손흥민');
});

test('canonicalPlayerName - 회귀 방지(2026-09-28): 영문 풀네임(ESPN 원문 어시스트)도 한글로 정규화', () => {
  // 득점자(한글, 네이버)/어시스트(영문, ESPN)가 갈라져서 "손흥민"으로 즐겨찾기해도 어시스트
  // 알림을 못 받던 버그의 회귀 테스트.
  assert.equal(canonicalPlayerName('Son Heung-Min'), '손흥민');
});

test('canonicalPlayerName - 모르는 이름은 원문 그대로 통과(추측하지 않음)', () => {
  assert.equal(canonicalPlayerName('전혀모르는이름 Unknown Player'), '전혀모르는이름 Unknown Player');
});

test('canonicalPlayerName - 빈 값/undefined는 그대로 반환(크래시 없음)', () => {
  assert.equal(canonicalPlayerName(''), '');
  assert.equal(canonicalPlayerName(undefined), undefined);
});

// 실사례 회귀 방지(2026-09-30, "이강인 검색안되네" 리포트) — 사전엔 "이강인": "Lee Kang-in"
// (소문자 in)으로 등록돼있는데 ESPN 실제 원문은 "Lee Kang-In"(대문자 In)이라 대소문자까지
// 정확히 일치해야 하는 조회가 항상 실패, 이강인만 한글로 정규화 안 되고 영문("Lee Kang-In")
// 그대로 검색 인덱스에 들어가 "이강인"으로 검색해도 안 뜨던 버그.
test('canonicalPlayerName - 사전 값과 대소문자만 다른 실제 원문도 정규화됨(대소문자 무시 조회)', () => {
  assert.equal(canonicalPlayerName('Lee Kang-In'), '이강인');
  assert.equal(canonicalPlayerName('Lee Kang-in'), '이강인');
});

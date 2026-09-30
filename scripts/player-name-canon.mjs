// 선수명 정규화(2026-09-28) — 득점자(s.n)는 네이버 원문(한글)인데 어시스트(s.a)는 ESPN
// 원문(영문)이라, 같은 선수인데 골/어시에 따라 문자열이 갈라지는 문제 발견(사용자 리포트:
// "손흥민"으로 즐겨찾기해도 어시스트 시 "Son Heung-Min"이라 알림이 안 옴). App.tsx의
// displayAssistName이 쓰는 것과 정확히 동일한 로직(역인덱스+성만 유일매칭 폴백)으로, 어시스트
// 영문명이 알려진 선수면 한글 원문으로 정규화.
//
// 두 사전을 합쳐서 씀:
//  - player-name-en.json: MIRROR SOURCE shadowstadium/App.tsx의 PLAYER_NAME_EN(수작업, 유명
//    선수 위주 1300여명). 앱에서 갱신되면 재추출해서 수동 동기화 필요(자동화 없음).
//  - player-name-auto.json: fetch-schedule.mjs의 enrichEuroAssists가 ESPN athleteId 매칭에
//    성공할 때마다 자동으로 적립하는 사전(2026-09-28, "미리 다 가지고 있으면" 요청 대응) —
//    ESPN 연동 리그에서 뛰는 모든 선수를 수작업 없이 자동으로 커버, 매 실행마다 계속 늘어남.
//    충돌 시 수작업 사전이 우선(사람이 검증한 값을 자동 캐치보다 신뢰).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}
const PLAYER_NAME_AUTO = loadJsonSafe(path.join(__dirname, '..', 'player-name-auto.json'));
const PLAYER_NAME_EN_MANUAL = loadJsonSafe(path.join(__dirname, '..', 'player-name-en.json'));
const PLAYER_NAME_EN = { ...PLAYER_NAME_AUTO, ...PLAYER_NAME_EN_MANUAL };

// 대소문자 무시(2026-09-30, "이강인 검색안되네" 리포트로 발견) — player-name-en.json에
// "이강인": "Lee Kang-in"(소문자 in)으로 등록돼있는데 실제 ESPN 원문은 "Lee Kang-In"(대문자
// In)이라, 대소문자까지 정확히 일치해야 하는 기존 조회가 항상 실패해서 이강인만 한글로 정규화
// 안 되고 영문 그대로 인덱싱되던 버그. 사람이 1,300여명을 수작업으로 입력한 사전이라 이런
// 대소문자 오타가 더 있을 수 있어 조회 자체를 대소문자 무시로 바꿈(값은 원래 표기 그대로 유지).
const byEn = {};
for (const [ko, en] of Object.entries(PLAYER_NAME_EN)) byEn[en.toLowerCase()] = ko;

const bySurnameSets = {};
for (const [ko, en] of Object.entries(PLAYER_NAME_EN)) {
  const surname = en.trim().split(/\s+/).pop();
  if (!surname) continue;
  (bySurnameSets[surname.toLowerCase()] ??= new Set()).add(ko);
}
const bySurname = {};
for (const [surname, set] of Object.entries(bySurnameSets)) {
  if (set.size === 1) bySurname[surname] = [...set][0];
}

export function canonicalPlayerName(name) {
  if (!name) return name;
  if (byEn[name.toLowerCase()]) return byEn[name.toLowerCase()];
  const surname = name.trim().split(/\s+/).pop();
  if (surname && bySurname[surname.toLowerCase()]) return bySurname[surname.toLowerCase()];
  return name;
}

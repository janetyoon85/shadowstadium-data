// 선수명 정규화(2026-09-28) — 득점자(s.n)는 네이버 원문(한글)인데 어시스트(s.a)는 ESPN
// 원문(영문)이라, 같은 선수인데 골/어시에 따라 문자열이 갈라지는 문제 발견(사용자 리포트:
// "손흥민"으로 즐겨찾기해도 어시스트 시 "Son Heung-Min"이라 알림이 안 옴). App.tsx의
// displayAssistName이 쓰는 것과 정확히 동일한 로직(PLAYER_NAME_EN 역인덱스+성만 유일매칭
// 폴백)으로, 어시스트 영문명이 알려진 한국 선수면 한글 원문으로 정규화.
//
// MIRROR SOURCE: shadowstadium/App.tsx의 PLAYER_NAME_EN. 앱에서 이 사전이 갱신되면
// ../player-name-en.json도 재생성해야 함(App.tsx에서 `const PLAYER_NAME_EN = {...}` 블록을
// JSON으로 추출하는 1회성 스크립트로 재생성, 이 저장소에 별도 자동화는 없음 — 수동 동기화).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_NAME_EN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'player-name-en.json'), 'utf-8'));

const byEn = {};
for (const [ko, en] of Object.entries(PLAYER_NAME_EN)) byEn[en] = ko;

const bySurnameSets = {};
for (const [ko, en] of Object.entries(PLAYER_NAME_EN)) {
  const surname = en.trim().split(/\s+/).pop();
  if (!surname) continue;
  (bySurnameSets[surname] ??= new Set()).add(ko);
}
const bySurname = {};
for (const [surname, set] of Object.entries(bySurnameSets)) {
  if (set.size === 1) bySurname[surname] = [...set][0];
}

export function canonicalPlayerName(name) {
  if (!name) return name;
  if (byEn[name]) return byEn[name];
  const surname = name.trim().split(/\s+/).pop();
  if (surname && bySurname[surname]) return bySurname[surname];
  return name;
}

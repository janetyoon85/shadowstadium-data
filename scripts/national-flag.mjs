// 국가대표 경기 푸시 알림의 국기 표기(2026-10-26 "국대 경기는 국기도 같이 표기 가능?").
// 데이터: national-flags.json — 앱 App.tsx 의 COUNTRY_TO_ISO2·SPECIAL_FLAGS·NATIONAL_TEAM_LEAGUES 복사본(앱 쪽을 바꾸면 app repo scripts/gen-national-flags.mjs 로 다시 생성).
import fs from 'node:fs';

let D = { leagues: [], iso: {}, special: {} };
try { D = JSON.parse(fs.readFileSync(new URL('../national-flags.json', import.meta.url), 'utf8')); } catch { /* 파일이 없으면 국기 없이 동작 */ }
const LEAGUES = new Set(D.leagues);
const flagFromISO2 = (code) => [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
export const stripGenderSuffix = (name) => String(name || '').replace(/\s*\((남자|여자)\)\s*$/, '').trim();

// 국가대표 리그의 한글 국가명이면 국기 이모지 + 공백, 아니면 빈 문자열.
export function teamFlag(name, league) {
  if (!name || !LEAGUES.has(league)) return '';
  const base = stripGenderSuffix(name);
  if (D.special[base]) return D.special[base] + ' ';
  const iso2 = D.iso[base];
  return iso2 ? flagFromISO2(iso2) + ' ' : '';
}

// 알림 발송 기록(sent-*.json)을 원격 최신본과 "합집합"으로 합친다. 사용: node scripts/merge-sent-state.mjs <내 파일이 있는 폴더> <파일명...>
// 기록은 키가 추가만 되는 구조라 충돌할 이유가 없다 — git 줄 단위 rebase 가 큰 JSON 에서 충돌해 저장이 통째로 실패하던 것(2026-10-26, 1분 주기에서 발견)을 피한다.
// 규칙: 객체는 키별로 재귀 병합, 배열은 합집합, 문자열(ISO 시각)은 더 늦은 값, 나머지는 내 값.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function mergeState(theirs, mine) {
  if (mine === undefined) return theirs;
  if (theirs === undefined) return mine;
  if (Array.isArray(theirs) && Array.isArray(mine)) return [...new Set([...theirs, ...mine])];
  if (theirs && mine && typeof theirs === 'object' && typeof mine === 'object' && !Array.isArray(theirs) && !Array.isArray(mine)) {
    const out = { ...theirs };
    for (const k of Object.keys(mine)) out[k] = mergeState(theirs[k], mine[k]);
    return out;
  }
  if (typeof theirs === 'string' && typeof mine === 'string') return theirs > mine ? theirs : mine;
  return mine;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [dir, ...files] = process.argv.slice(2);
  for (const f of files) {
    const mp = path.join(dir, f);
    if (!fs.existsSync(mp)) continue;
    const mineText = fs.readFileSync(mp, 'utf8');
    const mine = JSON.parse(mineText);
    // 원래 파일의 들여쓰기를 유지해 불필요한 diff 를 만들지 않는다
    const indent = /^\s*[{[]\r?\n([ \t]+)\S/.exec(mineText)?.[1] ?? 2;
    const theirs = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
    fs.writeFileSync(f, JSON.stringify(mergeState(theirs, mine), null, indent) + '\n');
  }
}

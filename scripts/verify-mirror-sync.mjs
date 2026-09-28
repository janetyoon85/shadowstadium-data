// MIRROR SOURCE 동기화 체크(2026-09-28) — 이 저장소(topic.mjs)와 shadowstadium/App.tsx가
// "byte-for-byte 동일해야 함"이라고 서로 주석으로 약속해둔 함수/데이터가 실제로 같은 동작을
// 내는지 자동 검증. 지금까진 사람이 "한쪽 고칠 때 반대쪽도 잊지 말 것"을 기억해야 했는데,
// 이 스크립트가 어긋남을 잡아줌.
//
// 대상:
//  1) 토픽 함수(gameTopic/sanitizeTopicSegment/fnv1a32/playerTopic) — App.tsx에서 정규식으로
//     함수 본문만 뽑아(타입 주석은 시그니처에만 있고 본문은 순수 JS라 그대로 실행 가능) 이
//     저장소의 실제 구현과 같은 입력에 같은 출력을 내는지 비교. 새 패키지 설치 없이 동작하도록
//     TS AST 대신 가벼운 정규식 추출 사용(함수가 단순해서 충분히 안전).
//  2) player-name-en.json ↔ App.tsx의 PLAYER_NAME_EN — 내용이 완전히 같은지.
//
// 실행: node scripts/verify-mirror-sync.mjs [App.tsx 경로, 기본은 형제 디렉터리 shadowstadium]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as realTopic from './topic.mjs';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const appTsxPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(REPO_ROOT, '..', 'shadowstadium', 'App.tsx');

if (!fs.existsSync(appTsxPath)) {
  console.error(`[verify-mirror-sync] App.tsx를 못 찾음: ${appTsxPath} (형제 디렉터리 가정이 안 맞으면 경로 인자로 직접 지정)`);
  process.exit(1);
}
const appSrc = fs.readFileSync(appTsxPath, 'utf-8');

function extractConst(name) {
  const m = appSrc.match(new RegExp(`const ${name}\\s*=\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`));
  if (!m) throw new Error(`App.tsx에서 상수 ${name}을 못 찾음`);
  return m[2];
}

function extractFunction(name) {
  const sigRe = new RegExp(`function ${name}\\s*\\(`);
  const sigMatch = sigRe.exec(appSrc);
  if (!sigMatch) throw new Error(`App.tsx에서 함수 ${name}을 못 찾음`);
  let i = sigMatch.index + sigMatch[0].length;
  // 파라미터 목록(중첩 괄호 없다고 가정 — 대상 함수들이 전부 단순 시그니처).
  let depth = 1;
  const paramsStart = i;
  while (depth > 0) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') depth--;
    i++;
  }
  const paramsRaw = appSrc.slice(paramsStart, i - 1);
  const paramNames = paramsRaw
    .split(',')
    .map((p) => p.split(':')[0].trim())
    .filter(Boolean);
  // 리턴 타입 주석(": string" 등) 건너뛰고 본문 시작 `{` 찾기.
  const braceIdx = appSrc.indexOf('{', i);
  let bodyDepth = 1;
  let j = braceIdx + 1;
  while (bodyDepth > 0) {
    if (appSrc[j] === '{') bodyDepth++;
    else if (appSrc[j] === '}') bodyDepth--;
    j++;
  }
  const body = appSrc.slice(braceIdx + 1, j - 1);
  return { paramNames, body };
}

function buildExtractedTopic() {
  const FCM_GAME_TOPIC_PREFIX = extractConst('FCM_GAME_TOPIC_PREFIX');
  const FCM_PLAYER_TOPIC_PREFIX = extractConst('FCM_PLAYER_TOPIC_PREFIX');
  const sanitizeTopicSegment = extractFunction('sanitizeTopicSegment');
  const gameTopic = extractFunction('gameTopic');
  const fnv1a32 = extractFunction('fnv1a32');
  const playerTopic = extractFunction('playerTopic');

  // App.tsx의 fnv1a32는 TextEncoder를 쓰는데(브라우저/RN 전역) Node에도 전역으로 있음 — 그대로 재사용 가능.
  const src = `
    const FCM_GAME_TOPIC_PREFIX = ${JSON.stringify(FCM_GAME_TOPIC_PREFIX)};
    const FCM_PLAYER_TOPIC_PREFIX = ${JSON.stringify(FCM_PLAYER_TOPIC_PREFIX)};
    function sanitizeTopicSegment(${sanitizeTopicSegment.paramNames.join(',')}) { ${sanitizeTopicSegment.body} }
    function gameTopic(${gameTopic.paramNames.join(',')}) { ${gameTopic.body} }
    function fnv1a32(${fnv1a32.paramNames.join(',')}) { ${fnv1a32.body} }
    function playerTopic(${playerTopic.paramNames.join(',')}) { ${playerTopic.body} }
    module.exports = { gameTopic, sanitizeTopicSegment, fnv1a32, playerTopic };
  `;
  const tmpFile = path.join(os.tmpdir(), `topic-extracted-${process.pid}-${Date.now()}.cjs`);
  fs.writeFileSync(tmpFile, src);
  try {
    return require(tmpFile);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function main() {
  let failures = 0;

  // ── 1) 토픽 함수 동작 비교 ──
  let extracted;
  try {
    extracted = buildExtractedTopic();
  } catch (e) {
    console.error(`✖ App.tsx에서 토픽 함수 추출 실패: ${e.message}`);
    console.error('  (App.tsx 쪽 함수 시그니처/이름이 바뀌었을 수 있음 — 이 스크립트도 같이 갱신 필요)');
    process.exit(1);
  }

  const cases = [
    { fn: 'sanitizeTopicSegment', args: ['K1_2026abc'] },
    { fn: 'sanitizeTopicSegment', args: ['가나다!@#'] },
    { fn: 'gameTopic', args: ['K1_2026abc', 3] },
    { fn: 'gameTopic', args: ['some id with space', 24] },
    { fn: 'fnv1a32', args: ['손흥민'] },
    { fn: 'fnv1a32', args: ['Harry Kane'] },
    { fn: 'fnv1a32', args: [''] },
    { fn: 'playerTopic', args: ['손흥민'] },
    { fn: 'playerTopic', args: ['Son Heung-Min'] },
  ];

  for (const c of cases) {
    const a = realTopic[c.fn](...c.args);
    const b = extracted[c.fn](...c.args);
    if (a !== b) {
      failures++;
      console.error(`✖ ${c.fn}(${c.args.map((x) => JSON.stringify(x)).join(', ')}): topic.mjs=${JSON.stringify(a)} vs App.tsx=${JSON.stringify(b)}`);
    }
  }
  if (failures === 0) {
    console.log(`✔ 토픽 함수 ${cases.length}개 케이스 전부 topic.mjs ↔ App.tsx 일치.`);
  }

  // ── 2) player-name-en.json ↔ App.tsx PLAYER_NAME_EN 내용 비교 ──
  const jsonPath = path.join(REPO_ROOT, 'player-name-en.json');
  const jsonDict = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const m = appSrc.match(/const PLAYER_NAME_EN: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!m) {
    console.error('✖ App.tsx에서 PLAYER_NAME_EN을 못 찾음');
    failures++;
  } else {
    const appDict = new Function(`return {${m[1]}}`)();
    const jsonKeys = new Set(Object.keys(jsonDict));
    const appKeys = new Set(Object.keys(appDict));
    const missingInJson = [...appKeys].filter((k) => !jsonKeys.has(k));
    const mismatched = [...appKeys].filter((k) => jsonKeys.has(k) && jsonDict[k] !== appDict[k]);
    if (missingInJson.length > 0) {
      failures++;
      console.error(`✖ player-name-en.json에 없는 App.tsx 신규 항목 ${missingInJson.length}개(재추출 필요) — 예: ${missingInJson.slice(0, 5).join(', ')}`);
    }
    if (mismatched.length > 0) {
      failures++;
      console.error(`✖ 값이 다른 항목 ${mismatched.length}개 — 예: ${mismatched.slice(0, 5).join(', ')}`);
    }
    if (missingInJson.length === 0 && mismatched.length === 0) {
      console.log(`✔ player-name-en.json(${jsonKeys.size}개)이 App.tsx PLAYER_NAME_EN(${appKeys.size}개)과 동기화됨.`);
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main();

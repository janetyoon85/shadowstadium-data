import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamFlag } from '../national-flag.mjs';
import { flagTeam } from '../push-i18n.mjs';

test('국가대표 리그에서만 국기를 붙인다(공백 포함), 클럽 리그는 빈 문자열', () => {
  assert.equal(teamFlag('한국', 'WORLDCUP'), '🇰🇷 ');
  assert.equal(teamFlag('일본', 'ASIANGAMESFOOTBALL'), '🇯🇵 ');
  assert.equal(teamFlag('한국', 'EPL'), '');
  assert.equal(teamFlag('토트넘', 'WORLDCUP'), '');
  assert.equal(teamFlag(undefined, 'WORLDCUP'), '');
});

test('잉글랜드 등 특수 국기, (남자)/(여자) 접미사', () => {
  assert.ok(teamFlag('잉글랜드', 'UNL').startsWith('🏴'));
  assert.equal(teamFlag('한국 (남자)', 'ASIANGAMESBASEBALL'), '🇰🇷 ');
});

test('알림 팀명: 국가대표면 국기+팀명, 한국어는 한글 국가명·그 외 언어는 영문 사전', () => {
  assert.equal(flagTeam('ko', '한국', 'WORLDCUP'), '🇰🇷 한국');
  assert.match(flagTeam('en', '한국', 'WORLDCUP'), /^🇰🇷 /);
  assert.equal(flagTeam('ko', '갤럭시', 'MLS'), 'LA 갤럭시');
});

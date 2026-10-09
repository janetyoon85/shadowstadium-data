import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonTeamName, TEAM_NAME_CANON } from '../team-name-canon.mjs';

test('ACL/ACL2 의 Air Force 는 알 쿠와(기존 로고·영문명 보유 이름)로 정규화', () => {
  assert.equal(canonTeamName('ACL', 'Air Force'), '알 쿠와');
  assert.equal(canonTeamName('ACL2', 'Air Force'), '알 쿠와');
});

test('다른 리그의 같은 문자열이나 다른 팀 이름은 건드리지 않는다', () => {
  assert.equal(canonTeamName('EPL', 'Air Force'), 'Air Force');
  assert.equal(canonTeamName('ACL', '알 아인'), '알 아인');
  assert.equal(canonTeamName(undefined, undefined), undefined);
});

test('정본 표기는 team-name-en.json / team-logos.json 에 이미 있어야 한다', async () => {
  const fs = await import('node:fs');
  const ten = JSON.parse(fs.readFileSync(new URL('../../team-name-en.json', import.meta.url), 'utf8'));
  const logos = JSON.parse(fs.readFileSync(new URL('../../team-logos.json', import.meta.url), 'utf8'));
  for (const m of Object.values(TEAM_NAME_CANON)) {
    for (const canon of Object.values(m)) {
      assert.ok(ten[canon], `team-name-en.json 에 없음: ${canon}`);
      assert.ok(logos[canon], `team-logos.json 에 없음: ${canon}`);
    }
  }
});

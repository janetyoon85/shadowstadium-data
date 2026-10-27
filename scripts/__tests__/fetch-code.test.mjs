import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fetchCode } from '../lib/fetch-code.mjs';

function makeTarball(nFiles) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-src-'));
  const root = path.join(base, 'repo-abc');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (let i = 0; i < nFiles; i++) fs.writeFileSync(path.join(root, 'scripts', `f${i}.mjs`), `// ${i}\n`);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
  const tgz = path.join(base, 'a.tgz');
  execFileSync('tar', [...(process.platform === 'win32' ? ['--force-local'] : []), '-czf', tgz, '-C', base, 'repo-abc']);
  return fs.readFileSync(tgz);
}
const okFetch = (buf) => async () => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

test('fetchCode — 정상 시 scripts 를 교체하고 package.json 도 복사', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-dest-'));
  fs.mkdirSync(path.join(dest, 'scripts')); fs.writeFileSync(path.join(dest, 'scripts', 'old.mjs'), 'old');
  const r = await fetchCode({ token: 't', dest, fetchFn: okFetch(makeTarball(25)) });
  assert.equal(r.ok, true); assert.equal(r.files, 25);
  assert.ok(!fs.existsSync(path.join(dest, 'scripts', 'old.mjs')));
  assert.ok(fs.existsSync(path.join(dest, 'package.json')));
  assert.ok(!fs.existsSync(path.join(dest, '.scripts.new')));
});
test('fetchCode — 토큰 없음/HTTP 오류/파일 너무 적음은 기존 scripts 유지', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-dest-'));
  fs.mkdirSync(path.join(dest, 'scripts')); fs.writeFileSync(path.join(dest, 'scripts', 'keep.mjs'), 'keep');
  assert.equal((await fetchCode({ token: '', dest })).reason, 'no-token');
  assert.equal((await fetchCode({ token: 't', dest, fetchFn: async () => ({ ok: false, status: 401 }) })).reason, 'http401');
  assert.equal((await fetchCode({ token: 't', dest, fetchFn: okFetch(makeTarball(3)) })).reason, 'invalid');
  assert.ok(fs.existsSync(path.join(dest, 'scripts', 'keep.mjs')));
});

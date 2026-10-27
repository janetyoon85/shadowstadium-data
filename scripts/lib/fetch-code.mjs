// 비공개 크롤러 저장소(shadowstadium-crawler)의 scripts/ 를 받아 dest 에 교체한다(NAS 라이브 폴러용 — GitHub Actions 에서는 .github/actions/fetch-code 가 같은 일을 한다).
// 안전: 받기·풀기·검증(파일 20개 초과)에 모두 성공할 때만 교체한다. 실패하면 기존 scripts/ 를 그대로 둔다(false 반환).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function fetchCode({ token, repo = 'janetyoon85/shadowstadium-crawler', ref = 'main', dest, fetchFn = fetch, minFiles = 20 }) {
  if (!token) return { ok: false, reason: 'no-token' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-'));
  try {
    const r = await fetchFn(`https://api.github.com/repos/${repo}/tarball/${ref}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'shadeside-fetch-code' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) return { ok: false, reason: `http${r.status}` };
    const tgz = path.join(tmp, 'code.tgz');
    fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
    const src = path.join(tmp, 'src');
    fs.mkdirSync(src);
    execFileSync('tar', [...(process.platform === 'win32' ? ['--force-local'] : []), '-xzf', tgz, '-C', src, '--strip-components=1'], { stdio: 'ignore', timeout: 60000 }); // (Windows 의 Git tar 는 'C:' 를 원격 호스트로 오인)
    const scripts = path.join(src, 'scripts');
    if (!fs.existsSync(scripts) || fs.readdirSync(scripts).length <= minFiles) return { ok: false, reason: 'invalid' };
    // 원자적 교체: 새 폴더를 dest 옆에 두고 이름 바꾸기(실행 중인 프로세스가 반쯤 지워진 코드를 읽지 않게).
    const target = path.join(dest, 'scripts');
    const next = path.join(dest, '.scripts.new');
    const old = path.join(dest, '.scripts.old');
    fs.rmSync(next, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
    fs.cpSync(scripts, next, { recursive: true });
    if (fs.existsSync(target)) fs.renameSync(target, old);
    fs.renameSync(next, target);
    fs.rmSync(old, { recursive: true, force: true });
    for (const f of ['package.json', 'package-lock.json']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dest, f));
    return { ok: true, files: fs.readdirSync(target).length };
  } catch (e) {
    return { ok: false, reason: String(e.message).slice(0, 80) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

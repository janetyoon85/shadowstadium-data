// rebase 충돌 난 평면 JSON 객체 파일을 키 단위로 합침(업스트림 + 내 커밋, 같은 키는 내 커밋 우선).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { encoding: 'utf8' }).split('\n').filter(Boolean);
let bad = 0;
for (const f of files) {
  try {
    const up = JSON.parse(execFileSync('git', ['show', `:2:${f}`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    const mine = JSON.parse(execFileSync('git', ['show', `:3:${f}`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    if (Array.isArray(up) || Array.isArray(mine) || typeof up !== 'object' || typeof mine !== 'object') throw new Error('not flat object');
    fs.writeFileSync(f, JSON.stringify({ ...up, ...mine }) + '\n', 'utf8');
    execFileSync('git', ['add', f]);
    console.log('merged', f);
  } catch (e) {
    console.log('cannot merge', f, e.message);
    bad++;
  }
}
process.exit(bad ? 1 : 0);

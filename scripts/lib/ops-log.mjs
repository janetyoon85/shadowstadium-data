// ops-logs 브랜치(429 기록 전용) 읽기/쓰기 헬퍼 — 전부 동기(process 'exit' 핸들러에서도 쓸 수 있게).
// main 과 분리된 브랜치라 크롤러 데이터 푸시와 충돌하지 않는다. 인증은 actions/checkout 이 저장소 설정에 넣어 둔 것을 그대로 쓴다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BOT = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore', timeout: 60000 });

// mutate(dir) 가 true 를 돌려주면(파일을 바꿨으면) 커밋·푸시한다. 푸시가 거절되면 최신으로 다시 받아 처음부터 반복(최대 5회).
export function withOpsLogs(mutate, message, root = process.cwd()) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opslogs-'));
  try {
    for (let i = 0; i < 5; i++) {
      const dir = path.join(tmp, 'w' + i);
      git(['fetch', '--depth', '1', 'origin', 'ops-logs'], root);
      git(['worktree', 'add', '--detach', '-f', dir, 'FETCH_HEAD'], root);
      try {
        if (!mutate(dir)) return true;
        git(['add', '-A'], dir);
        git([...BOT, 'commit', '-q', '-m', message], dir);
        try {
          git(['push', 'origin', 'HEAD:ops-logs'], dir);
          return true;
        } catch {
          /* 다른 쓰기와 경합 — 다시 받아서 재시도 */
        }
      } finally {
        try { git(['worktree', 'remove', '--force', dir], root); } catch { /* 정리 실패는 무시 */ }
      }
    }
    return false;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

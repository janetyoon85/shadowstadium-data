// audit-roster-faces.py 가 "얼굴이 제대로 안 나온 사진"(0)으로 판정한 Commons 사진을 샤드(team-rosters)와 정본(roster-photos.json)에서 뺀다(2026-10-13).
// 사진이 없으면 앱은 이니셜 아바타를 보여주므로, 몸통만 나오는 전신샷보다 낫다. 판정은 URL 단위라 사진이 바뀌면 다시 판정된다.
// FACES_MERGE_DIR: 푸시 충돌 복구 시 보관해 둔 이번 실행의 roster-photo-faces.json 을 합친다(네트워크 없음).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };

export function vetoed(faces, url) { return !!url && faces[url] === 0; }
export function stripVetoed(list, faces) {
  let n = 0;
  for (const p of list) if (p.ph && vetoed(faces, p.ph)) { delete p.ph; n++; }
  return n;
}

async function main() {
  const FACES = path.join(ROOT, 'roster-photo-faces.json');
  let faces = await readJson(FACES, {});
  if (process.env.FACES_MERGE_DIR) {
    const ours = await readJson(path.join(process.env.FACES_MERGE_DIR, 'roster-photo-faces.json'), {});
    for (const [k, v] of Object.entries(ours)) if (faces[k] === undefined) faces[k] = v;
    await fs.writeFile(FACES, JSON.stringify(faces) + '\n', 'utf8');
  }
  let removed = 0;
  for (let i = 0; i < 16; i++) {
    const f = path.join(ROOT, 'team-rosters', `${i.toString(16)}.json`);
    const data = await readJson(f, null);
    if (!data) continue;
    let n = 0;
    for (const list of Object.values(data)) if (Array.isArray(list)) n += stripVetoed(list, faces);
    if (n) { removed += n; await fs.writeFile(f, JSON.stringify(data) + '\n', 'utf8'); }
  }
  const PH = path.join(ROOT, 'roster-photos.json');
  const photos = await readJson(PH, null);
  let pr = 0;
  if (photos) {
    for (const [id, u] of Object.entries(photos)) if (vetoed(faces, u)) { delete photos[id]; pr++; }
    if (pr) await fs.writeFile(PH, JSON.stringify(photos) + '\n', 'utf8');
  }
  const vals = Object.values(faces);
  console.log(`[face-veto] 판정 ${vals.length}건(적합 ${vals.filter((v) => v === 1).length}/부적합 ${vals.filter((v) => v === 0).length}) · 샤드에서 ${removed}장·정본에서 ${pr}장 제거`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

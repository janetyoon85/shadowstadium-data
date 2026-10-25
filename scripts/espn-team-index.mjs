// ESPN 영문 팀명 → 우리 한글 팀명 후보 색인(공용) — verify-against-source.mjs(원본 대조)와 fetch-schedule.mjs(ESPN 경기 매칭의 동률 가르기)가 같이 쓴다.
// 출처: team-name-en.json(한글→영문), team-aliases.json(위키데이터 기반 영문 별칭), ESPN 팀 매핑 3종(TEAMS·ASIA_TEAMS·BATCH2_TEAMS).
import fs from 'node:fs';
import path from 'node:path';
import { TEAMS, normalizeTeamName } from './espn-soccer-teams.mjs';
import { ASIA_TEAMS } from './espn-asia-soccer-teams.mjs';
import { BATCH2_TEAMS } from './espn-world-soccer-teams.mjs';

const rj = (root, f, d) => { try { return JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { return d; } };

// 반환: koSet(영문 팀명) → Set<한글 팀명>
export function buildKoIndex(root) {
  const byEn = new Map();
  const addEn = (en, ko) => { const k = normalizeTeamName(en || ''); if (k && ko) (byEn.get(k) ?? byEn.set(k, new Set()).get(k)).add(ko); };
  for (const [ko, en] of Object.entries(rj(root, 'team-name-en.json', {}))) if (!ko.startsWith('bk:') && !ko.includes('|')) addEn(en, ko);
  for (const [ko, arr] of Object.entries(rj(root, 'team-aliases.json', {}))) for (const al of arr) if (/^[ -~À-ɏ]+$/.test(al) && al.length >= 4) addEn(al, ko);
  for (const grp of [TEAMS, ASIA_TEAMS, BATCH2_TEAMS]) for (const lg of Object.values(grp)) for (const [k, v] of Object.entries(lg || {})) if (v?.ko) { (byEn.get(k) ?? byEn.set(k, new Set()).get(k)).add(v.ko); if (v.en) addEn(v.en, v.ko); }
  return (en) => byEn.get(normalizeTeamName(en || '')) || new Set();
}

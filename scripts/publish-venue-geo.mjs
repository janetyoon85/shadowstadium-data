// 구장 민감 필드(좌표·방향각 등)를 비공개 저장소(shadowstadium-secrets/venue-geo.json.b64)에서 읽어 Firebase RTDB `venues/<id>` 로 게시한다(구장 보호 계획 P-0).
// 앱은 구장 단위(venues/<id>)로만 읽고 전체 목록 읽기는 규칙으로 막는다. 쓰기는 서비스 계정(관리자)만.
// 실행: node scripts/publish-venue-geo.mjs [--dry]   (PRIVATE_DATA_TOKEN, FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL)
import admin from './firebase-admin-compat.mjs';

const REPO = 'janetyoon85/shadowstadium-secrets';
const FILE = 'venue-geo.json.b64';

export function validateGeo(geo) {
  if (!geo || typeof geo !== 'object') throw new Error('venue-geo 형식 오류');
  const ids = Object.keys(geo);
  if (ids.length < 100) throw new Error(`구장 수가 너무 적음(${ids.length}) — 잘못된 파일로 덮어쓰지 않도록 중단`);
  for (const id of ids) {
    if (/[.$#[\]/]/.test(id)) throw new Error(`RTDB 키로 쓸 수 없는 id: ${id}`);
    const g = geo[id];
    if (typeof g.lat !== 'number' || typeof g.lon !== 'number' || Math.abs(g.lat) > 90 || Math.abs(g.lon) > 180) throw new Error(`좌표 오류: ${id}`);
  }
  return ids.length;
}

async function loadGeo() {
  const token = process.env.PRIVATE_DATA_TOKEN;
  if (!token) throw new Error('PRIVATE_DATA_TOKEN 없음');
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'shadeside-publish-venue-geo' } });
  if (!r.ok) throw new Error(`secrets 읽기 실패 HTTP ${r.status}`);
  return JSON.parse(Buffer.from((await r.text()).trim(), 'base64').toString('utf8'));
}

async function main() {
  const geo = await loadGeo();
  const n = validateGeo(geo);
  console.log(`[venue-geo] ${n}개 구장 검증 통과`);
  if (process.argv.includes('--dry')) return;
  const url = process.env.FIREBASE_DATABASE_URL;
  if (!url) throw new Error('FIREBASE_DATABASE_URL 없음');
  const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: url });
  const { getDatabase } = await import('firebase-admin/database');
  const db = getDatabase(app);
  await db.ref('venues').set(geo);
  await db.ref('venues_meta').set({ ts: Date.now(), count: n });
  console.log(`[venue-geo] venues/ 에 ${n}건 게시`);
  await db.goOffline();
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('publish-venue-geo.mjs')) await main();

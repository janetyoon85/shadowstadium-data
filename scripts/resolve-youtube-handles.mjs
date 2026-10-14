// 채널 핸들 후보를 channels.list(forHandle, 1유닛/건)로 확인해 채널 ID·이름·구독자·국가를 출력한다(2026-10-13 한국어 공식 채널 후보 조사용, 사람이 보고 허용 목록에 넣을지 결정).
const API_KEY = process.env.YOUTUBE_API_KEY;
const handles = (process.env.HANDLES || '').split(',').map((h) => h.trim().replace(/^@/, '')).filter(Boolean);
if (!API_KEY) { console.error('YOUTUBE_API_KEY required'); process.exit(1); }
// LIST_IDS: 채널 ID 목록의 최근 업로드 제목(playlistItems, 1유닛/페이지)을 출력 — 허용 목록에 넣기 전 어떤 영상을 올리는지 확인.
for (const id of (process.env.LIST_IDS || '').split(',').map((x) => x.trim()).filter(Boolean)) {
  // LIST_PAGES(기본 1)만큼 다음 페이지까지 읽고, LIST_GREP(정규식)이 있으면 제목이 맞는 것만 출력한다(오래된 영상이 왜 안 붙었는지 볼 때).
  let items = [], token = '', status = 0;
  for (let pg = 0; pg < Math.max(1, Number(process.env.LIST_PAGES) || 1); pg++) {
    const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?' + new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId: 'UU' + id.slice(2), key: API_KEY, ...(token ? { pageToken: token } : {}) }), { signal: AbortSignal.timeout(20000) });
    status = r.status;
    if (!r.ok) break;
    const j = await r.json();
    items.push(...(j.items || []));
    token = j.nextPageToken;
    if (!token) break;
  }
  console.log(`== ${id} http ${status} items=${items.length}`);
  if (status !== 200) continue;
  if (process.env.LIST_GREP) { const re = new RegExp(process.env.LIST_GREP, 'i'); items = items.filter((it) => re.test(it.snippet?.title || '')); console.log(`grep ${process.env.LIST_GREP} → ${items.length}건`); }
  // 한국 재생 가능 여부(videos.list, 50개당 1유닛)도 같이 표시 — 허용 목록에 넣기 전에 한국에서 열리는 채널인지 확인.
  const kr = {};
  const vids = items.map((it) => it.snippet?.resourceId?.videoId).filter(Boolean);
  if (vids.length) {
    const vr = await fetch('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ part: 'contentDetails', id: vids.join(','), key: API_KEY }), { signal: AbortSignal.timeout(20000) });
    if (vr.ok) for (const v of (await vr.json()).items || []) { const rr = v.contentDetails?.regionRestriction; kr[v.id] = rr ? (rr.allowed ? rr.allowed.includes('KR') : !(rr.blocked || []).includes('KR')) : true; }
  }
  let okN = 0;
  for (const it of items) { const k = kr[it.snippet?.resourceId?.videoId]; if (k) okN++; console.log(`${(it.snippet?.publishedAt || '').slice(0, 10)} [${k === undefined ? '?' : k ? 'KR가능' : 'KR막힘'}] ${it.snippet?.title}`); }
  console.log(`-- ${id}: 한국 재생 가능 ${okN}/${items.length}`);
}
for (const h of handles) {
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?' + new URLSearchParams({ part: 'id,snippet,statistics', forHandle: h, key: API_KEY }), { signal: AbortSignal.timeout(20000) });
    if (r.status === 403 || r.status === 429) { console.log(`STOP http ${r.status}`); break; }
    const it = ((await r.json()).items || [])[0];
    console.log(it ? `@${h} -> ${it.id} | ${it.snippet?.title} | subs=${it.statistics?.subscriberCount} | videos=${it.statistics?.videoCount} | country=${it.snippet?.country || '-'} | ${(it.snippet?.description || '').replace(/\s+/g, ' ').slice(0, 80)}` : `@${h} -> (없음)`);
  } catch (e) { console.log(`@${h} -> error ${e.message}`); }
  await new Promise((r) => setTimeout(r, 300));
}

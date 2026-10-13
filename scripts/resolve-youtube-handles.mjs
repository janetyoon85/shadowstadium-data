// 채널 핸들 후보를 channels.list(forHandle, 1유닛/건)로 확인해 채널 ID·이름·구독자·국가를 출력한다(2026-10-13 한국어 공식 채널 후보 조사용, 사람이 보고 허용 목록에 넣을지 결정).
const API_KEY = process.env.YOUTUBE_API_KEY;
const handles = (process.env.HANDLES || '').split(',').map((h) => h.trim().replace(/^@/, '')).filter(Boolean);
if (!API_KEY) { console.error('YOUTUBE_API_KEY required'); process.exit(1); }
// LIST_IDS: 채널 ID 목록의 최근 업로드 제목(playlistItems, 1유닛/페이지)을 출력 — 허용 목록에 넣기 전 어떤 영상을 올리는지 확인.
for (const id of (process.env.LIST_IDS || '').split(',').map((x) => x.trim()).filter(Boolean)) {
  const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?' + new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId: 'UU' + id.slice(2), key: API_KEY }), { signal: AbortSignal.timeout(20000) });
  console.log(`== ${id} http ${r.status}`);
  if (!r.ok) continue;
  for (const it of (await r.json()).items || []) console.log(`${(it.snippet?.publishedAt || '').slice(0, 10)} ${it.snippet?.title}`);
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

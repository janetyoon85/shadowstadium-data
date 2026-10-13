// 채널 핸들 후보를 channels.list(forHandle, 1유닛/건)로 확인해 채널 ID·이름·구독자·국가를 출력한다(2026-10-13 한국어 공식 채널 후보 조사용, 사람이 보고 허용 목록에 넣을지 결정).
const API_KEY = process.env.YOUTUBE_API_KEY;
const handles = (process.env.HANDLES || '').split(',').map((h) => h.trim().replace(/^@/, '')).filter(Boolean);
if (!API_KEY) { console.error('YOUTUBE_API_KEY required'); process.exit(1); }
for (const h of handles) {
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?' + new URLSearchParams({ part: 'id,snippet,statistics', forHandle: h, key: API_KEY }), { signal: AbortSignal.timeout(20000) });
    if (r.status === 403 || r.status === 429) { console.log(`STOP http ${r.status}`); break; }
    const it = ((await r.json()).items || [])[0];
    console.log(it ? `@${h} -> ${it.id} | ${it.snippet?.title} | subs=${it.statistics?.subscriberCount} | videos=${it.statistics?.videoCount} | country=${it.snippet?.country || '-'} | ${(it.snippet?.description || '').replace(/\s+/g, ' ').slice(0, 80)}` : `@${h} -> (없음)`);
  } catch (e) { console.log(`@${h} -> error ${e.message}`); }
  await new Promise((r) => setTimeout(r, 300));
}

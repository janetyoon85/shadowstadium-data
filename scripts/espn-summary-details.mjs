// scoreboard의 comp.details가 스코어보다 늦게 채워지는 ESPN 지연 보정 — 골 수가 스코어 합보다 적을 때만
// summary(header.competitions[0].details)로 대체(participants→athletesInvolved 형태로 변환).
export async function fillDetailsFromSummary(comp, slug, eventId, hs, as) {
  const goals = (comp.details || []).filter((d) => d.scoringPlay && !d.shootout).length;
  if (!Number.isFinite(hs) || !Number.isFinite(as) || goals >= hs + as) return;
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const j = await res.json();
    const det = j.header?.competitions?.[0]?.details;
    if (!Array.isArray(det)) return;
    const conv = det.map((d) => ({ ...d, athletesInvolved: d.athletesInvolved || (d.participants || []).map((p) => p.athlete).filter(Boolean) }));
    if (conv.filter((d) => d.scoringPlay && !d.shootout).length > goals) comp.details = conv;
  } catch { /* 보정 실패는 무시 */ }
}

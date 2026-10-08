// ESPN 축구 경기의 대회 단계(플레이오프/준결승/결승 등)를 앱의 phaseCode/leg 규칙으로 변환.
// ESPN 은 이벤트의 season.slug 에 단계명("eastern-conference-playoffs---final", "apertura---semifinals")을 싣고,
// 홈앤어웨이는 competitions[0].notes[].headline 에 "1st Leg"/"2nd Leg" 로 싣는다. 모르는 slug 는 라벨 없음(보수적).
export function espnStage(e, comp) {
  const slug = String(e?.season?.slug || '').toLowerCase();
  const hl = (comp?.notes || []).map((n) => n.headline || '').join(' ');
  let phaseCode;
  if (/promotion/.test(slug)) phaseCode = 'PRO';
  else if (/relegation/.test(slug)) phaseCode = 'REL';
  else if (/round-of-32/.test(slug)) phaseCode = 'T32';
  else if (/round-of-16|last-16/.test(slug)) phaseCode = 'T16';
  else if (/quarter/.test(slug)) phaseCode = 'T8';
  else if (/semi/.test(slug)) phaseCode = 'T4';
  else if (/conference.*final/.test(slug)) phaseCode = 'CF';
  else if (/conference.*round-one|round-one/.test(slug)) phaseCode = 'R1';
  else if (/round-two/.test(slug)) phaseCode = 'R2';
  else if (/round-three/.test(slug)) phaseCode = 'R3';
  else if (/final-stage|final-passage|second-phase|second-round|closing-round|championship-round|playoff-round/.test(slug)) phaseCode = 'FR';
  else if (/mls-cup|(^|[-])finals?($|[-])/.test(slug)) phaseCode = 'T2';
  else if (/play-?offs?|seed-game|liguilla/.test(slug)) phaseCode = 'PO';
  const out = {};
  if (phaseCode) out.phaseCode = phaseCode;
  const leg = /\b([12])(?:st|nd) Leg\b/i.exec(hl)?.[1];
  if (leg && phaseCode) out.leg = Number(leg);
  // 2차전(합산 확정 경기)의 합계 스코어 — ESPN 은 competitors[].aggregateScore 에 두 경기 합계를 싣는다
  // (2026-10-08 실측: UCL/멕시코 리가 등 2차전에만 존재, 1차전은 없음). 앱은 leg===2 에서만 표시.
  if (out.leg === 2) {
    for (const t of comp?.competitors || []) {
      const v = Number(t?.aggregateScore);
      if (!Number.isFinite(v)) continue;
      if (t.homeAway === 'home') out.homeAggregateScore = v;
      else if (t.homeAway === 'away') out.awayAggregateScore = v;
    }
    if (typeof out.homeAggregateScore !== 'number' || typeof out.awayAggregateScore !== 'number') {
      delete out.homeAggregateScore;
      delete out.awayAggregateScore;
    }
  }
  return out;
}

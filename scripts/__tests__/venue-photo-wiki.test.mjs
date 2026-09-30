import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchVenuePhotoFromWikipedia, isPlausibleStadiumDescription } from '../venue-photo-wiki.mjs';

function mockFetch(routes) {
  return async (url) => {
    for (const [pattern, body] of routes) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
        return { ok: true, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// 실측 재현(2026-09-30, "근데어짜피국대경기도클럽구장에서 시합하거든" 리포트로 위키 폴백 도입):
// 검색으로 찾은 문서가 정확한 구장 문서면 썸네일을 그대로 반환.
test('fetchVenuePhotoFromWikipedia - 구장 문서를 정확히 찾으면 썸네일 반환', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/list=search&srsearch=Stade%20de%20France/, { query: { search: [{ title: 'Stade de France' }] } }],
    ['/page/summary/Stade_de_France', { description: 'Stadium in Saint-Denis, Paris, France', thumbnail: { source: 'https://example.com/thumb.jpg' } }],
  ]);
  const result = await fetchVenuePhotoFromWikipedia('Stade de France');
  assert.equal(result, 'https://example.com/thumb.jpg');
});

// 회귀 방지(2026-09-30) — 실측 확인: 완전히 동일한 검색어("Energizer Park")로 코드 변경 없이
// 반복 호출해도 위키 검색 백엔드가 1위 결과로 "Energizer Park"(정답)와 "City Park, Saint
// Louis"(엉뚱한 오답)를 실행마다 다르게 반환하는 걸 확인(백엔드 복제본 간 랭킹 불일치로 추정).
// srlimit=1로 1위만 받으면 이 불안정에 그대로 노출되므로, 상위 5개 중 검색어와 제목이 정확히
// 일치하는 후보가 있으면 그걸 우선 써야 함 — 순위가 몇 위든 상관없이 항상 같은 결과가 나옴.
test('fetchVenuePhotoFromWikipedia - 검색 랭킹이 불안정해도 제목이 정확히 일치하는 후보를 우선 선택', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/list=search&srsearch=Energizer%20Park/, { query: { search: [
      { title: 'City Park, Saint Louis' }, // 1위(오답, fuzzy 매치)여도 무시해야 함.
      { title: 'Energizer Park' }, // 정확히 일치 — 순위와 무관하게 이걸 써야 함.
    ] } }],
    ['/page/summary/Energizer_Park', { description: 'Soccer stadium in St. Louis, United States', thumbnail: { source: 'https://example.com/energizer.jpg' } }],
    ['/page/summary/City_Park', { description: 'Park in St. Louis, Missouri', thumbnail: { source: 'https://example.com/wrong.jpg' } }],
  ]);
  const result = await fetchVenuePhotoFromWikipedia('Energizer Park');
  assert.equal(result, 'https://example.com/energizer.jpg');
});

// 실사례(2026-09-30): "Field of Dreams" 검색이 실제 구장 대신 1989년 영화 문서로 감(동명이인/
// 동명장소) — description에 구장 관련 키워드가 없으면 폐기해야 함(틀린 사진보단 없는 게 낫다).
test('fetchVenuePhotoFromWikipedia - 검색 결과가 동명의 다른 대상(영화 등)이면 폐기', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/list=search&srsearch=Field%20of%20Dreams/, { query: { search: [{ title: 'Field of Dreams' }] } }],
    ['/page/summary/Field_of_Dreams', { description: '1989 film by Phil Alden Robinson', thumbnail: { source: 'https://example.com/poster.jpg' } }],
  ]);
  const result = await fetchVenuePhotoFromWikipedia('Field of Dreams');
  assert.equal(result, null);
});

// 실사례(2026-09-30, "구장사진... 이거" 리포트): 에너자이저 파크(세인트루이스 시티 SC 구장)에
// 전혀 무관한 "City Park, Saint Louis"(그냥 일반 공원) 사진이 붙어있었음 — description이 그냥
// "Park in St. Louis, Missouri"로 스포츠 단어가 전혀 없었는데도 "park"만으로 통과시켰던 버그.
test('fetchVenuePhotoFromWikipedia - "park"만 있고 스포츠 맥락 단어가 없으면(동명 일반공원 등) 폐기', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/list=search&srsearch=Energizer%20Park/, { query: { search: [{ title: 'City Park, Saint Louis' }] } }],
    ['/page/summary/City_Park', { description: 'Park in St. Louis, Missouri', thumbnail: { source: 'https://example.com/park.jpg' } }],
  ]);
  const result = await fetchVenuePhotoFromWikipedia('Energizer Park');
  assert.equal(result, null);
});

test('isPlausibleStadiumDescription - stadium/arena 등은 스포츠 단어 없이도 단독으로 인정(STRONG)', () => {
  assert.equal(isPlausibleStadiumDescription('Stadium in Saint-Denis, Paris, France'), true);
  assert.equal(isPlausibleStadiumDescription('Multi-purpose stadium in Al Rayyan, Qatar'), true);
});

test('isPlausibleStadiumDescription - park/field/venue 등은 스포츠 맥락 단어와 같이 있을 때만 인정(WEAK)', () => {
  assert.equal(isPlausibleStadiumDescription('Baseball park in Metro Atlanta, Georgia'), true);
  assert.equal(isPlausibleStadiumDescription('Sports venue in Kenya'), true);
  assert.equal(isPlausibleStadiumDescription('Park in St. Louis, Missouri'), false);
  assert.equal(isPlausibleStadiumDescription('1989 film by Phil Alden Robinson'), false);
});

// 회귀 방지(2026-09-30, 재검증 배치 중 발견한 가양성) — Icahn Stadium(뉴욕 실제 육상경기장)이
// description "Track and field facility in Manhattan, New York"에 어떤 컨텍스트 단어도 안 걸려
// 잘못 탈락했음 — "track" 추가로 다시 통과해야 함.
test('isPlausibleStadiumDescription - 육상(track and field) 시설도 인정(회귀 방지: Icahn Stadium)', () => {
  assert.equal(isPlausibleStadiumDescription('Track and field facility in Manhattan, New York'), true);
});

test('fetchVenuePhotoFromWikipedia - 검색 결과 자체가 없으면 null', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/list=search/, { query: { search: [] } }],
  ]);
  const result = await fetchVenuePhotoFromWikipedia('존재하지않는아주희귀한구장이름');
  assert.equal(result, null);
});

test('fetchVenuePhotoFromWikipedia - 썸네일이 없으면(무한 리다이렉트/이미지 없는 문서) originalimage로 폴백, 그마저 없으면 null', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = mockFetch([
    [/list=search&srsearch=Windsor%20Park/, { query: { search: [{ title: 'Windsor Park' }] } }],
    ['/page/summary/Windsor_Park', { description: 'Football stadium in Belfast, Northern Ireland', originalimage: { source: 'https://example.com/original.jpg' } }],
  ]);
  const result = await fetchVenuePhotoFromWikipedia('Windsor Park');
  assert.equal(result, 'https://example.com/original.jpg');
});

// 버그 수정(2026-09-30, "아직부족해 100프로백필다채워야지" 재조사 중 발견) — 예전엔 네트워크
// 실패/타임아웃을 null(확정적으로 없음)로 캐시해버려서, Groupama Arena/MCH Arena처럼 실제로는
// 멀쩡히 찾아지는 유명 구장들이 일시적 실패 한 번 때문에 영구 null로 굳어있었음. 이제 undefined
// (재시도 대상)로 명확히 구분 — 호출부가 이 값을 캐시하지 않아야 다음 실행에 다시 시도됨.
test('fetchVenuePhotoFromWikipedia - API 실패(네트워크 등)는 undefined(재시도 대상, null과 구분)', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => { throw new Error('network down'); };
  const result = await fetchVenuePhotoFromWikipedia('Anything');
  assert.equal(result, undefined);
});

test('fetchVenuePhotoFromWikipedia - 검색 API가 일시적으로 !ok 응답이면 undefined(재시도 대상)', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  const result = await fetchVenuePhotoFromWikipedia('Anything');
  assert.equal(result, undefined);
});

test('fetchVenuePhotoFromWikipedia - 요약 API가 일시적으로 !ok 응답이면 undefined(재시도 대상)', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  let call = 0;
  globalThis.fetch = async () => {
    call++;
    if (call === 1) return { ok: true, json: async () => ({ query: { search: [{ title: 'Some Stadium' }] } }) };
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const result = await fetchVenuePhotoFromWikipedia('Some Stadium');
  assert.equal(result, undefined);
});

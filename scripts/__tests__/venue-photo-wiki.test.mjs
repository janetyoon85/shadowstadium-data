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

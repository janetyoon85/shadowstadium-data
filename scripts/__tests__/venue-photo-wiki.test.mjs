import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchVenuePhotoFromWikipedia } from '../venue-photo-wiki.mjs';

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

test('fetchVenuePhotoFromWikipedia - API 실패(네트워크 등)는 안전하게 null', async (t) => {
  const origFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = origFetch; });
  globalThis.fetch = async () => { throw new Error('network down'); };
  const result = await fetchVenuePhotoFromWikipedia('Anything');
  assert.equal(result, null);
});

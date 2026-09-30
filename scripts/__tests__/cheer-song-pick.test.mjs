import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheerSongQuery, pickCheerSong } from '../cheer-song-pick.mjs';

const item = (id, title) => ({ id: { videoId: id }, snippet: { title } });

test('buildCheerSongQuery - 팀+이름+접미어', () => {
  assert.equal(buildCheerSongQuery('LG', '김현수'), 'LG 김현수 응원가');
  assert.equal(buildCheerSongQuery(undefined, '김현수'), '김현수 응원가');
  assert.equal(buildCheerSongQuery('Liverpool', 'Mohamed Salah', 'song chant'), 'Liverpool Mohamed Salah song chant');
});
test('pickCheerSong - 이름과 응원가가 제목에 모두 있는 첫 영상', () => {
  const r = pickCheerSong([item('a', '2026 KBO 하이라이트'), item('b', '[LG] 김 현수 응원가 (가사)')], { full: '김현수', songWords: ['응원가'] });
  assert.deepEqual(r, { v: 'b', t: '[LG] 김 현수 응원가 (가사)' });
});
test('pickCheerSong - 이름 없거나 응원가 없으면 null', () => {
  const spec = { full: '김현수', songWords: ['응원가'] };
  assert.equal(pickCheerSong([item('a', '박해민 응원가')], spec), null);
  assert.equal(pickCheerSong([item('a', '김현수 홈런 모음')], spec), null);
  assert.equal(pickCheerSong([], spec), null);
});
test('pickCheerSong - 영문 이름은 악센트 무시, 성만 같으면 팀명까지 있어야 채택', () => {
  const spec = { full: 'Aarón Escandell', surname: 'Escandell', teamEn: 'Oviedo', songWords: ['song', 'chant'] };
  assert.ok(pickCheerSong([item('a', 'Aaron Escandell chant')], spec));
  assert.equal(pickCheerSong([item('a', 'Escandell chant')], spec), null);
  assert.ok(pickCheerSong([item('a', 'Real Oviedo Escandell song')], spec));
});

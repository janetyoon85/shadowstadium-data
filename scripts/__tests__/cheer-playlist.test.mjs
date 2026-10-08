import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchChannelVideos, uploadsPlaylistId, KBO_CHEER_CHANNELS } from '../cheer-song-pick.mjs';

const vid = (v, t, p = 1) => ({ v, t, p });

test('업로드 재생목록 ID: 채널 UC… → UU…', () => {
  assert.equal(uploadsPlaylistId('UC0KYcMjlFq08UjK2cWkB9Cg'), 'UU0KYcMjlFq08UjK2cWkB9Cg');
  assert.equal(KBO_CHEER_CHANNELS.length, 2);
});

test('선수 이름 + 응원가 + 소속 팀이 제목에 모두 있어야 매칭', () => {
  const videos = [vid('a1', '두산 베어스 박찬호 응원가 Music Video'), vid('a2', 'KT 위즈 최원준 응원가 Music Video')];
  const out = matchChannelVideos(videos, [
    { id: 'kbo:b:1', name: '박찬호', team: '두산' },
    { id: 'kbo:b:2', name: '최원준', team: 'KT' },
    { id: 'kbo:b:3', name: '김하성', team: 'SSG' }, // 영상 없음
  ]);
  assert.deepEqual(out, { 'kbo:b:1': { v: 'a1', t: '두산 베어스 박찬호 응원가 Music Video' }, 'kbo:b:2': { v: 'a2', t: 'KT 위즈 최원준 응원가 Music Video' } });
});

test('동명이인은 팀으로 구분 (김현수 LG vs KT)', () => {
  const videos = [vid('lg', 'LG 트윈스 김현수 응원가'), vid('kt', 'KT 위즈 김현수 신규 응원가 (고음질)')];
  const out = matchChannelVideos(videos, [
    { id: 'kbo:b:lg', name: '김현수', team: 'LG' },
    { id: 'kbo:b:kt', name: '김현수', team: 'KT' },
  ]);
  assert.equal(out['kbo:b:lg'].v, 'lg');
  assert.equal(out['kbo:b:kt'].v, 'kt');
});

test('영문 약칭은 단어 경계로 확인 (NC가 다른 단어에 우연히 포함돼도 매칭 안 됨)', () => {
  const videos = [vid('x', 'dance NCT 김성욱 응원가')];
  assert.deepEqual(matchChannelVideos(videos, [{ id: 'kbo:b:9', name: '김성욱', team: 'NC' }]), {});
  const ok = [vid('y', 'NC 다이노스 김성욱 응원가 Music Video')];
  assert.equal(matchChannelVideos(ok, [{ id: 'kbo:b:9', name: '김성욱', team: 'NC' }])['kbo:b:9'].v, 'y');
});

test('후보가 여럿이면 AI 생성곡보다 일반 응원가, 그다음 최신', () => {
  const videos = [
    vid('ai', '키움 하현승 AI 응원가', 300),
    vid('old', '키움 히어로즈 하현승 응원가 Music Video', 100),
    vid('new', '키움 히어로즈 하현승 응원가 (고음질)', 200),
  ];
  const out = matchChannelVideos(videos, [{ id: 'kbo:p:1', name: '하현승', team: '키움' }]);
  assert.equal(out['kbo:p:1'].v, 'new');
});

test('응원가가 아니거나 패러디·모음은 제외, 이적 전 팀 제목만 있으면 건너뜀', () => {
  const videos = [
    vid('n', '삼성 라이온즈 강민호 하이라이트'),
    vid('p', '삼성 라이온즈 강민호 응원가 패러디'),
    vid('m', '삼성 라이온즈 선수 응원가 모음'),
    vid('old', '前 KT 위즈 강백호 응원가 Music Video'),
  ];
  assert.deepEqual(matchChannelVideos(videos, [{ id: 'k1', name: '강민호', team: '삼성' }]), {});
  assert.deepEqual(matchChannelVideos(videos, [{ id: 'k2', name: '강백호', team: '한화' }]), {}); // 현재 팀 제목이 없음
});

test('빈 입력/이름·팀 누락은 안전하게 빈 결과', () => {
  assert.deepEqual(matchChannelVideos([], [{ id: 'a', name: '가', team: '나' }]), {});
  assert.deepEqual(matchChannelVideos(null, null), {});
  assert.deepEqual(matchChannelVideos([vid('v', '두산 박찬호 응원가')], [{ id: 'a', name: '', team: '두산' }, { id: 'b', name: '박찬호' }]), {});
});

// ── 백테스트에서 발견된 오탐 회귀 방지 (2026-10-09) ──
test('한글 자모 부분일치 오탐 방지: 김동주 ≠ 김동준', () => {
  const videos = [vid('x', '두산 베어스 김동준 응원가 (고음질)')];
  assert.deepEqual(matchChannelVideos(videos, [{ id: 'k1', name: '김동주', team: '두산' }]), {});
  assert.equal(matchChannelVideos(videos, [{ id: 'k2', name: '김동준', team: '두산' }]).k2.v, 'x');
});

test('해시태그로만 이름이 걸린 제목은 제외', () => {
  const videos = [vid('h', '삼성 라이온즈 응원가 - 승리의 힘! #구자욱 #후라도')];
  assert.deepEqual(matchChannelVideos(videos, [{ id: 'k1', name: '구자욱', team: '삼성' }]), {});
});

test('다른 선수 곡을 언급하는 제목은 제외 (이름이 첫 응원가 뒤에 나옴)', () => {
  const videos = [vid('o', 'SSG랜더스 노경은 응원가 - 기존 박성한 응원가 (251024 섬곤전)')];
  assert.deepEqual(matchChannelVideos(videos, [{ id: 'k1', name: '박성한', team: 'SSG' }]), {});
  assert.equal(matchChannelVideos(videos, [{ id: 'k2', name: '노경은', team: 'SSG' }]).k2.v, 'o');
});

test('여러 선수를 나열한 모음·재탕 제목은 제외', () => {
  const videos = [vid('m', '한화 이글스 "오재원 • 이도훈 • 장규현 • 유민" 재탕으로 띵곡 응원가 탄생!!')];
  assert.deepEqual(matchChannelVideos(videos, [{ id: 'k1', name: '유민', team: '한화' }]), {});
});

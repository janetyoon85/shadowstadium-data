import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, findCandidates, collectLinks, visibleOf } from '../ticket-link-health.mjs';

test('classify — 404/410 은 죽음, 봇 차단·서버 오류·접속 오류는 판정 불가', () => {
  assert.equal(classify({ status: 404 }), 'dead');
  assert.equal(classify({ status: 410 }), 'dead');
  for (const status of [0, 401, 403, 429, 500, 503]) assert.equal(classify({ status }), 'unknown', String(status));
  assert.equal(classify({ status: 200, title: 'Just a moment...' }), 'unknown');
});

test('classify — 200 이어도 본문 첫머리가 not found 면 죽음(삼성·포르투·리가 데 키토 실사례)', () => {
  assert.equal(classify({ status: 200, title: '', visibleText: '현재 이용에 불편을 드려 죄송합니다. 현재 일시적인 오류이거나 요청하신 페이지를 찾을 수 없습니다.' }), 'dead');
  // 구단 오류 페이지의 오탈자("찾울")까지 잡는다 — 삼성 라이온즈 실사례
  assert.equal(classify({ status: 200, title: '삼성라이온즈', visibleText: '현재 일시적인 오류이거나 요청하신 페이지를 찾울 수 없습니다.' }), 'dead');
  assert.equal(classify({ status: 200, title: '', visibleText: 'FC Porto Clube Futebol 404 Página não encontrada A página que procura' }), 'dead');
  assert.equal(classify({ status: 200, title: '', visibleText: '404 Page not found' }), 'dead');
  assert.equal(classify({ status: 200, title: 'Tickets', visibleText: '경기 일정과 예매 안내. 2026-27 시즌 입장권 예매는 7일 전 오전 10시에 시작됩니다.' }), 'ok');
  // 본문 깊숙한 곳(첫 1500자 밖)의 "404"는 무시
  assert.equal(classify({ status: 200, title: 'Tickets', visibleText: 'x'.repeat(1600) + ' 404 Page not found' }), 'ok');
});

test('findCandidates — 같은 사이트의 예매 링크를 점수순으로, SNS·첫 화면은 제외', () => {
  const html = `
    <a href="/about">About</a>
    <a href="/ticket/info">Tickets</a>
    <a href="https://www.ticketlink.co.kr/sports/baseball/57">티켓 예매</a>
    <a href="https://facebook.com/team/tickets">tickets</a>
    <a href="/">Home tickets</a>
    <a href="javascript:void(0)">티켓</a>`;
  const c = findCandidates(html, 'https://club.example.com/');
  assert.equal(c[0], 'https://club.example.com/ticket/info');
  assert.ok(c.includes('https://www.ticketlink.co.kr/sports/baseball/57'));
  assert.ok(!c.some((u) => /facebook/.test(u)));
  assert.ok(!c.includes('https://club.example.com/'));
});

test('collectLinks — 중첩 구조의 URL 만 모은다(onsite·버전 숫자 제외)', () => {
  const obj = { v: 2, KBO: { KIA: 'https://a.example/x', 삼성: 'https://b.example/y' }, LALIGA: { 바예카노: 'onsite' }, BK: { defaults: { WNBA: 'https://w.example/' } } };
  assert.deepEqual(collectLinks(obj).map((l) => l.path.join('/')), ['KBO/KIA', 'KBO/삼성', 'BK/defaults/WNBA']);
  assert.equal(visibleOf('<p>a&nbsp;<b>b</b></p><script>x</script>'), 'a b');
});

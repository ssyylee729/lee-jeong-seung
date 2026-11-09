import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeImageUrl } from '../../public/lib/thumb.js';
import {
  assertPublicUrl,
  dropSharedImages,
  enrichWithThumbnails,
  extractImageUrl,
  findThumbnail,
  isPrivateAddress,
  safeFetch,
} from '../lib/thumbnail.mjs';

const BASE = 'https://shop.example.com/products/1';

test('og:image 추출: 속성 순서·따옴표·엔티티·상대경로', () => {
  assert.equal(extractImageUrl('<meta property="og:image" content="https://cdn.example.com/a.jpg">', BASE), 'https://cdn.example.com/a.jpg');
  // content 가 property 보다 앞에 오는 경우, 작은따옴표
  assert.equal(extractImageUrl("<meta content='https://cdn.example.com/b.jpg' property='og:image' />", BASE), 'https://cdn.example.com/b.jpg');
  // &amp; 디코딩
  assert.equal(
    extractImageUrl('<meta property="og:image" content="https://cdn.example.com/c.jpg?w=300&amp;h=400">', BASE),
    'https://cdn.example.com/c.jpg?w=300&h=400',
  );
  // 상대 경로와 //host 형식
  assert.equal(extractImageUrl('<meta property="og:image" content="/img/p.png">', BASE), 'https://shop.example.com/img/p.png');
  assert.equal(extractImageUrl('<meta property="og:image" content="//cdn.example.com/p.png">', BASE), 'https://cdn.example.com/p.png');
  // name= 으로 쓴 twitter:image
  assert.equal(extractImageUrl('<meta name="twitter:image" content="https://cdn.example.com/t.jpg">', BASE), 'https://cdn.example.com/t.jpg');
});

test('og:image 추출: 우선순위와 거부 대상', () => {
  const both = '<meta name="twitter:image" content="https://x.com/t.jpg"><meta property="og:image" content="https://x.com/o.jpg">';
  assert.equal(extractImageUrl(both, BASE), 'https://x.com/o.jpg'); // 순서와 상관없이 og:image 우선
  assert.equal(extractImageUrl('<meta property="og:image" content="http://x.com/insecure.jpg">', BASE), null); // http 는 혼합 콘텐츠라 거부
  assert.equal(extractImageUrl('<meta property="og:image" content="javascript:alert(1)">', BASE), null);
  assert.equal(extractImageUrl('<meta property="og:image" content="data:image/png;base64,AAAA">', BASE), null);
  assert.equal(extractImageUrl('<meta property="og:image" content="https://user:pw@x.com/a.jpg">', BASE), null);
  assert.equal(extractImageUrl('<meta property="og:title" content="제목">', BASE), null);
  assert.equal(extractImageUrl('<html>메타 없음</html>', BASE), null);
  // 첫 후보가 http 라도 다음 후보(https)를 쓴다
  const fallback = '<meta property="og:image" content="http://x.com/a.jpg"><meta name="twitter:image" content="https://x.com/b.jpg">';
  assert.equal(extractImageUrl(fallback, BASE), 'https://x.com/b.jpg');
});

test('내부망·메타데이터 주소는 막는다', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', 'ff02::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '203.0.113.5', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.equal(isPrivateAddress('not-an-ip'), true);
});

test('assertPublicUrl: 스킴·계정정보·IP·호스트명 해석 결과를 검사한다', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const privateLookup = async () => [{ address: '10.0.0.5', family: 4 }];
  const mixedLookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];

  await assertPublicUrl('https://example.com/a', { lookupFn: publicLookup });
  for (const bad of ['file:///etc/passwd', 'ftp://example.com/a', 'gopher://x', 'javascript:alert(1)', 'not a url', 'https://u:p@example.com/']) {
    await assert.rejects(assertPublicUrl(bad, { lookupFn: publicLookup }), undefined, bad);
  }
  // IP 를 직접 쓰는 경우 (10진수·16진수 표기도 URL 파서가 정규화해서 걸러진다)
  for (const bad of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://2130706433/', 'http://0x7f.1/', 'http://192.168.1.1/']) {
    await assert.rejects(assertPublicUrl(bad, { lookupFn: publicLookup }), /내부 주소/, bad);
  }
  // 이름은 평범한데 내부 주소로 해석되는 호스트
  await assert.rejects(assertPublicUrl('https://internal.example.com/', { lookupFn: privateLookup }), /내부 주소/);
  await assert.rejects(assertPublicUrl('https://rebind.example.com/', { lookupFn: mixedLookup }), /내부 주소/);
});

test('safeFetch: 리다이렉트도 단계마다 검사한다', async () => {
  const lookupFn = async (host) => [{ address: host === 'evil.example.com' ? '10.0.0.1' : '93.184.216.34', family: 4 }];
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://ok.example.com/')) {
      return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/secret' } });
    }
    return new Response('should not be reached', { status: 200 });
  };
  await assert.rejects(safeFetch('https://ok.example.com/start', { fetchFn, lookupFn }), /내부 주소/);
  assert.deepEqual(calls, ['https://ok.example.com/start']); // 내부 주소로는 요청 자체를 보내지 않았다

  // 너무 많은 리다이렉트
  const loop = async (url) => new Response(null, { status: 302, headers: { location: `${url}x` } });
  await assert.rejects(safeFetch('https://ok.example.com/', { fetchFn: loop, lookupFn }), /리다이렉트/);
});

test('findThumbnail: 페이지 → og:image → 실제 이미지 확인', async () => {
  const html = '<head><meta property="og:image" content="https://cdn.example.com/poster.jpg"></head>';
  const make = (overrides = {}) => async (url) => {
    if (String(url).endsWith('/poster.jpg')) {
      return { url, status: 200, contentType: 'image/jpeg', contentLength: 1000, body: '', ...overrides.image };
    }
    return { url, status: 200, contentType: 'text/html; charset=utf-8', contentLength: null, body: html, ...overrides.page };
  };
  assert.equal(await findThumbnail('https://shop.example.com/p/1', { safeFetchFn: make() }), 'https://cdn.example.com/poster.jpg');

  const rejects = (overrides, re) => assert.rejects(findThumbnail('https://shop.example.com/p/1', { safeFetchFn: make(overrides) }), re);
  await rejects({ page: { status: 404 } }, /페이지 응답 404/);
  await rejects({ page: { contentType: 'application/json' } }, /HTML/);
  await rejects({ page: { body: '<head></head>' } }, /og:image/);
  await rejects({ image: { status: 403 } }, /이미지 응답 403/); // 핫링크 차단 등
  await rejects({ image: { contentType: 'text/html' } }, /이미지가 아닙니다/); // 없는 주소가 HTML 오류 페이지를 돌려주는 경우
  await rejects({ image: { contentLength: 50 * 1024 * 1024 } }, /너무 큽니다/);
});

test('enrichWithThumbnails: 공연·문화만, 같은 페이지는 한 번만, 실패는 사유 기록', async () => {
  const items = [
    { category: 'concert', title: 'A', url: 'https://a.example.com/1' },
    { category: 'culture', title: 'B', url: 'https://a.example.com/1' }, // 같은 페이지
    { category: 'culture', title: 'C', url: 'https://b.example.com/2' },
    { category: 'culture', title: 'D', url: 'https://c.example.com/3', image: 'https://old.example.com/d.jpg' }, // 이미 있음
    { category: 'family', title: 'E', url: 'https://d.example.com/4' }, // 대상 아님
    { category: 'concert', title: 'F' }, // url 없음
  ];
  const seen = [];
  const findFn = async (url) => {
    seen.push(url);
    if (url.includes('b.example')) throw new Error('이미지 응답 403');
    return `${url}/poster.jpg`;
  };
  const stats = await enrichWithThumbnails(items, { findFn });
  assert.deepEqual(seen.sort(), ['https://a.example.com/1', 'https://b.example.com/2']);
  assert.equal(stats.tried, 3);
  assert.equal(stats.ok, 2);
  assert.deepEqual(stats.failed.map((f) => [f.title, f.reason]), [['C', '이미지 응답 403']]);
  assert.equal(items[0].image, 'https://a.example.com/1/poster.jpg');
  assert.equal(items[1].image, 'https://a.example.com/1/poster.jpg');
  assert.equal(items[2].image, undefined);
  assert.equal(items[3].image, 'https://old.example.com/d.jpg');
  assert.equal(items[4].image, undefined);

  // --force: 있는 것도 다시 찾되 실패하면 기존 값 유지
  const forceItems = [{ category: 'culture', title: 'D', url: 'https://b.example.com/2', image: 'https://old.example.com/d.jpg' }];
  await enrichWithThumbnails(forceItems, { findFn, force: true });
  assert.equal(forceItems[0].image, 'https://old.example.com/d.jpg');
});

test('dropSharedImages: 여러 항목에 붙은 같은 이미지는 사이트 기본 이미지로 보고 지운다', () => {
  const items = [
    { title: 'A', image: 'https://x.com/logo.png' },
    { title: 'B', image: 'https://x.com/logo.png' },
    { title: 'C', image: 'https://x.com/c.jpg' },
    { title: 'D' },
  ];
  assert.equal(dropSharedImages(items), 2);
  assert.deepEqual(items.map((i) => i.image), [undefined, undefined, 'https://x.com/c.jpg', undefined]);
});

test('화면용 safeImageUrl: https 이미지 주소만', () => {
  assert.equal(safeImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
  for (const bad of ['http://cdn.example.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//cdn.example.com/a.jpg', '', null, undefined, 42, 'https://u:p@x.com/a.jpg']) {
    assert.equal(safeImageUrl(bad), null, String(bad));
  }
});

test('사이트 기본 이미지로 보이는 파일명은 거부한다', async () => {
  const { looksGeneric } = await import('../lib/thumbnail.mjs');
  for (const u of ['https://x.com/assets/images/og-image.jpg', 'https://x.com/logo.png', 'https://x.com/img/default.jpg', 'https://x.com/no_image.png', 'https://x.com/a/placeholder.webp']) {
    assert.equal(looksGeneric(u), true, u);
  }
  for (const u of ['https://x.com/Play/image/large/26/26015604_p.gif', 'https://x.com/poster.jpg', 'https://x.com/img/upload/2026/10/26/SSC_1.jpg', 'https://x.com/catalog/1158435.jpg']) {
    assert.equal(looksGeneric(u), false, u);
  }
  const html = '<meta property="og:image" content="https://cdn.example.com/assets/og-image.jpg">';
  const fake = async (url) => ({ url, status: 200, contentType: 'text/html', contentLength: null, body: html });
  await assert.rejects(findThumbnail('https://shop.example.com/p/1', { safeFetchFn: fake }), /기본 이미지/);
});

test('list: true 항목(순위 묶음)은 썸네일 대상이 아니다', async () => {
  const items = [
    { category: 'culture', title: 'TOP5', url: 'https://a.example.com/1', list: true },
    { category: 'culture', title: '단일 작품', url: 'https://b.example.com/2' },
  ];
  const stats = await enrichWithThumbnails(items, { findFn: async (u) => `${u}/p.jpg` });
  assert.equal(stats.tried, 1);
  assert.equal(items[0].image, undefined);
  assert.equal(items[1].image, 'https://b.example.com/2/p.jpg');
});

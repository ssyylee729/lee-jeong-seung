// 항목의 근거 페이지(item.url)에서 대표 이미지(og:image)를 찾아 포스터·표지 썸네일로 쓴다.
//
// 이미지 주소는 모델이 적게 하지 않는다 (없는 주소를 지어낼 수 있으므로). 페이지에 실제로 적힌 og:image 만 쓰고,
// 그 주소가 정말 이미지를 돌려주는지 확인한 것만 info.json 의 image 필드에 넣는다.
// 이미지 파일을 저장소에 복사하지 않고 주소만 저장한다 (포스터·표지는 저작물이라 재배포를 피한다).
//
// 보안: 모델이 고른 URL 을 CI 에서 가져오므로, 내부망·메타데이터 주소로 향하는 요청은 막는다 (SSRF 방지).
//   - http(s) 만, 계정정보가 든 URL 거부
//   - 호스트가 해석되는 모든 주소가 공인 주소여야 함. 리다이렉트도 한 단계마다 다시 검사
//   - 응답 크기·시간 제한
//   (DNS 조회와 실제 연결 사이의 변조(rebinding)까지는 막지 못한다. 개인용 CI 라 이 정도로 둔다.)
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const UA = 'RaniAppBot/1.0 (+https://github.com/ssyylee729/lee-jeong-seung; link preview)';
const PAGE_MAX_BYTES = 512 * 1024; // og 태그는 <head> 에 있으므로 앞부분만 읽는다
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export const THUMB_CATEGORIES = ['concert', 'culture'];

// ---------- 주소 검사 ----------

export function isPrivateAddress(ip) {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 || // 멀티캐스트·예약
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // 링크로컬 (클라우드 메타데이터 169.254.169.254 포함)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (version === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    const mappedHex = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (x.startsWith('::')) return true; // ::, ::1, IPv4 호환 등
    const first = parseInt(x.split(':')[0], 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
  }
  return true; // 알 수 없는 형식은 거부
}

export async function assertPublicUrl(raw, { lookupFn = lookup } = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL 형식 오류');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`http(s) 만 허용합니다: ${u.protocol}`);
  if (u.username || u.password) throw new Error('계정 정보가 들어 있는 URL 입니다');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`내부 주소는 허용하지 않습니다: ${host}`);
    return u;
  }
  const addrs = await lookupFn(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`내부 주소로 해석되는 호스트입니다: ${host}`);
  }
  return u;
}

// ---------- 가져오기 ----------

async function readLimited(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

export async function safeFetch(raw, { accept = '*/*', maxBytes = PAGE_MAX_BYTES, readBody = true, fetchFn = fetch, lookupFn } = {}) {
  let url = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(url, { lookupFn });
    const res = await fetchFn(u, {
      redirect: 'manual', // 리다이렉트는 직접 따라가며 단계마다 검사한다
      headers: { 'user-agent': UA, accept, 'accept-language': 'ko-KR,ko;q=0.9' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, u).href;
      continue;
    }
    const out = {
      url: u.href,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      contentLength: Number(res.headers.get('content-length')) || null,
      body: '',
    };
    if (readBody && res.body) out.body = await readLimited(res, maxBytes);
    else await res.body?.cancel();
    return out;
  }
  throw new Error('리다이렉트가 너무 많습니다');
}

// ---------- og:image 추출 ----------

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const PRIORITY = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'];

/** HTML 에서 대표 이미지 주소를 찾는다. https 인 것만 돌려주고, 없으면 null. */
export function extractImageUrl(html, baseUrl) {
  const found = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3];
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (PRIORITY.includes(key) && attrs.content && !found.has(key)) found.set(key, decodeEntities(attrs.content.trim()));
  }
  for (const key of PRIORITY) {
    const value = found.get(key);
    if (!value) continue;
    try {
      const u = new URL(value, baseUrl); // 상대 경로·//host/path 도 처리
      if (u.protocol === 'https:' && !u.username && !u.password) return u.href;
    } catch {
      // 다음 후보로
    }
  }
  return null;
}

// 작품·공연 포스터가 아니라 사이트 공통 이미지로 보이는 파일 이름
const GENERIC_IMAGE = /(^|[/_.-])(logo|og[-_]?image|default|placeholder|no[-_]?image|noimg|blank|favicon|sns[-_]?share)([/_.-]|$)/i;
export const looksGeneric = (imageUrl) => GENERIC_IMAGE.test(new URL(imageUrl).pathname);

/** 페이지의 대표 이미지를 찾고, 정말 이미지를 돌려주는지 확인한 주소를 반환한다. 실패하면 사유와 함께 던진다. */
export async function findThumbnail(pageUrl, { safeFetchFn = safeFetch } = {}) {
  const page = await safeFetchFn(pageUrl, { accept: 'text/html,application/xhtml+xml', maxBytes: PAGE_MAX_BYTES });
  if (page.status !== 200) throw new Error(`페이지 응답 ${page.status}`);
  if (!/html/i.test(page.contentType)) throw new Error('HTML 페이지가 아닙니다');
  const image = extractImageUrl(page.body, page.url);
  if (!image) throw new Error('대표 이미지(og:image)가 없습니다');
  if (looksGeneric(image)) throw new Error('사이트 기본 이미지로 보입니다');

  const probe = await safeFetchFn(image, { accept: 'image/*', readBody: false });
  if (probe.status !== 200) throw new Error(`이미지 응답 ${probe.status}`);
  if (!/^image\//i.test(probe.contentType)) throw new Error(`이미지가 아닙니다 (${probe.contentType || '타입 없음'})`);
  if (probe.contentLength && probe.contentLength > IMAGE_MAX_BYTES) throw new Error('이미지가 너무 큽니다');
  return image;
}

// ---------- 항목에 적용 ----------

/**
 * 같은 이미지가 둘 이상의 항목에 붙었다면 특정 작품의 포스터가 아니라 사이트 기본 이미지(로고·배너)일 가능성이 높다.
 * 그런 이미지는 모두 지운다.
 * @returns {number} 지운 항목 수
 */
export function dropSharedImages(items) {
  const counts = new Map();
  for (const i of items) if (i.image) counts.set(i.image, (counts.get(i.image) ?? 0) + 1);
  let removed = 0;
  for (const i of items) {
    if (i.image && counts.get(i.image) >= 2) {
      delete i.image;
      removed += 1;
    }
  }
  return removed;
}

/**
 * 공연·문화 항목에 image 를 채운다 (items 를 직접 수정). 실패한 항목은 그대로 두고 사유만 모은다.
 * @returns {Promise<{ tried: number, ok: number, failed: { title: string, url: string, reason: string }[] }>}
 */
export async function enrichWithThumbnails(items, { concurrency = 4, force = false, findFn = findThumbnail } = {}) {
  // list: true 는 TOP5·베스트셀러처럼 여러 작품을 묶은 항목이라 대표 포스터가 없다
  const targets = items.filter((i) => THUMB_CATEGORIES.includes(i.category) && i.url && !i.list && (force || !i.image));
  const byUrl = new Map(); // 같은 페이지는 한 번만 가져온다
  const stats = { tried: targets.length, ok: 0, failed: [] };
  let next = 0;

  async function worker() {
    while (next < targets.length) {
      const item = targets[next++];
      if (!byUrl.has(item.url)) {
        byUrl.set(
          item.url,
          findFn(item.url).then(
            (image) => ({ image }),
            (err) => ({ reason: err.message }),
          ),
        );
      }
      const r = await byUrl.get(item.url);
      if (r.image) {
        item.image = r.image;
        stats.ok += 1;
      } else {
        stats.failed.push({ title: item.title, url: item.url, reason: r.reason });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return stats;
}

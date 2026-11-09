import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectUrls, extractJson, mergeItems, validateAll, validateConcert } from '../lib/merge.mjs';

const now = new Date('2026-11-16T07:00:00+09:00'); // 월요일
const seen = new Set(['https://nol.yanolja.com/ticket/products/1']);
const ctx = { seenUrls: seen, now };

const concert = (over = {}) => ({
  artist: '성시경', title: '연말 콘서트', summary: 's', subtype: '인터파크',
  openAt: '2026-11-20T20:00+09:00', url: 'https://nol.yanolja.com/ticket/products/1', unverified: false, ...over,
});

test('extractJson: 마지막 json 코드블록을 읽는다', () => {
  const t = '메모\n```json\n{"a":1}\n```\n끝\n```json\n{"a":2}\n```';
  assert.deepEqual(extractJson(t), { a: 2 });
  assert.deepEqual(extractJson('앞 {"a":3} 뒤'), { a: 3 });
  assert.throws(() => extractJson('json 없음'));
});

test('collectUrls: 검색/조회 결과의 url 만 모으고 정규화한다', () => {
  const urls = collectUrls([
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.com/x/#frag' }] },
    { type: 'text', text: 'x', citations: [{ url: 'https://b.com/' }] },
  ]);
  assert.ok(urls.has('https://a.com/x'));
  assert.ok(urls.has('https://b.com'));
});

test('공연: 근거 URL 이 실제로 확인된 경우에만 unverified 가 풀린다', () => {
  assert.equal(validateConcert(concert(), ctx).item.unverified, undefined);
  // 모델이 false 라고 주장해도 본 적 없는 URL 이면 확인 필요로 남긴다
  assert.equal(validateConcert(concert({ url: 'https://made-up.example/1' }), ctx).item.unverified, true);
  // 모델이 true 라고 하면 그대로
  assert.equal(validateConcert(concert({ unverified: true }), ctx).item.unverified, true);
  // 필드 누락 = 확인 필요
  const { unverified, ...rest } = concert();
  void unverified;
  assert.equal(validateConcert(rest, ctx).item.unverified, true);
});

test('공연: 잘못된 값은 거른다', () => {
  assert.match(validateConcert(concert({ openAt: '2026-11-20 20:00' }), ctx).error, /openAt/);
  assert.match(validateConcert(concert({ openAt: '2026-11-20T20:00Z' }), ctx).error, /openAt/);
  assert.match(validateConcert(concert({ openAt: '2026-02-30T20:00+09:00' }), ctx).error, /openAt/);
  assert.match(validateConcert(concert({ openAt: '2026-11-01T20:00+09:00' }), ctx).error, /지난 오픈/);
  assert.match(validateConcert(concert({ openAt: '2030-01-01T20:00+09:00' }), ctx).error, /먼 미래/);
  assert.match(validateConcert(concert({ subtype: '옥션' }), ctx).error, /subtype/);
  assert.match(validateConcert(concert({ url: 'javascript:alert(1)' }), ctx).error, /url/);
  assert.match(validateConcert(concert({ url: 'not a url' }), ctx).error, /url/);
  assert.match(validateConcert(concert({ artist: '' }), ctx).error, /artist/);
});

test('문화: deadline 형식과 subtype 검증', () => {
  const { accepted, rejected } = validateAll(
    {
      concerts: [],
      culture: [
        { subtype: '영화', title: 'A', url: 'https://x.com', deadline: '2026-11-25', deadlineText: '개봉' },
        { subtype: '영화', title: 'B', url: 'https://x.com', deadline: '11/25' },
        { subtype: '게임', title: 'C', url: 'https://x.com' },
        { subtype: '도서', title: 'D', url: 'https://x.com', deadline: null, rating: null },
      ],
    },
    ctx,
  );
  assert.deepEqual(accepted.culture.map((c) => c.title), ['A', 'D']);
  assert.equal(accepted.culture[0].deadlineText, '개봉');
  assert.equal(rejected.length, 2);
  assert.ok(accepted.culture.every((c) => c.unverified === true)); // URL 미확인
});

test('validateAll: 배열이 아니면 거부 기록', () => {
  const { accepted, rejected } = validateAll({ concerts: 'x' }, ctx);
  assert.equal(accepted.concerts.length, 0);
  assert.equal(rejected.length, 2);
});

test('mergeItems: 이번 주 항목은 교체, 지난 주의 오픈 전 공연은 새 결과가 없을 때만 보존', () => {
  const existing = [
    { week: '2026-11-09', category: 'concert', artist: '혁오', openAt: '2026-11-20T20:00+09:00', title: '구' },
    { week: '2026-11-09', category: 'concert', artist: '성시경', openAt: '2026-11-20T20:00+09:00', title: '구' },
    { week: '2026-11-09', category: 'concert', artist: 'AKMU', openAt: '2026-11-10T20:00+09:00', title: '이미 오픈' },
    { week: '2026-11-09', category: 'culture', subtype: '영화', title: '지난주 영화' },
    { week: '2026-11-16', category: 'culture', subtype: '영화', title: '이번주 구 영화' },
    { week: '2025-01-06', category: 'culture', subtype: '영화', title: '아주 오래됨' },
  ];
  const accepted = {
    concerts: [{ category: 'concert', artist: '성시경', title: '신', openAt: '2026-11-21T20:00+09:00', subtype: '인터파크', url: 'https://x.com' }],
    culture: [{ category: 'culture', subtype: '영화', title: '이번주 신 영화', url: 'https://x.com' }],
  };
  const out = mergeItems(existing, accepted, { now });
  const titles = out.map((i) => i.title).sort();
  assert.deepEqual(titles, ['구', '신', '이미 오픈', '이번주 신 영화', '지난주 영화'].sort());
  // 혁오('구')는 보존, 성시경은 새 것으로 교체
  assert.equal(out.find((i) => i.artist === '혁오').title, '구');
  assert.equal(out.find((i) => i.artist === '성시경').title, '신');
  assert.equal(out.find((i) => i.title === '신').week, '2026-11-16');
});

test('mergeItems: 같은 주에 두 번 돌려도 중복되지 않는다', () => {
  const accepted = { concerts: [], culture: [{ category: 'culture', subtype: '도서', title: 'T', url: 'https://x.com' }] };
  const once = mergeItems([], accepted, { now });
  const twice = mergeItems(once, accepted, { now });
  assert.deepEqual(twice, once);
});

test('보관 기간: 8주보다 오래된 항목은 지우되, 오픈 전 공연은 남긴다', async () => {
  const { oldestKeptWeek, KEEP_WEEKS } = await import('../../public/lib/retention.js');
  assert.equal(KEEP_WEEKS, 8);
  // 이번 주 11/16 → 가장 오래된 보관 주는 7주 전 9/28 (이번 주 포함 8주)
  assert.equal(oldestKeptWeek('2026-11-16'), '2026-09-28');

  const old = (week, extra = {}) => ({ week, category: 'culture', subtype: '영화', title: week, ...extra });
  const existing = [
    old('2026-09-21'), // 8주 + 1 → 삭제
    old('2026-09-28'), // 경계 → 유지
    old('2026-11-09'),
    { week: '2026-09-07', category: 'concert', artist: '장기 대기', title: '오래된 주에 적었지만 아직 오픈 전', openAt: '2026-12-01T20:00+09:00' },
    { week: '2026-09-07', category: 'concert', artist: '이미 오픈', title: '오래되고 오픈도 끝남', openAt: '2026-09-10T20:00+09:00' },
  ];
  const out = mergeItems(existing, { concerts: [], culture: [] }, { now });
  assert.deepEqual(out.map((i) => i.title).sort(), ['2026-09-28', '2026-11-09', '오래된 주에 적었지만 아직 오픈 전'].sort());
});

test('요약 검증: 3줄까지, 90자 이하의 문자열만', async () => {
  const { validateBriefing } = await import('../lib/merge.mjs');
  const long = '가'.repeat(91);
  const { briefing, rejected } = validateBriefing({
    concert: ['  김지웅  생일  파티 11/9 20:00 오픈 ', '', 123, long, 'b', 'c', 'd'],
    culture: 'not-array',
    family: ['무시됨'], // 모델이 만든 가족 요약은 쓰지 않는다 (앱이 계산)
  });
  assert.deepEqual(briefing.concert, ['김지웅 생일 파티 11/9 20:00 오픈', 'b', 'c']);
  assert.equal(briefing.family, undefined);
  assert.equal(briefing.culture, undefined);
  assert.equal(rejected.length, 4); // 빈 줄, 숫자, 91자, culture 배열 아님
  assert.deepEqual(validateBriefing(undefined).briefing, {});
  assert.deepEqual(validateBriefing({ concert: [] }).briefing, {});
});

test('요약 병합: 이번 주 교체, 새 요약이 비면 기존 유지, 오래된 주 정리', async () => {
  const { mergeBriefings } = await import('../lib/merge.mjs');
  const existing = { '2026-09-14': { concert: ['오래됨'] }, '2026-11-09': { concert: ['지난주'] }, '2026-11-16': { concert: ['이번주 기존'] } };
  const out = mergeBriefings(existing, { concert: ['새 요약'] }, { now });
  assert.deepEqual(out, { '2026-11-09': { concert: ['지난주'] }, '2026-11-16': { concert: ['새 요약'] } });
  // 모델이 요약을 못 줬으면 이번 주 기존 요약은 건드리지 않는다
  const kept = mergeBriefings(existing, {}, { now });
  assert.deepEqual(kept['2026-11-16'], { concert: ['이번주 기존'] });
  assert.equal(kept['2026-09-14'], undefined);
  assert.deepEqual(mergeBriefings(undefined, {}, { now }), {});
});

test('문화 항목: list 플래그는 true 일 때만 통과', () => {
  const ok = validateAll({ concerts: [], culture: [
    { subtype: '도서', title: 'TOP5', url: 'https://x.com', list: true },
    { subtype: '도서', title: '단권', url: 'https://x.com', list: 'yes' },
    { subtype: '영화', title: '단편', url: 'https://x.com' },
  ] }, ctx);
  assert.deepEqual(ok.accepted.culture.map((c) => c.list), [true, undefined, undefined]);
});

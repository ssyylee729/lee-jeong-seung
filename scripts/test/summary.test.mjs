import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWeek, summarize } from '../../public/lib/briefing.js';

// 이 테스트는 실제 public/data/*.json 을 읽지 않는다. 매일 자동 조사가 그 파일을 바꾸기 때문에,
// 실제 데이터에 기대면 조사가 돌 때마다 테스트가 깨진다. 아래의 고정된 데이터로 요약 로직만 검증한다.
const now = new Date('2026-11-09T09:00:00+09:00');
const info = {
  categories: [],
  items: [
    { week: '2026-11-09', category: 'concert', artist: '가수B', title: 'B 콘서트', subtype: '인터파크', openAt: '2026-11-12T20:00+09:00', url: 'https://x.com/b', unverified: true },
    { week: '2026-11-09', category: 'concert', artist: '가수A', title: 'A 콘서트', subtype: 'YES24', openAt: '2026-11-09T20:00+09:00', url: 'https://x.com/a', unverified: true },
    { week: '2026-11-09', category: 'concert', artist: '가수C', title: 'C 콘서트', subtype: '멜론티켓', openAt: '2026-11-20T20:00+09:00', url: 'https://x.com/c' },
    { week: '2026-11-09', category: 'concert', artist: '가수D', title: 'D 콘서트', subtype: '티켓링크', openAt: '2026-11-25T20:00+09:00', url: 'https://x.com/d' },
    { week: '2026-11-09', category: 'culture', subtype: '영화', title: '영화1', url: 'https://x.com/m1', deadline: '2026-11-11', deadlineText: '개봉' },
    { week: '2026-11-09', category: 'culture', subtype: '영화', title: '영화2', url: 'https://x.com/m2', deadline: '2026-11-18', deadlineText: '개봉' },
    { week: '2026-11-09', category: 'culture', subtype: 'OTT', title: '드라마1', url: 'https://x.com/o1', deadline: '2026-11-10', deadlineText: '공개' },
    { week: '2026-11-09', category: 'culture', subtype: '전시', title: '전시1', url: 'https://x.com/e1', deadline: '2026-11-24', deadlineText: '개막' },
  ],
};
const diet = { quotes: ['글귀 하나', '글귀 둘'] };
const cards = () => buildWeek({ info, diet, week: '2026-11-09', now }).sort((a, b) => a.sort.localeCompare(b.sort));

test('각 카테고리 요약은 최대 3줄이고 비어 있지 않다', () => {
  for (const c of ['concert', 'family', 'culture']) {
    const lines = summarize(c, cards());
    assert.ok(lines.length >= 1 && lines.length <= 3, `${c}: ${lines.length}줄`);
    assert.ok(lines.every((l) => l.trim().length > 0));
  }
});

test('공연: 가장 먼저 열리는 순서이고 확인 필요가 표시된다', () => {
  const lines = summarize('concert', cards());
  assert.equal(lines.length, 3); // 4건 중 앞의 3건
  assert.match(lines[0], /가수A/); // 11/9 20:00, 오늘 (입력 순서와 달리 오픈이 가장 빠른 것)
  assert.match(lines[0], /확인 필요/);
  assert.match(lines[0], /오늘/);
  assert.match(lines[1], /가수B/);
  assert.match(lines[2], /가수C/);
  assert.doesNotMatch(lines[2], /확인 필요/); // 확인된 항목에는 붙지 않는다
});

test('가족: 가까운 기념일부터', () => {
  const lines = summarize('family', cards());
  assert.match(lines[0], /철민 생일/); // 고정 기념일(11/12), 기준일 11/9 → D-3
  assert.match(lines[0], /D-3/);
});

test('문화: 분야(영화/OTT/도서/전시)가 겹치지 않고 골고루, 날짜가 가까운 순', () => {
  const lines = summarize('culture', cards());
  const kinds = lines.map((l) => l.split(' · ')[0]);
  assert.deepEqual(kinds, ['OTT', '영화', '전시']); // 11/10, 11/11, 11/24
  assert.equal(new Set(kinds).size, kinds.length);
  assert.match(lines[1], /영화1/); // 영화2 는 같은 분야라 건너뜀
});

test('항목이 없으면 빈 배열 (요약 영역 숨김)', () => {
  assert.deepEqual(summarize('concert', []), []);
  assert.deepEqual(summarize('culture', [{ category: 'family', title: 'x' }]), []);
});

test('다이어트는 더 이상 카드로 나오지 않는다', () => {
  assert.ok(cards().every((c) => c.category !== 'diet'));
});

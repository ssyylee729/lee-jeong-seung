import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_CATEGORY,
  DEFAULT_NICKNAME,
  NICKNAME_MAX,
  cardShareText,
  normalizeNickname,
  parseView,
  viewShareText,
  viewUrl,
} from '../../public/lib/share.js';

test('닉네임: 기본값, 공백 정리, 길이 제한', () => {
  assert.equal(DEFAULT_NICKNAME, '정승자매');
  assert.equal(normalizeNickname(''), '정승자매');
  assert.equal(normalizeNickname('   '), '정승자매');
  assert.equal(normalizeNickname(null), '정승자매');
  assert.equal(normalizeNickname('  승연   짱 '), '승연 짱');
  assert.equal([...normalizeNickname('가'.repeat(30))].length, NICKNAME_MAX);
  // 이모지가 글자 중간에서 잘리지 않는다
  assert.equal([...normalizeNickname('🐱'.repeat(20))].length, NICKNAME_MAX);
});

test('viewUrl: 주/카테고리를 쿼리로, 기본 카테고리(공연)는 생략', () => {
  const base = 'https://x.github.io/lee-jeong-seung/';
  assert.equal(DEFAULT_CATEGORY, 'concert');
  assert.equal(viewUrl(base, { week: '2026-11-09', category: 'culture' }), `${base}?week=2026-11-09&cat=culture`);
  assert.equal(viewUrl(base, { week: '2026-11-09', category: 'concert' }), `${base}?week=2026-11-09`);
  // 기존 쿼리/해시는 지운다
  assert.equal(viewUrl(`${base}?foo=1#x`, { week: '2026-11-09', category: 'concert' }), `${base}?week=2026-11-09`);
});

test('parseView: 유효한 값만 받아들인다', () => {
  const ctx = { weeks: ['2026-11-09', '2026-11-02'], categories: ['concert', 'family', 'culture'] };
  assert.deepEqual(parseView('?week=2026-11-02&cat=family', ctx), { week: '2026-11-02', category: 'family' });
  assert.deepEqual(parseView('', ctx), { week: null, category: 'concert' });
  assert.deepEqual(parseView('?week=1999-01-04&cat=nope', ctx), { week: null, category: 'concert' }); // 없는 주/카테고리
  assert.deepEqual(parseView('?week=<script>&cat=<b>', ctx), { week: null, category: 'concert' });
  assert.deepEqual(parseView('?cat=all', ctx), { week: null, category: 'concert' }); // 예전 '전체' 링크도 안전하게
  assert.deepEqual(parseView('?cat=diet', ctx), { week: null, category: 'concert' }); // 다이어트는 더 이상 탭이 아님
});

test('cardShareText: 있는 항목만 넣고 보낸 사람과 링크를 붙인다', () => {
  const text = cardShareText(
    { title: 'AKMU 콘서트', when: '11/10 (화) 20:00 오픈 · D-1', summary: 'YES24 단독', unverified: true, url: 'https://e.com/a' },
    { categoryLabel: '🎤 공연 예매', nickname: '승연', link: 'https://app/?week=2026-11-09&cat=concert' },
  );
  assert.equal(
    text,
    [
      '[🎤 공연 예매] AKMU 콘서트',
      '11/10 (화) 20:00 오픈 · D-1',
      'YES24 단독',
      '⚠️ 공식 공지 확인 필요',
      'https://e.com/a',
      '',
      '보낸 사람: 승연',
      'https://app/?week=2026-11-09&cat=concert',
    ].join('\n'),
  );
  const minimal = cardShareText({ title: '글귀' }, { categoryLabel: '💪 다이어트', nickname: '', link: 'L' });
  assert.equal(minimal, '[💪 다이어트] 글귀\n\n보낸 사람: 정승자매\nL');
});

test('viewShareText', () => {
  assert.equal(
    viewShareText({ weekLabel: '이번 주 11/9 ~ 11/15', categoryLabel: '🎤 공연 예매', nickname: '정연', link: 'L' }),
    '🍀 라니네 전용 앱 · 이번 주 11/9 ~ 11/15 · 🎤 공연 예매\n\n보낸 사람: 정연\nL',
  );
  assert.equal(viewShareText({ weekLabel: 'w', categoryLabel: '', nickname: 'a', link: 'L' }), '🍀 라니네 전용 앱 · w\n\n보낸 사람: a\nL');
});

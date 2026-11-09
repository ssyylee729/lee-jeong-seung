import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOODS, pickMood } from '../../public/lib/mood.js';

test('빈 화면은 시무룩', () => {
  assert.equal(pickMood({ category: 'concert', cards: [] }), 'sad');
});
test('가족 탭에서 3일 이내 기념일이 있으면 눈 동그랗게(happy)', () => {
  assert.equal(pickMood({ category: 'family', cards: [{ category: 'family', daysLeft: 3 }] }), 'happy');
  assert.equal(pickMood({ category: 'family', cards: [{ category: 'family', daysLeft: 4 }] }), 'neutral');
});
test('공연·문화 탭은 항목이 있으면 기본 표정 (확인 필요 항목이 있어도 화내지 않는다)', () => {
  assert.equal(pickMood({ category: 'concert', cards: [{ category: 'concert', unverified: true }] }), 'neutral');
  assert.equal(pickMood({ category: 'culture', cards: [{ category: 'culture' }] }), 'neutral');
});
test('모든 표정에 라벨과 대사가 있고, 표정 이미지 파일이 존재한다', async () => {
  const { existsSync } = await import('node:fs');
  for (const [name, m] of Object.entries(MOODS)) {
    assert.ok(m.label && m.say, name);
    assert.ok(existsSync(new URL(`../../public/rani/${name}.svg`, import.meta.url)), `public/rani/${name}.svg`);
  }
});

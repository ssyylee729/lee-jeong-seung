import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildWeek, summarize } from '../../public/lib/briefing.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));
const now = new Date('2026-11-09T09:00:00+09:00');
const cards = () =>
  buildWeek({ info: read('info.json'), diet: read('diet.json'), week: '2026-11-09', now }).sort((a, b) => a.sort.localeCompare(b.sort));

test('각 카테고리 요약은 최대 3줄이고 비어 있지 않다', () => {
  for (const c of ['concert', 'family', 'culture']) {
    const lines = summarize(c, cards());
    assert.ok(lines.length >= 1 && lines.length <= 3, `${c}: ${lines.length}줄`);
    assert.ok(lines.every((l) => l.trim().length > 0));
  }
});

test('공연: 가장 먼저 열리는 순서이고 확인 필요가 표시된다', () => {
  const lines = summarize('concert', cards());
  assert.match(lines[0], /김지웅/); // 11/9 20:00 오늘
  assert.match(lines[0], /확인 필요/);
  assert.match(lines[0], /오늘/);
});

test('가족: 가까운 기념일부터', () => {
  const lines = summarize('family', cards());
  assert.match(lines[0], /철민 생일/);
  assert.match(lines[0], /D-3/);
});

test('문화: 분야(영화/OTT/도서/전시)가 겹치지 않고 골고루', () => {
  const lines = summarize('culture', cards());
  const kinds = lines.map((l) => l.split(' · ')[0]);
  assert.equal(new Set(kinds).size, kinds.length);
});

test('항목이 없으면 빈 배열 (요약 영역 숨김)', () => {
  assert.deepEqual(summarize('concert', []), []);
  assert.deepEqual(summarize('culture', [{ category: 'family', title: 'x' }]), []);
});

test('다이어트는 더 이상 카드로 나오지 않는다', () => {
  assert.ok(cards().every((c) => c.category !== 'diet'));
});

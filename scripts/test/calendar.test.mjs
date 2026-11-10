import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAMILY_EVENTS, eventTitle, familyEventsInMonth, monthGrid, upcomingFamilyEvents } from '../../public/lib/family.js';

const titles = (y, m) => Object.entries(familyEventsInMonth(y, m)).map(([d, es]) => `${d} ${es.map(eventTitle).join(',')}`);

test('양력 기념일은 해당 월에만 나온다', () => {
  assert.deepEqual(titles(2026, 11), ['2026-11-12 🎂 철민 생일']);
  assert.deepEqual(titles(2027, 4), ['2027-04-22 🐱 라니 생일']);
  assert.deepEqual(titles(2026, 3), []);
});

test('음력 기념일은 그 해의 양력 날짜로 환산된다 (알려진 값)', () => {
  // 대디 생신 음력 11/17 → 2026-12-25, 마미 생신 음력 8/24 → 2027-09-24 (앞서 설날·추석으로 검증한 변환)
  assert.deepEqual(titles(2026, 12), ['2026-12-08 💍 정연·철민 결혼기념일', '2026-12-25 🎂 대디 생신']);
  assert.deepEqual(titles(2027, 9), ['2027-09-24 🎂 마미 생신']);
  // 음력 11월은 양력 연말·연초에 걸쳐서, 같은 양력 해 1월에도 한 번 나온다 (2026-01-05 = 음력 2025년 11월 17일)
  assert.deepEqual(titles(2026, 1), ['2026-01-05 🎂 대디 생신']);
  assert.deepEqual(titles(2026, 3), []);
});

test('월 단위 계산과 "다음 기념일" 계산이 여러 기준일에서 일치한다 (연말·연초, 윤달 있는 해 포함)', () => {
  for (const iso of ['2026-11-10', '2026-12-26', '2027-01-02', '2027-06-15', '2028-02-01', '2025-08-01', '2033-11-10']) {
    for (const e of upcomingFamilyEvents(new Date(`${iso}T09:00:00+09:00`))) {
      const [y, m] = e.date.split('-').map(Number);
      const hit = (familyEventsInMonth(y, m)[e.date] ?? []).some((x) => eventTitle(x) === eventTitle(e));
      assert.ok(hit, `${iso} 기준 ${e.date} ${eventTitle(e)}`);
    }
  }
});

test('모든 기념일이 일 년에 한 번(음력은 양력 해에 걸쳐 0~2번) 나타난다', () => {
  for (const ev of FAMILY_EVENTS) {
    for (let y = 2026; y <= 2030; y++) {
      let n = 0;
      for (let m = 1; m <= 12; m++) for (const es of Object.values(familyEventsInMonth(y, m))) n += es.filter((x) => x === ev).length;
      if (ev.calendar === 'solar') assert.equal(n, 1, `${eventTitle(ev)} ${y}`);
      else assert.ok(n >= 0 && n <= 2, `${eventTitle(ev)} ${y}: ${n}`);
    }
  }
});

test('윤달은 평달 기준 기념일로 치지 않는다', () => {
  // 2025년은 음력 윤6월이 있는 해. 음력 6월 기념일을 가정해도 윤6월 날짜에는 나오지 않아야 한다.
  const probe = { who: '시험', label: '생일', calendar: 'lunar', month: 6, day: 8, emoji: '🎂' };
  FAMILY_EVENTS.push(probe);
  try {
    const hits = [];
    for (let m = 1; m <= 12; m++) for (const [d, es] of Object.entries(familyEventsInMonth(2025, m))) if (es.includes(probe)) hits.push(d);
    assert.equal(hits.length, 1, hits.join()); // 평달 6/8 한 번만 (윤6월 8일은 제외)
    assert.ok(hits[0] < '2025-07-25', hits[0]); // 윤6월은 2025-07-25 부터이므로 그보다 앞의 평달 6월
  } finally {
    FAMILY_EVENTS.pop();
  }
});

test('달력 격자: 일요일 시작, 7의 배수 칸, 이전/다음 달 날짜로 채운다', () => {
  const g = monthGrid(2026, 11); // 2026-11-01 은 일요일
  assert.equal(g.length, 5);
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g[0][0].date, '2026-11-01');
  assert.equal(g.flat().filter((c) => c.inMonth).length, 30);
  assert.equal(g.flat().find((c) => c.date === '2026-11-12').events.length, 1);

  const feb = monthGrid(2026, 2); // 2026-02-01 은 일요일, 28일 → 4주
  assert.equal(feb.length, 4);
  const may = monthGrid(2026, 5); // 2026-05-01 은 금요일 → 앞칸 5개는 4월
  assert.equal(may[0][0].date, '2026-04-26');
  assert.equal(may[0][0].inMonth, false);
  assert.equal(may[0][5].date, '2026-05-01');
  assert.equal(may.flat().filter((c) => c.inMonth).length, 31);
  // 6주짜리 달 (2026-08: 토요일에 시작, 31일)
  assert.equal(monthGrid(2026, 8).length, 6);
});

test('달력 격자: 연도 경계(1월/12월)에서 이웃 달의 기념일이 보인다', () => {
  // 2026-12 격자의 마지막 줄은 2027-01 날짜. 1월에 기념일이 생기면 거기에도 나와야 한다 → 격자가 12 월 기념일도 포함하는지
  const dec = monthGrid(2026, 12).flat();
  assert.ok(dec.find((c) => c.date === '2026-12-25').events.length === 1);
  assert.ok(dec.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
  const jan = monthGrid(2027, 1).flat();
  assert.equal(jan[0].date, '2026-12-27'); // 1월 1일이 금요일 → 첫 줄 앞은 12월 27~31일
  assert.equal(jan[0].inMonth, false);
});

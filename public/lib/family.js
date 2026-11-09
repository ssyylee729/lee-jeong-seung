// 가족 기념일 계산. 브라우저와 Node 에서 같이 쓴다.
// 음력은 Intl 의 chinese 달력으로 변환한다 (한국 음력과 같고, 윤달은 month 가 "6bis" 처럼 나온다).
import { daysUntil } from './week.js';

// who: 화면에 쓰는 호칭. 엄마=마미, 아빠=대디, 형부=철민, 언니=정연, 나=승연, 고양이=라니
// title 이 있으면 "who + label" 대신 그대로 쓴다.
export const FAMILY_EVENTS = [
  { who: '승연', label: '생일', calendar: 'solar', month: 7, day: 29, emoji: '🎂' },
  { who: '정연', label: '생일', calendar: 'solar', month: 7, day: 23, emoji: '🎂' },
  { who: '마미', label: '생신', calendar: 'lunar', month: 8, day: 24, emoji: '🎂' },
  { who: '대디', label: '생신', calendar: 'lunar', month: 11, day: 17, emoji: '🎂' },
  { who: '철민', label: '생일', calendar: 'solar', month: 11, day: 12, emoji: '🎂' },
  { who: '라니', label: '생일', calendar: 'solar', month: 4, day: 22, emoji: '🐱' },
  { who: '마미·대디', label: '결혼기념일', calendar: 'solar', month: 5, day: 23, emoji: '💍' },
  { who: '정연·철민', label: '결혼기념일', calendar: 'solar', month: 12, day: 8, emoji: '💍' },
  { title: '고양이의 날', calendar: 'solar', month: 8, day: 8, emoji: '🐱' },
];

const LUNAR = new Intl.DateTimeFormat('en-u-ca-chinese', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (d) => d.toISOString().slice(0, 10);

// 양력 날짜(UTC 자정 기준 Date)의 음력 월/일. 윤달이면 leap=true.
function lunarOf(utcDate) {
  const noonKst = new Date(utcDate.getTime() + 3 * 60 * 60 * 1000); // 00:00Z → 12:00 KST
  const parts = Object.fromEntries(LUNAR.formatToParts(noonKst).map((p) => [p.type, p.value]));
  return { month: parseInt(parts.month, 10), day: Number(parts.day), leap: parts.month.includes('bis') };
}

// 오늘부터 앞으로 한 해 남짓 훑어서 음력 month/day(평달)에 해당하는 가장 가까운 양력 날짜.
// 양력 연도 단위로 찾으면 음력 11~12월 생일이 양력 1월/12월에 두 번 걸려 놓칠 수 있어서 날짜 기준으로 훑는다.
function nextLunar(month, day, now) {
  const today = new Date(`${kstToday(now)}T00:00:00Z`);
  for (let i = 0; i <= 400; i++) {
    const d = new Date(today.getTime() + i * DAY_MS);
    const l = lunarOf(d);
    if (!l.leap && l.month === month && l.day === day) return ymd(d);
  }
  return null;
}

function kstToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
}

function nextSolar(month, day, now) {
  const thisYear = Number(kstToday(now).slice(0, 4));
  for (const year of [thisYear, thisYear + 1]) {
    const date = ymd(new Date(Date.UTC(year, month - 1, day)));
    if (daysUntil(date, now) >= 0) return date;
  }
  return null;
}

/** 오늘 이후(오늘 포함) 가장 가까운 기념일 날짜 "YYYY-MM-DD" */
function nextOccurrence(ev, now) {
  return ev.calendar === 'lunar' ? nextLunar(ev.month, ev.day, now) : nextSolar(ev.month, ev.day, now);
}

/** 다가오는 순으로 정렬한 기념일 목록: [{ ...event, date, daysLeft }] */
export function upcomingFamilyEvents(now = new Date()) {
  return FAMILY_EVENTS.map((ev) => {
    const date = nextOccurrence(ev, now);
    return { ...ev, date, daysLeft: date ? daysUntil(date, now) : null };
  })
    .filter((e) => e.date)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function eventTitle(e) {
  return `${e.emoji} ${e.title ?? `${e.who} ${e.label}`}`;
}

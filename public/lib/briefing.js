// 한 주치 브리핑을 만든다. 앱 화면(app.js)과 알림(send-push.mjs)이 같은 결과를 쓴다.
//   공연/문화 : info.json 에 직접 적은 항목
//   가족     : family.js 에서 자동 계산
//   다이어트  : diet.json 글귀를 주마다 하나씩 돌려가며
import { addDays, daysUntil, deadlineLabel, kstParts, mondayOf } from './week.js';
import { eventTitle, upcomingFamilyEvents } from './family.js';

export const FAMILY_WINDOW_DAYS = 30; // 화면에 보여줄 기념일 범위
export const PUSH_FAMILY_DAYS = 14; // 알림에 넣을 기념일 범위
export const PUSH_CONCERT_DAYS = 7; // 알림에 넣을 예매 오픈 범위

const dday = (n) => (n === 0 ? '오늘' : `D-${n}`);

function openAtParts(openAt) {
  return kstParts(new Date(openAt));
}

function concertWhen(item, now) {
  if (!item.openAt) return item.deadline ? `${deadlineLabel(item.deadline)} 마감` : '';
  const { date, time } = openAtParts(item.openAt);
  const left = daysUntil(date, now);
  const clock = time === '00:00' ? '' : ` ${time}`;
  if (left < 0) return `${deadlineLabel(date)}${clock} 오픈 (판매 중)`;
  return `${deadlineLabel(date)}${clock} 오픈 · ${dday(left)}`;
}

function genericWhen(item, now) {
  if (!item.deadline) return '';
  const left = daysUntil(item.deadline, now);
  if (left < 0) return `${deadlineLabel(item.deadline)} 마감`;
  return `${deadlineLabel(item.deadline)} ${item.deadlineText || '마감'} · ${dday(left)}`;
}

function sortKey(item) {
  if (item.openAt) return item.openAt;
  return item.deadline || '9999';
}

/** 글귀는 월요일 날짜 기준으로 고정(같은 주에는 같은 글귀) */
export function quoteForWeek(diet, week) {
  const weekNumber = Math.floor(Date.parse(`${week}T00:00:00Z`) / (7 * 24 * 60 * 60 * 1000));
  return diet.quotes[weekNumber % diet.quotes.length];
}

/**
 * week(월요일) 한 주의 카드 목록.
 * 이번 주를 볼 때는 다른 주에 적었더라도 아직 오픈 전인 공연과 곧 다가오는 가족 기념일을 함께 보여준다.
 */
export function buildWeek({ info, diet, week, now = new Date() }) {
  const isCurrent = week === mondayOf(now);
  const cards = [];

  for (const item of info.items) {
    const carryOver =
      isCurrent && item.category === 'concert' && item.week < week && item.openAt && daysUntil(openAtParts(item.openAt).date, now) >= 0;
    if (item.week !== week && !carryOver) continue;
    cards.push({
      ...item,
      when: item.category === 'concert' ? concertWhen(item, now) : genericWhen(item, now),
      sort: sortKey(item),
    });
  }

  if (isCurrent) {
    for (const e of upcomingFamilyEvents(now)) {
      if (e.daysLeft > FAMILY_WINDOW_DAYS) break;
      cards.push({
        category: 'family',
        title: eventTitle(e),
        summary: `${deadlineLabel(e.date)} · ${dday(e.daysLeft)}`,
        when: '',
        sort: e.date,
        daysLeft: e.daysLeft,
      });
    }
  }

  cards.push({ category: 'diet', title: quoteForWeek(diet, week), when: '', sort: '0000' });

  return cards;
}

function oneLine(text, max = 60) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 알림 문구. 제목은 한 줄, 본문은 섹션별 한 줄씩. */
export function buildPush({ info, diet, now = new Date(), siteUrl }) {
  const week = mondayOf(now);
  const lines = [];

  const horizon = addDays(kstParts(now).date, PUSH_CONCERT_DAYS);
  const concerts = info.items
    .filter((i) => i.category === 'concert' && i.openAt)
    .filter((i) => {
      const d = openAtParts(i.openAt).date;
      return daysUntil(d, now) >= 0 && d <= horizon;
    })
    .sort((a, b) => a.openAt.localeCompare(b.openAt));
  for (const c of concerts.slice(0, 2)) {
    const { date, time } = openAtParts(c.openAt);
    const clock = time === '00:00' ? '' : ` ${time}`;
    lines.push(`🎤 ${c.artist || c.title} ${deadlineLabel(date)}${clock} 오픈${c.unverified ? ' (확인 필요)' : ''}`);
  }
  if (concerts.length > 2) lines.push(`🎤 예매 오픈 외 ${concerts.length - 2}건`);

  const family = upcomingFamilyEvents(now).filter((e) => e.daysLeft <= PUSH_FAMILY_DAYS);
  for (const e of family.slice(0, 2)) lines.push(`${eventTitle(e)} ${dday(e.daysLeft)}`);

  const culture = info.items.filter((i) => i.category === 'culture' && i.week === week);
  if (culture.length) lines.push(`🎬 이번 주 문화 소식 ${culture.length}건`);

  lines.push(`💪 ${oneLine(quoteForWeek(diet, week))}`);

  return {
    title: `이번 주 브리핑`,
    body: lines.join('\n'),
    url: siteUrl,
    counts: { concerts: concerts.length, family: family.length, culture: culture.length },
  };
}

// 브라우저(app.js)와 Node(send-push.mjs)에서 같이 쓰는 "주" 계산 로직.
// 한 주는 월요일 시작이고, 날짜는 항상 한국 시간 기준 "YYYY-MM-DD" 문자열로 다룬다.

const TZ = 'Asia/Seoul';
const DAY_MS = 24 * 60 * 60 * 1000;

function kstDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toYmd(utcDate) {
  return utcDate.toISOString().slice(0, 10);
}

/** 주어진 시각이 속한 주의 월요일(YYYY-MM-DD) */
export function mondayOf(date = new Date()) {
  const base = parseYmd(kstDateString(date));
  const sinceMonday = (base.getUTCDay() + 6) % 7;
  return toYmd(new Date(base.getTime() - sinceMonday * DAY_MS));
}

/** "11/9 ~ 11/15" 형태의 라벨 */
export function weekRangeLabel(monday) {
  const start = parseYmd(monday);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(start)} ~ ${fmt(end)}`;
}

/** 날짜 문자열에 n일을 더한 날짜 */
export function addDays(ymd, n) {
  return toYmd(new Date(parseYmd(ymd).getTime() + n * DAY_MS));
}

/** 임의의 시각을 한국 시간 기준 날짜/시각으로: { date: "2026-11-12", time: "20:00" } */
export function kstParts(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** 마감일까지 남은 일수 (오늘이면 0, 지났으면 음수) */
export function daysUntil(ymd, now = new Date()) {
  return Math.round((parseYmd(ymd) - parseYmd(kstDateString(now))) / DAY_MS);
}

/** 마감일 → "11/15 (토)" */
export function deadlineLabel(ymd) {
  const d = parseYmd(ymd);
  const dow = '일월화수목금토'[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${dow})`;
}

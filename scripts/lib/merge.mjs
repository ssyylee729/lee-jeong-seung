// Claude 가 돌려준 조사 결과를 검증하고 info.json 에 합치는 순수 함수들.
// 웹에서 가져온 내용이 그대로 앱에 들어가므로, 여기서 형식과 URL 을 엄격하게 거른다.
import { KEEP_WEEKS, oldestKeptWeek } from '../../public/lib/retention.js';
import { kstParts, mondayOf } from '../../public/lib/week.js';

export const CONCERT_SITES = ['인터파크', 'YES24', '티켓링크', '멜론티켓'];
export const CULTURE_TYPES = ['영화', 'OTT', '도서', '전시'];

const OPEN_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 응답 텍스트에서 마지막 ```json 블록(없으면 첫 { ~ 마지막 })을 파싱 */
export function extractJson(text) {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = fenced.length ? fenced.at(-1)[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!raw.trim()) throw new Error('응답에서 JSON 을 찾지 못했습니다.');
  return JSON.parse(raw);
}

/** 응답 블록 안에 나온 모든 url 필드(검색 결과, 인용, 가져온 페이지)를 모은다 */
export function collectUrls(blocks, into = new Set()) {
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (k === 'url' && typeof val === 'string') into.add(normalizeUrl(val));
        else visit(val);
      }
    }
  };
  visit(blocks);
  return into;
}

export function normalizeUrl(u) {
  try {
    const p = new URL(u);
    p.hash = '';
    return p.href.replace(/\/$/, '');
  } catch {
    return u;
  }
}

const isHttpUrl = (u) => {
  try {
    const { protocol } = new URL(u);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function validDate(ymd) {
  return YMD.test(ymd) && !Number.isNaN(Date.parse(`${ymd}T00:00:00Z`)) && new Date(`${ymd}T00:00:00Z`).toISOString().startsWith(ymd);
}

/**
 * @returns {{ item?: object, error?: string }}
 * unverified: 모델이 명시적으로 false 라고 했고 + 근거 URL 이 실제 검색/조회 결과에 있을 때만 false.
 */
function common(raw, seenUrls) {
  const title = text(raw.title, 120);
  if (!title) return { error: 'title 없음' };
  const url = text(raw.url, 500);
  if (!url || !isHttpUrl(url)) return { error: `url 이 http(s) 가 아님: ${raw.url}` };
  const seen = seenUrls.has(normalizeUrl(url));
  return {
    base: {
      title,
      summary: text(raw.summary, 300) ?? undefined,
      url,
      unverified: raw.unverified === false && seen ? undefined : true,
    },
    seen,
  };
}

export function validateConcert(raw, { seenUrls, now }) {
  const c = common(raw, seenUrls);
  if (c.error) return { error: c.error };
  if (!CONCERT_SITES.includes(raw.subtype)) return { error: `subtype 은 ${CONCERT_SITES.join('/')} 중 하나: ${raw.subtype}` };
  // Date.parse 는 2월 30일 같은 날짜를 3월 2일로 보정해 버리므로 날짜 부분을 따로 엄격하게 확인한다
  if (typeof raw.openAt !== 'string' || !OPEN_AT.test(raw.openAt) || !validDate(raw.openAt.slice(0, 10)) || Number.isNaN(Date.parse(raw.openAt))) {
    return { error: `openAt 형식 오류(YYYY-MM-DDTHH:MM+09:00): ${raw.openAt}` };
  }
  const open = Date.parse(raw.openAt);
  if (open < now.getTime() - 3 * 24 * 3600 * 1000) return { error: `이미 3일 넘게 지난 오픈: ${raw.openAt}` };
  if (open > now.getTime() + 400 * 24 * 3600 * 1000) return { error: `너무 먼 미래의 오픈: ${raw.openAt}` };
  const artist = text(raw.artist, 60);
  if (!artist) return { error: 'artist 없음' };
  return {
    item: { category: 'concert', artist, ...c.base, openAt: raw.openAt, subtype: raw.subtype },
  };
}

export function validateCulture(raw, { seenUrls }) {
  const c = common(raw, seenUrls);
  if (c.error) return { error: c.error };
  if (!CULTURE_TYPES.includes(raw.subtype)) return { error: `subtype 은 ${CULTURE_TYPES.join('/')} 중 하나: ${raw.subtype}` };
  const item = { category: 'culture', subtype: raw.subtype, ...c.base };
  if (raw.deadline != null) {
    if (typeof raw.deadline !== 'string' || !validDate(raw.deadline)) return { error: `deadline 형식 오류(YYYY-MM-DD): ${raw.deadline}` };
    item.deadline = raw.deadline;
    item.deadlineText = text(raw.deadlineText, 6) ?? '마감';
  }
  const rating = text(raw.rating, 120);
  if (rating) item.rating = rating;
  if (raw.list === true) item.list = true; // 여러 작품을 묶은 순위 항목 (썸네일 제외)
  return { item };
}

export function validateAll(result, ctx) {
  const accepted = { concerts: [], culture: [] };
  const rejected = [];
  for (const [key, validate, out] of [
    ['concerts', validateConcert, accepted.concerts],
    ['culture', validateCulture, accepted.culture],
  ]) {
    if (!Array.isArray(result?.[key])) {
      rejected.push(`${key}: 배열이 아님`);
      continue;
    }
    for (const raw of result[key]) {
      const r = validate(raw ?? {}, ctx);
      if (r.item) out.push(r.item);
      else rejected.push(`${key} "${raw?.title ?? raw?.artist ?? '?'}": ${r.error}`);
    }
  }
  return { accepted, rejected };
}

const isUpcomingConcert = (i, now) => i.category === 'concert' && i.openAt && Date.parse(i.openAt) > now.getTime();

/** 모델에게 "다시 확인해서 돌려달라"고 넘길 기존 항목: 아직 오픈 전인 공연 */
export function upcomingConcerts(items, now) {
  return items.filter((i) => isUpcomingConcert(i, now));
}

/**
 * 기존 items 에 새 결과를 합친다. 같은 주에 여러 번(매일) 돌려도 안전하도록 만들었다.
 *  - 아직 오픈 전인 공연은 새 결과에 같은 artist 가 없으면 **같은 주에 적은 것이라도 보존한다**
 *    (검색이 하루 이틀 흔들려서 예매 예정 공연이 사라지면 안 되므로). 새 결과에 있으면 새 것으로 교체.
 *  - 그 밖의 이번 주 항목(문화 소식, 이미 오픈한 공연)은 통째로 교체한다.
 *  - 교체되는 항목이 같은 url 의 이전 항목과 이어지면 이미 찾아 둔 썸네일(image)을 물려받는다.
 *  - KEEP_WEEKS 주보다 오래된 항목은 정리. 단, 아직 오픈 전인 공연은 오래된 주에 적혀 있어도 남긴다
 */
export function mergeItems(existing, accepted, { now }) {
  const week = mondayOf(now);
  const oldest = oldestKeptWeek(week);
  const newArtists = new Set(accepted.concerts.map((c) => c.artist));

  const kept = existing.filter((i) => {
    if (isUpcomingConcert(i, now)) return !newArtists.has(i.artist); // 새 결과가 없는 건 (같은 주·오래된 주 모두) 보존
    if (i.week === week) return false;
    return i.week >= oldest;
  });

  // 같은 주에 이미 받아 둔 썸네일은 같은 url 이면 이어받는다 (매일 다시 받지 않도록)
  const imageByUrl = new Map(existing.filter((i) => i.image && i.url).map((i) => [i.url, i.image]));
  const fresh = [...accepted.concerts, ...accepted.culture].map((i) => {
    const image = imageByUrl.get(i.url);
    return { week, ...i, ...(image && !i.list ? { image } : {}) };
  });
  return [...kept, ...fresh];
}

const BRIEF_LINES = 3;
const BRIEF_MAX = 90;
// 보는 날에 따라 뜻이 달라지는 말. 요약은 며칠 화면에 남으므로 쓰지 않는다. (절대 날짜로만 쓴다)
// 규칙: 낱말 **뒤가 한글이 아닐 때** (또는 조사가 붙은 형태) 만 걸러서 "오늘의집", "내일배움카드", "올해의 책" 같은 고유명사는 통과시킨다.
//   - 걸림: "오늘 20:00", "오늘부터", "내일은", "이번 주", "D-3"
//   - 통과: "오늘의집", "내일배움카드", "올해의 책"
// "곧", "현재" 처럼 다른 낱말 안에 흔히 들어가는 것은 오탐이 많아 제외했고 프롬프트에서 안내한다.
const REL_WORD = '(?:오늘|내일|어제|모레|그저께|글피|금일|명일|올해|금년|이번\\s*주|금주|지난\\s*주|다음\\s*주|차주|이번\\s*달|이달|지난\\s*달|다음\\s*달)';
const REL_JOSA = '(?:은|는|이|가|도|만|부터|까지|에|에는|에도|에서|로|께|쯤|중|안|이내|내|밤|아침|저녁|오전|오후)';
export const RELATIVE_TIME = new RegExp(`${REL_WORD}(?![가-힣])|${REL_WORD}${REL_JOSA}(?![가-힣])|D\\s*[-+]\\s*\\d+`);
export const BRIEF_CATEGORIES = ['concert', 'culture'];

/** 모델이 쓴 요약 줄을 정리한다: 문자열만, 공백 정리, 90자 이하, 분야당 최대 3줄 */
export function validateBriefing(raw) {
  const briefing = {};
  const rejected = [];
  for (const key of BRIEF_CATEGORIES) {
    const arr = raw?.[key];
    if (arr == null) continue;
    if (!Array.isArray(arr)) {
      rejected.push(`briefing.${key}: 배열이 아님`);
      continue;
    }
    const lines = [];
    for (const l of arr) {
      const t = typeof l === 'string' ? l.replace(/\s+/g, ' ').trim() : '';
      if (!t) rejected.push(`briefing.${key}: 빈 줄/문자열 아님`);
      else if ([...t].length > BRIEF_MAX) rejected.push(`briefing.${key}: ${BRIEF_MAX}자 초과 "${t.slice(0, 20)}…"`);
      else if (RELATIVE_TIME.test(t)) rejected.push(`briefing.${key}: 상대 시점 표현("${t.match(RELATIVE_TIME)[0]}") 포함 "${t.slice(0, 24)}…"`);
      else lines.push(t);
    }
    if (lines.length) briefing[key] = lines.slice(0, BRIEF_LINES);
  }
  return { briefing, rejected };
}

/**
 * 주별 요약을 합친다. 이번 주 요약은 새 것으로 교체하되 새 요약이 비어 있으면 기존 것을 유지하고,
 * 보관 기간보다 오래된 주는 정리한다.
 */
export function mergeBriefings(existing, briefing, { now }) {
  const week = mondayOf(now);
  const oldest = oldestKeptWeek(week);
  const hasNew = Object.keys(briefing).length > 0;
  const kept = Object.fromEntries(Object.entries(existing ?? {}).filter(([w]) => w >= oldest && (w !== week || !hasNew)));
  return hasNew ? { ...kept, [week]: briefing } : kept;
}

export function summarizeChange(before, after) {
  const key = (i) => JSON.stringify(i);
  const b = new Set(before.map(key));
  const a = new Set(after.map(key));
  return { added: after.filter((i) => !b.has(key(i))).length, removed: before.filter((i) => !a.has(key(i))).length };
}

export { KEEP_WEEKS, kstParts };

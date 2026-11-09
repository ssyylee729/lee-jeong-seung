// Claude 가 돌려준 조사 결과를 검증하고 info.json 에 합치는 순수 함수들.
// 웹에서 가져온 내용이 그대로 앱에 들어가므로, 여기서 형식과 URL 을 엄격하게 거른다.
import { addDays, kstParts, mondayOf } from '../../public/lib/week.js';

export const CONCERT_SITES = ['인터파크', 'YES24', '티켓링크', '멜론티켓'];
export const CULTURE_TYPES = ['영화', 'OTT', '도서', '전시'];

const OPEN_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_WEEKS = 26;

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
 * 기존 items 에 새 결과를 합친다.
 *  - 이번 주(week) 항목은 통째로 교체 (같은 주에 다시 돌려도 중복되지 않는다)
 *  - 이전 주에 적힌 "아직 오픈 전" 공연은 새 결과로 대체. 단, 새 결과에 같은 artist 가 없으면 그대로 보존
 *  - 오래된 항목(KEEP_WEEKS 주 이전)은 정리
 */
export function mergeItems(existing, accepted, { now }) {
  const week = mondayOf(now);
  const oldest = addDays(week, -7 * KEEP_WEEKS);
  const newArtists = new Set(accepted.concerts.map((c) => c.artist));

  const kept = existing.filter((i) => {
    if (i.week === week) return false;
    if (i.week < oldest) return false;
    if (isUpcomingConcert(i, now)) return !newArtists.has(i.artist); // 새 결과가 없는 건 보존
    return true;
  });

  const fresh = [...accepted.concerts, ...accepted.culture].map((i) => ({ week, ...i }));
  return [...kept, ...fresh];
}

export function summarizeChange(before, after) {
  const key = (i) => JSON.stringify(i);
  const b = new Set(before.map(key));
  const a = new Set(after.map(key));
  return { added: after.filter((i) => !b.has(key(i))).length, removed: before.filter((i) => !a.has(key(i))).length };
}

export { kstParts };

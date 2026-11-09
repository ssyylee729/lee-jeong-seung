// 닉네임 정규화와 공유용 링크/문구 만들기. DOM 에 의존하지 않아서 Node 에서 테스트한다.

export const DEFAULT_NICKNAME = '정승자매';
export const NICKNAME_MAX = 12;
export const DEFAULT_CATEGORY = 'concert';

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

/** 공백을 정리하고 길이를 자른다. 비어 있으면 기본 닉네임. */
export function normalizeNickname(input) {
  const n = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...n].slice(0, NICKNAME_MAX).join('') || DEFAULT_NICKNAME;
}

/** 공유 링크: 앱 주소 + 보고 있는 주/카테고리 */
export function viewUrl(base, { week, category }) {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  if (week) u.searchParams.set('week', week);
  if (category && category !== DEFAULT_CATEGORY) u.searchParams.set('cat', category);
  return u.href;
}

/**
 * 주소의 ?week=&cat= 를 읽어 유효한 값만 돌려준다. (공유 링크가 오래됐거나 조작돼도 안전하게 기본값으로)
 * 카테고리가 없거나 잘못되면 기본 카테고리(공연 예매).
 * @returns {{ week: string|null, category: string }}
 */
export function parseView(search, { weeks, categories }) {
  const p = new URLSearchParams(search);
  const week = p.get('week');
  const cat = p.get('cat');
  return {
    week: week && WEEK.test(week) && weeks.includes(week) ? week : null,
    category: cat && categories.includes(cat) ? cat : DEFAULT_CATEGORY,
  };
}

/** 카드 하나를 메신저에 보내기 좋은 텍스트로 */
export function cardShareText(card, { categoryLabel, nickname, link }) {
  const lines = [`[${categoryLabel}] ${card.title}`];
  if (card.when) lines.push(card.when);
  if (card.summary) lines.push(card.summary);
  if (card.rating) lines.push(`⭐ ${card.rating}`);
  if (card.unverified) lines.push('⚠️ 공식 공지 확인 필요');
  if (card.url) lines.push(card.url);
  lines.push('', `보낸 사람: ${normalizeNickname(nickname)}`, link);
  return lines.join('\n');
}

/** 화면 전체(주 + 카테고리) 공유 텍스트 */
export function viewShareText({ weekLabel, categoryLabel, nickname, link }) {
  const where = categoryLabel ? ` · ${categoryLabel}` : '';
  return [`🍀 라니네 전용 앱 · ${weekLabel}${where}`, '', `보낸 사람: ${normalizeNickname(nickname)}`, link].join('\n');
}

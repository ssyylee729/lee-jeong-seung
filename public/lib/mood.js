// 화면 상태에 맞는 라니 표정을 고른다. 표정 이미지는 public/rani/<mood>.svg
export const MOODS = {
  neutral: { label: '기본', say: '오늘도 놓친 거 없나 보고 있다냥' },
  happy: { label: '신남', say: '축하할 일이 코앞이다냥!' },
  sad: { label: '시무룩', say: '이번 주는 아직 아무것도 없다냥…' },
};

const SOON_DAYS = 3;

/**
 * @param {{ category: string, cards: object[] }} view  화면에 보이는 카드들
 */
export function pickMood({ category, cards }) {
  if (!cards.length) return 'sad';
  if (category === 'family' && cards.some((c) => c.daysLeft <= SOON_DAYS)) return 'happy';
  return 'neutral';
}

// 보관 기간: 이번 주를 포함해 최근 8주(약 두 달). 앱 화면과 주간 자동 정리가 같은 기준을 쓴다.
import { addDays } from './week.js';

export const KEEP_WEEKS = 8;

/** 보관하는 가장 오래된 주의 월요일 (이번 주 월요일 기준 7주 전) */
export function oldestKeptWeek(thisMonday) {
  return addDays(thisMonday, -7 * (KEEP_WEEKS - 1));
}

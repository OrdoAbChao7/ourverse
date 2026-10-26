import { calendarDaysBetween, parseLocalDate, todayDateString } from '@/lib/date';
import type { Anniversary, RepeatRule } from './types';

export interface AnniversaryOccurrence {
  /** The upcoming (or most recent) calendar occurrence. */
  nextDate: Date;
  /** Whole days from today's local date. Negative when a one-off date has passed. */
  daysUntil: number;
  /** Completed years at that occurrence (0 for the first year / one-off events). */
  years: number;
  isToday: boolean;
  state: 'upcoming' | 'today' | 'passed';
  /** Total days elapsed since the original date, for "第 N 天" style copy. */
  elapsedDays: number;
}

function occurrenceInYear(original: Date, year: number): Date {
  const month = original.getMonth();
  const day = original.getDate();
  // 2 月 29 日在平年落到 2 月 28 日，避免出现不存在的日期。
  if (month === 1 && day === 29) {
    const candidate = new Date(year, 1, 29);
    if (candidate.getMonth() !== 1) return new Date(year, 1, 28);
    return candidate;
  }
  return new Date(year, month, day);
}

export function nextOccurrence(
  date: string,
  repeat: RepeatRule,
  now: Date = new Date(),
): AnniversaryOccurrence {
  const original = parseLocalDate(date);
  const today = parseLocalDate(todayDateString(now));

  if (repeat === 'once') {
    const daysUntil = calendarDaysBetween(today, original);
    return {
      nextDate: original,
      daysUntil,
      years: 0,
      isToday: daysUntil === 0,
      state: daysUntil > 0 ? 'upcoming' : daysUntil === 0 ? 'today' : 'passed',
      elapsedDays: calendarDaysBetween(original, today),
    };
  }

  let candidate = occurrenceInYear(original, today.getFullYear());
  if (candidate.getTime() < today.getTime()) {
    candidate = occurrenceInYear(original, today.getFullYear() + 1);
  }
  const daysUntil = calendarDaysBetween(today, candidate);
  const years = candidate.getFullYear() - original.getFullYear();
  return {
    nextDate: candidate,
    daysUntil,
    years,
    isToday: daysUntil === 0,
    state: daysUntil === 0 ? 'today' : 'upcoming',
    elapsedDays: calendarDaysBetween(original, today),
  };
}

export interface AnniversaryWithOccurrence extends Anniversary {
  occurrence: AnniversaryOccurrence;
}

/** Upcoming first (nearest first), then passed (most recent first). */
export function sortAnniversaries<T extends Anniversary>(items: T[], now: Date = new Date()): AnniversaryWithOccurrence[] {
  return items
    .map((item) => ({ ...item, occurrence: nextOccurrence(item.date, item.repeat, now) }))
    .sort((a, b) => {
      const aPassed = a.occurrence.state === 'passed';
      const bPassed = b.occurrence.state === 'passed';
      if (aPassed !== bPassed) return aPassed ? 1 : -1;
      if (aPassed) return b.occurrence.daysUntil - a.occurrence.daysUntil;
      return a.occurrence.daysUntil - b.occurrence.daysUntil;
    });
}

/** "相伴第 128 天" — only rendered when the pair explicitly set a start date. */
export function daysTogether(startDate: string, now: Date = new Date()): number {
  const start = parseLocalDate(startDate);
  const today = parseLocalDate(todayDateString(now));
  return Math.max(1, calendarDaysBetween(start, today) + 1);
}

export function describeOccurrence(occurrence: AnniversaryOccurrence): string {
  if (occurrence.state === 'today') {
    return occurrence.years > 0 ? `第 ${occurrence.years} 周年 · 就是今天` : '就是今天';
  }
  if (occurrence.state === 'passed') {
    return `已过去 ${Math.abs(occurrence.daysUntil)} 天`;
  }
  if (occurrence.daysUntil === 1) return '明天';
  return `${occurrence.daysUntil} 天后`;
}

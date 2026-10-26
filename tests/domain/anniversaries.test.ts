import { describe, expect, it } from 'vitest';
import {
  daysTogether,
  describeOccurrence,
  nextOccurrence,
  sortAnniversaries,
} from '@/domain/anniversaries';
import type { Anniversary } from '@/domain/types';

const now = new Date(2026, 9, 26, 10, 30); // 2026-10-26 local

function anniversary(overrides: Partial<Anniversary> = {}): Anniversary {
  return {
    id: 'ann-1',
    spaceId: 'space-1',
    authorId: 'user-a',
    name: '初次见面',
    date: '2025-11-18',
    repeat: 'yearly',
    visibility: 'shared',
    note: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('nextOccurrence', () => {
  it('rolls a yearly date forward and counts whole calendar days', () => {
    const result = nextOccurrence('2025-11-18', 'yearly', now);
    expect(result.nextDate.getFullYear()).toBe(2026);
    expect(result.nextDate.getMonth()).toBe(10);
    expect(result.nextDate.getDate()).toBe(18);
    expect(result.daysUntil).toBe(23);
    expect(result.years).toBe(1);
    expect(result.state).toBe('upcoming');
  });

  it('treats today as today, not as next year', () => {
    const result = nextOccurrence('2025-10-26', 'yearly', now);
    expect(result.isToday).toBe(true);
    expect(result.state).toBe('today');
    expect(result.years).toBe(1);
    expect(describeOccurrence(result)).toContain('就是今天');
  });

  it('skips to next year once this year’s date has passed', () => {
    const result = nextOccurrence('2025-10-25', 'yearly', now);
    expect(result.nextDate.getFullYear()).toBe(2027);
    expect(result.daysUntil).toBe(364);
  });

  it('maps Feb 29 to Feb 28 in non-leap years', () => {
    const result = nextOccurrence('2024-02-29', 'yearly', new Date(2026, 0, 15));
    expect(result.nextDate.getMonth()).toBe(1);
    expect(result.nextDate.getDate()).toBe(28);
    expect(result.years).toBe(2);
  });

  it('keeps one-off dates fixed and reports them as passed', () => {
    const result = nextOccurrence('2026-03-30', 'once', now);
    expect(result.state).toBe('passed');
    expect(result.daysUntil).toBeLessThan(0);
    expect(describeOccurrence(result)).toContain('已过去');
  });

  it('counts elapsed days for a one-off date', () => {
    const result = nextOccurrence('2026-10-16', 'once', now);
    expect(result.state).toBe('passed');
    expect(result.elapsedDays).toBe(10);
  });
});

describe('sortAnniversaries', () => {
  it('puts upcoming dates first (nearest first), then passed (recent first)', () => {
    const items = [
      anniversary({ id: 'passed', date: '2026-01-01', repeat: 'once' }),
      anniversary({ id: 'far', date: '2025-06-01', repeat: 'yearly' }), // next 2027-06-01? no: 2027
      anniversary({ id: 'near', date: '2025-11-01', repeat: 'yearly' }),
    ];
    const sorted = sortAnniversaries(items, now);
    expect(sorted[0]?.id).toBe('near');
    expect(sorted[1]?.id).toBe('far');
    expect(sorted[2]?.id).toBe('passed');
  });
});

describe('daysTogether', () => {
  it('counts inclusively from the configured start date', () => {
    expect(daysTogether('2026-10-26', now)).toBe(1);
    expect(daysTogether('2026-10-20', now)).toBe(7);
  });
});

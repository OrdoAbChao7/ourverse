import { describe, expect, it } from 'vitest';
import { buildStarMap, findStarAt } from '@/domain/stars';
import { memory } from '../helpers/fixtures';

const memories = [
  memory({ id: 'm1', occurredOn: '2025-07-12', occurredAt: '2025-07-12T04:00:00.000Z' }),
  memory({ id: 'm2', occurredOn: '2025-07-20', occurredAt: '2025-07-20T04:00:00.000Z' }),
  memory({ id: 'm3', occurredOn: '2025-07-20', occurredAt: '2025-07-20T06:00:00.000Z' }),
  memory({ id: 'm4', occurredOn: '2025-03-01', occurredAt: '2025-03-01T04:00:00.000Z' }),
  memory({ id: 'm5', occurredOn: '2024-12-31', occurredAt: '2024-12-31T04:00:00.000Z' }),
  memory({ id: 'm6', occurredOn: '2024-12-01', occurredAt: '2024-12-01T04:00:00.000Z' }),
];

describe('buildStarMap', () => {
  it('maps every memory to exactly one real star (no decorative fake stars)', () => {
    const map = buildStarMap(memories, { width: 1200 });
    expect(map.stars).toHaveLength(memories.length);
    const starIds = map.stars.map((star) => star.memoryId).sort();
    expect(starIds).toEqual(memories.map((item) => item.id).sort());
    expect(new Set(starIds).size).toBe(starIds.length);
  });

  it('groups stars into month constellations, newest month first', () => {
    const map = buildStarMap(memories, { width: 1200 });
    expect(map.constellations.map((item) => item.monthKey)).toEqual(['2025-07', '2025-03', '2024-12']);
    const july = map.constellations[0];
    expect(july?.starMemoryIds).toHaveLength(3);
    expect(july?.lines).toHaveLength(2);
    expect(map.months.map((month) => month.label)).toEqual(['2025年7月', '2025年3月', '2024年12月']);
  });

  it('is deterministic for the same input', () => {
    const first = buildStarMap(memories, { width: 900 });
    const second = buildStarMap(memories, { width: 900 });
    expect(second.stars).toEqual(first.stars);
    expect(second.constellations).toEqual(first.constellations);
  });

  it('keeps all points inside the declared canvas', () => {
    const map = buildStarMap(memories, { width: 375 });
    for (const star of map.stars) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(map.width);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThanOrEqual(map.height);
    }
    expect(map.height).toBeGreaterThanOrEqual(map.months.length * 100);
  });

  it('handles an empty archive without inventing content', () => {
    const map = buildStarMap([], { width: 1000 });
    expect(map.stars).toEqual([]);
    expect(map.constellations).toEqual([]);
    expect(map.months).toEqual([]);
  });
});

describe('findStarAt', () => {
  it('returns the nearest star within the hit radius', () => {
    const map = buildStarMap(memories, { width: 1200 });
    const target = map.stars[0]!;
    const hit = findStarAt(map.stars, target.x + 3, target.y - 2);
    expect(hit?.memoryId).toBe(target.memoryId);
    expect(findStarAt(map.stars, target.x + 500, target.y + 500)).toBeNull();
  });
});

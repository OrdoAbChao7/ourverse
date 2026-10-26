/**
 * Deterministic star-map layout.
 *
 * Every star maps to exactly one memory — the layout never invents decorative
 * "fake" stars that cannot be opened. Months become constellations, filled in
 * chronological order, so the sky can only change when the memories change.
 */
import { monthKeyOf, parseMonthKey } from '@/lib/date';
import type { Memory } from './types';

export interface StarPoint {
  memoryId: string;
  x: number;
  y: number;
  radius: number;
  brightness: number;
  phase: number;
  monthKey: string;
  indexInMonth: number;
}

export interface ConstellationLine {
  from: string;
  to: string;
}

export interface Constellation {
  id: string;
  label: string;
  monthKey: string;
  year: number;
  month: number;
  starMemoryIds: string[];
  lines: ConstellationLine[];
  anchorX: number;
  anchorY: number;
}

export interface MonthAnchor {
  monthKey: string;
  label: string;
  x: number;
  y: number;
  year: number;
}

export interface StarMap {
  width: number;
  height: number;
  stars: StarPoint[];
  constellations: Constellation[];
  months: MonthAnchor[];
}

export interface StarMapOptions {
  width: number;
  /** Vertical space given to each month constellation. */
  bandHeight?: number;
  minHeight?: number;
}

type MemoryLike = Pick<Memory, 'id' | 'occurredOn' | 'occurredAt' | 'attachments'>;

const SIDE_PADDING = 64;
const TOP_PADDING = 84;

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 0..1 deterministic pseudo-random value derived from an id + salt. */
function unitRandom(id: string, salt: string): number {
  return (hashString(`${id}:${salt}`) % 10_000) / 10_000;
}

export function buildStarMap(memories: MemoryLike[], options: StarMapOptions): StarMap {
  const width = Math.max(320, Math.round(options.width));
  const bandHeight = options.bandHeight ?? 128;
  const innerWidth = Math.max(160, width - SIDE_PADDING * 2);

  const groups = new Map<string, MemoryLike[]>();
  for (const memory of memories) {
    const key = monthKeyOf(memory.occurredOn);
    const bucket = groups.get(key);
    if (bucket) bucket.push(memory);
    else groups.set(key, [memory]);
  }

  const monthKeys = [...groups.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first

  const stars: StarPoint[] = [];
  const constellations: Constellation[] = [];
  const months: MonthAnchor[] = [];

  monthKeys.forEach((monthKey, monthIndex) => {
    const bucket = groups.get(monthKey) ?? [];
    bucket.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : 1));

    const anchorY = TOP_PADDING + monthIndex * bandHeight;
    const monthDate = parseMonthKey(monthKey);
    const label = `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`;

    months.push({ monthKey, label, x: SIDE_PADDING, y: anchorY - 30, year: monthDate.getFullYear() });

    const monthStarIds: string[] = [];
    bucket.forEach((memory, indexInMonth) => {
      const day = Number(memory.occurredOn.slice(8, 10)) || 1;
      const dayFraction = Math.min(1, Math.max(0, (day - 1) / 30));
      const jitterX = (unitRandom(memory.id, 'x') - 0.5) * 34;
      const jitterY = (unitRandom(memory.id, 'y') - 0.5) * (bandHeight * 0.52);
      const x = SIDE_PADDING + dayFraction * innerWidth + jitterX;
      const y = anchorY + jitterY;
      const hasMedia = memory.attachments.length > 0;
      stars.push({
        memoryId: memory.id,
        x,
        y,
        radius: (hasMedia ? 2.6 : 2.0) + unitRandom(memory.id, 'r') * 1.1,
        brightness: 0.62 + unitRandom(memory.id, 'b') * 0.38,
        phase: unitRandom(memory.id, 'p') * Math.PI * 2,
        monthKey,
        indexInMonth,
      });
      monthStarIds.push(memory.id);
    });

    const lines: ConstellationLine[] = [];
    for (let i = 0; i < monthStarIds.length - 1; i += 1) {
      lines.push({ from: monthStarIds[i] as string, to: monthStarIds[i + 1] as string });
    }

    constellations.push({
      id: `constellation-${monthKey}`,
      label,
      monthKey,
      year: monthDate.getFullYear(),
      month: monthDate.getMonth() + 1,
      starMemoryIds: monthStarIds,
      lines,
      anchorX: SIDE_PADDING,
      anchorY,
    });
  });

  const height = Math.max(
    options.minHeight ?? 420,
    TOP_PADDING * 2 + Math.max(1, monthKeys.length) * bandHeight,
  );

  return { width, height, stars, constellations, months };
}

/** Finds the nearest star within the hit radius (for canvas pointer interaction). */
export function findStarAt(stars: StarPoint[], x: number, y: number, hitRadius = 18): StarPoint | null {
  let best: StarPoint | null = null;
  let bestDistance = hitRadius;
  for (const star of stars) {
    const dx = star.x - x;
    const dy = star.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      best = star;
      bestDistance = distance;
    }
  }
  return best;
}

import { describe, expect, it } from 'vitest';
import { MonotonicClock } from '@/data/local/clock';

function controlledClock() {
  let wall = 1_700_000_000_000;
  let mono = 1_000;
  const clock = new MonotonicClock({
    wallNow: () => wall,
    monotonicNow: () => mono,
  });
  return {
    clock,
    advance(ms: number) {
      mono += ms;
    },
    jumpWall(ms: number) {
      wall += ms;
    },
    get wall() {
      return wall;
    },
  };
}

describe('MonotonicClock', () => {
  it('advances with the monotonic source', () => {
    const harness = controlledClock();
    const start = harness.clock.now().getTime();
    harness.advance(5000);
    expect(harness.clock.now().getTime()).toBe(start + 5000);
  });

  it('ignores a forward system-clock jump (time capsule tampering)', () => {
    const harness = controlledClock();
    const start = harness.clock.now().getTime();
    harness.jumpWall(86_400_000); // user moves the OS clock forward by a day
    harness.advance(1000);
    expect(harness.clock.now().getTime()).toBe(start + 1000);
  });

  it('ignores a backward system-clock jump', () => {
    const harness = controlledClock();
    const start = harness.clock.now().getTime();
    harness.jumpWall(-86_400_000);
    harness.advance(2000);
    expect(harness.clock.now().getTime()).toBe(start + 2000);
  });

  it('is monotonic even if the underlying monotonic source regresses', () => {
    const harness = controlledClock();
    const start = harness.clock.now().getTime();
    harness.advance(-500);
    expect(harness.clock.now().getTime()).toBe(start);
  });
});

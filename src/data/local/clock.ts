/**
 * The local (demo) backend has no server, so it still needs a clock it can
 * defend as "the app's clock" rather than "whatever the OS says right now".
 *
 * We anchor once per page session and advance with `performance.now()`, which
 * is monotonic and unaffected by the user changing the system clock. That makes
 * a forward clock jump (the classic way to peek into a time capsule early)
 * ineffective for as long as the app is open.
 *
 * Honest limitation: a purely offline client cannot detect a clock change made
 * before the session starts. Real enforcement lives in Postgres (`now()` +
 * RLS) — see docs/privacy.md and docs/DECISIONS.md.
 */
export interface ClockSources {
  wallNow: () => number;
  monotonicNow: () => number;
}

const defaultSources: ClockSources = {
  wallNow: () => Date.now(),
  monotonicNow: () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now(),
};

export class MonotonicClock {
  private readonly wallAnchor: number;
  private readonly monoAnchor: number;
  private readonly sources: ClockSources;

  constructor(sources: ClockSources = defaultSources) {
    this.sources = sources;
    this.wallAnchor = sources.wallNow();
    this.monoAnchor = sources.monotonicNow();
  }

  now(): Date {
    const elapsed = Math.max(0, this.sources.monotonicNow() - this.monoAnchor);
    return new Date(this.wallAnchor + elapsed);
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

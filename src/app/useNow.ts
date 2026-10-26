import { useEffect, useState } from 'react';
import { useRepository } from '@/app/RepositoryContext';

/**
 * Reads the authoritative clock and re-reads it on an interval. In the local
 * backend this is the monotonic clock; in Supabase it is `select now()`.
 */
export function useAuthoritativeNow(intervalMs = 1000): Date {
  const repo = useRepository();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    const tick = () => {
      void repo.now().then((value) => {
        if (active) setNow(value);
      });
    };
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [repo, intervalMs]);

  return now;
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · OURVERSE`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncResult<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (updater: T | null | ((current: T | null) => T | null)) => void;
}

export function useAsync<T>(factory: () => Promise<T>, deps: DependencyList): AsyncResult<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    setLoading(true);
    setError(null);
    factoryRef
      .current()
      .then((result) => {
        if (!activeRef.current) return;
        setDataState(result);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!activeRef.current) return;
        setError(loadError);
        setLoading(false);
      });
    return () => {
      activeRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const setData = useCallback((updater: T | null | ((current: T | null) => T | null)) => {
    setDataState((current) =>
      typeof updater === 'function' ? (updater as (value: T | null) => T | null)(current) : updater,
    );
  }, []);

  return { data, error, loading, reload, setData };
}

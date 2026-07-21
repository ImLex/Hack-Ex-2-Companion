import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

const DATA_CHANGED_EVENT = 'trakker3.data_changed';

/** Re-runs every mounted useQuery — call after an import lands new rows. */
export function notifyDataChanged(): void {
  DeviceEventEmitter.emit(DATA_CHANGED_EVENT);
}

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useQuery<T>(
  query: (db: SQLiteDatabase) => Promise<T>,
  deps: unknown[] = [],
): QueryState<T> {
  const db = useSQLiteContext();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Ref so a new query fn each render doesn't restart the query.
  const queryRef = useRef(query);
  queryRef.current = query;

  // Drops results from a slow query that finishes after a newer one started.
  const runIdRef = useRef(0);

  const run = useCallback(async () => {
    const runId = ++runIdRef.current;
    try {
      const result = await queryRef.current(db);
      if (runId !== runIdRef.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (runId !== runIdRef.current) return;
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      if (runId === runIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useEffect(() => {
    setLoading(true);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Re-run on focus so returning from an edit screen shows fresh data.
  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  // Background imports change data without any navigation happening; foreground
  // re-query covers anything missed while the process was cached.
  useEffect(() => {
    const dataSub = DeviceEventEmitter.addListener(DATA_CHANGED_EVENT, run);
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => {
      dataSub.remove();
      appSub.remove();
    };
  }, [run]);

  return { data, loading, error, refresh: run };
}

/** `running` guards against double-submit. */
export function useMutation(): {
  db: SQLiteDatabase;
  running: boolean;
  run: (action: (db: SQLiteDatabase) => Promise<void>) => Promise<void>;
} {
  const db = useSQLiteContext();
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (action: (db: SQLiteDatabase) => Promise<void>) => {
      if (running) return;
      setRunning(true);
      try {
        await action(db);
      } finally {
        setRunning(false);
      }
    },
    [db, running],
  );

  return { db, running, run };
}

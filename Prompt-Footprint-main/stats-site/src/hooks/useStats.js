import { useState, useEffect, useCallback } from 'react';
import { fetchWeeklyStats, fetchSessions, fetchSavings } from '../lib/api';

// The data layer resolves context itself (extension local data vs. demo),
// so the hooks no longer require a userId.
//
// Each hook also returns `reload`, so an error state can offer a real retry
// instead of asking the user to refresh the whole page.

function useAsyncData(fetcher, initial) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `fetcher` is a module-level function; `attempt` is what re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, error, reload };
}

export function useWeeklyStats() {
  return useAsyncData(fetchWeeklyStats, null);
}

export function useSessions() {
  const { data, loading, error, reload } = useAsyncData(fetchSessions, []);
  return { sessions: data || [], loading, error, reload };
}

export function useSavings() {
  return useAsyncData(fetchSavings, null);
}

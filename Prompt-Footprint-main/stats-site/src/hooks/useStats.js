import { useState, useEffect } from 'react';
import { fetchWeeklyStats, fetchSessions, getUserIdFromUrl } from '../lib/api';

export function useWeeklyStats() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const userId = getUserIdFromUrl();
    if (!userId) {
      setError('No userId provided in URL');
      setLoading(false);
      return;
    }
    fetchWeeklyStats(userId)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useSessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const userId = getUserIdFromUrl();
    if (!userId) {
      setError('No userId provided in URL');
      setLoading(false);
      return;
    }
    fetchSessions(userId)
      .then(setSessions)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { sessions, loading, error };
}

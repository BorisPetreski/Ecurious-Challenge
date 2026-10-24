import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchEvents, type EventFeed } from '@/lib/events-api';

export function useEvents(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<EventFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchEvents(controller.signal);
      if (!controller.signal.aborted && request.current === controller) setSnapshot(next);
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) setError(cause instanceof Error ? cause.message : 'Events could not be loaded.');
    } finally {
      if (!controller.signal.aborted && request.current === controller) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (enabled) void refresh();
    else { request.current?.abort(); setLoading(false); }
    return () => request.current?.abort();
  }, [enabled, refresh]);
  return { snapshot, loading, error, refresh };
}

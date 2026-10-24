import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  API_BASE_URL,
  createReservation,
  fetchReservationState,
  performAction,
  type ReservationAction,
  type ReservationActionOptions,
  type ReservationState,
} from '../lib/reservation-api';

export interface UseReservationResult {
  state: ReservationState | null;
  loading: boolean;
  refreshing: boolean;
  busy: boolean;
  error: string | null;
  apiBaseUrl: string;
  refresh: () => Promise<void>;
  reserve: (plate: string, holdMinutes: number) => Promise<void>;
  act: (action: ReservationAction, options?: ReservationActionOptions) => Promise<void>;
}

interface Operation {
  id: number;
  kind: 'read' | 'mutation';
  promise: Promise<void>;
  controller?: AbortController;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The simulator request failed. Pull to refresh and try again.';
}

/** Share one hook instance through the UI provider so tabs use one polling loop. */
export function useReservation(): UseReservationResult {
  const [state, setState] = useState<ReservationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<ReservationState | null>(null);
  const mountedRef = useRef(false);
  const appStateRef = useRef<string>(AppState.currentState ?? 'active');
  const operationRef = useRef<Operation | null>(null);
  const sequenceRef = useRef(0);

  const read = useCallback((silent: boolean): Promise<void> => {
    if (!mountedRef.current || appStateRef.current !== 'active') return Promise.resolve();
    // A poll, pull-to-refresh, and a write must never compete for state.
    if (operationRef.current) return operationRef.current.promise;
    const operation: Operation = {
      id: ++sequenceRef.current,
      kind: 'read',
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    operationRef.current = operation;
    const isCurrent = () => mountedRef.current && operationRef.current?.id === operation.id;
    setLoading(stateRef.current === null);
    setRefreshing(!silent && stateRef.current !== null);

    operation.promise = (async () => {
      try {
        const next = await fetchReservationState({ signal: operation.controller?.signal });
        if (!isCurrent() || operation.controller?.signal.aborted) return;
        stateRef.current = next;
        setState(next);
        setError(null);
      } catch (cause) {
        if (isCurrent() && !operation.controller?.signal.aborted) setError(errorMessage(cause));
      } finally {
        if (isCurrent()) {
          operationRef.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return operation.promise;
  }, []);

  const mutate = useCallback(async (request: () => Promise<ReservationState>): Promise<void> => {
    if (!mountedRef.current) return;
    const previous = operationRef.current;
    if (previous?.kind === 'mutation') return previous.promise;
    if (previous) {
      previous.controller?.abort();
      // Wait for the aborted read to settle before sending a write.
      await previous.promise;
      if (!mountedRef.current) return;
      if (operationRef.current) return operationRef.current.promise;
    }
    const operation: Operation = {
      id: ++sequenceRef.current,
      kind: 'mutation',
      promise: Promise.resolve(),
    };
    operationRef.current = operation;
    const isCurrent = () => mountedRef.current && operationRef.current?.id === operation.id;
    setBusy(true);
    setRefreshing(false);

    operation.promise = (async () => {
      try {
        const next = await request();
        if (!isCurrent()) return;
        stateRef.current = next;
        setState(next);
        setError(null);
      } catch (cause) {
        // Keep the last observation on failure, with error visible to the UI.
        // A failed write is never retried automatically: its outcome may be unknown.
        if (isCurrent()) setError(errorMessage(cause));
      } finally {
        if (isCurrent()) {
          operationRef.current = null;
          setBusy(false);
          setLoading(false);
        }
      }
    })();
    return operation.promise;
  }, []);

  const refresh = useCallback(() => read(false), [read]);
  const reserve = useCallback((plate: string, holdMinutes: number) => mutate(() => createReservation(plate, holdMinutes)), [mutate]);
  const act = useCallback((action: ReservationAction, options?: ReservationActionOptions) => mutate(() => performAction(action, options)), [mutate]);

  useEffect(() => {
    mountedRef.current = true;
    void read(false);
    const timer = setInterval(() => {
      if (appStateRef.current === 'active') void read(true);
    }, 2_000);
    const subscription = AppState.addEventListener('change', next => {
      appStateRef.current = next;
      if (next === 'active') {
        void read(true);
      } else if (operationRef.current?.kind === 'read') {
        operationRef.current.controller?.abort();
      }
    });
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      subscription.remove();
      operationRef.current?.controller?.abort();
      operationRef.current = null;
    };
  }, [read]);

  return { state, loading, refreshing, busy, error, apiBaseUrl: API_BASE_URL, refresh, reserve, act };
}

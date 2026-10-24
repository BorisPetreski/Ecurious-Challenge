import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  BOOKINGS_CONFIGURED, BookingApiError, cancelDirectoryHold, extendDirectoryBooking, fetchDirectoryHolds,
  reserveDirectoryBooking, reserveDirectoryPlug,
} from '@/lib/bookings-api';
import {
  canonicalDirectoryStationIds, isDirectorySlotKey,
  type DirectoryBooking, type DirectoryBookingOptions, type DirectoryHoldSnapshot, type DirectoryReservation, type HoldMinutes,
} from '@/lib/directory-booking-contract';

export interface UseDirectoryBookingsResult {
  configured: boolean;
  loading: boolean;
  refreshing: boolean;
  busy: boolean;
  error: string | null;
  snapshot: DirectoryHoldSnapshot | null;
  reservation: DirectoryReservation | null;
  /** Only this successfully queried set has a complete app-hold observation. */
  queriedStationIds: number[];
  fresh: boolean;
  refresh: () => Promise<void>;
  reserve: (stationId: number, slotKey: string, minutes: HoldMinutes) => Promise<DirectoryReservation | null>;
  reserveBooking: (stationId: number, slotKey: string, options: DirectoryBookingOptions) => Promise<DirectoryBooking | null>;
  extend: (reservationId: string) => Promise<DirectoryBooking | null>;
  cancel: (reservationId: string) => Promise<boolean>;
}

interface Scope { key: string; ids: number[] }
interface Observation { scopeKey: string; ids: number[]; at: number; snapshot: DirectoryHoldSnapshot }
interface Operation {
  id: number;
  kind: 'read' | 'mutation';
  scopeKey?: string;
  controller?: AbortController;
  promise: Promise<unknown>;
}

const POLL_MS = 10_000;
const MAX_OBSERVATION_AGE_MS = 25_000;

function safeError(cause: unknown): string {
  return cause instanceof BookingApiError ? cause.message : 'Directory app reservations could not be confirmed. Refresh before trying another action.';
}

/** Separate app-only plug holds; the registered-bay provider owns guest auth. */
export function useDirectoryBookings(stationIds: readonly number[]): UseDirectoryBookingsResult {
  const canonicalIds = canonicalDirectoryStationIds(stationIds);
  const scopeKey = canonicalIds?.join(',') ?? null;
  const scopeRef = useRef<Scope | null>(null);
  // Scope changes invalidate the returned freshness during this render, before
  // effects or network responses can run. Mutations check this same scope.
  scopeRef.current = canonicalIds && scopeKey !== null ? { key: scopeKey, ids: canonicalIds } : null;

  const [observation, setObservation] = useState<Observation | null>(null);
  const [reservation, setReservation] = useState<DirectoryReservation | null>(null);
  const [loading, setLoading] = useState(BOOKINGS_CONFIGURED);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshState, setFreshState] = useState(false);
  const observationRef = useRef<Observation | null>(null);
  const freshRef = useRef(false);
  const mounted = useRef(false);
  const appState = useRef<string>(AppState.currentState ?? 'active');
  const operationRef = useRef<Operation | null>(null);
  const sequence = useRef(0);

  const markFresh = useCallback((next: boolean) => {
    freshRef.current = next;
    if (mounted.current) setFreshState(next);
  }, []);

  const accept = useCallback((snapshot: DirectoryHoldSnapshot, scope: Scope): boolean => {
    if (!mounted.current || scopeRef.current?.key !== scope.key) return false;
    const next: Observation = { snapshot, scopeKey: scope.key, ids: scope.ids, at: Date.now() };
    observationRef.current = next;
    setObservation(next);
    markFresh(appState.current === 'active');
    setReservation(previous => previous && (snapshot.holds.some(hold => hold.myReservationId === previous.id) ||
      snapshot.myBookings?.some(booking => booking.id === previous.id)) ? previous : null);
    return true;
  }, [markFresh]);

  const read = useCallback(async (silent: boolean): Promise<void> => {
    if (!BOOKINGS_CONFIGURED || !mounted.current || appState.current !== 'active') return;
    const previous = operationRef.current;
    if (previous) {
      if (previous.kind === 'read' && previous.scopeKey !== scopeRef.current?.key) {
        previous.controller?.abort();
        await previous.promise;
        // Another caller may have started the same replacement read meanwhile.
        if (operationRef.current) {
          await operationRef.current.promise;
          return;
        }
      } else {
        await previous.promise;
        return;
      }
    }
    const scope = scopeRef.current;
    if (!mounted.current || appState.current !== 'active') return;
    if (!scope) {
      markFresh(false);
      setLoading(false);
      setError('Search an area with at most 500 valid directory locations before refreshing app reservations.');
      return;
    }
    const operation: Operation = {
      id: ++sequence.current, kind: 'read', scopeKey: scope.key,
      controller: new AbortController(), promise: Promise.resolve(),
    };
    operationRef.current = operation;
    const current = () => mounted.current && operationRef.current?.id === operation.id;
    setLoading(observationRef.current === null);
    setRefreshing(!silent && observationRef.current !== null);
    operation.promise = (async () => {
      try {
        const next = await fetchDirectoryHolds(scope.ids, operation.controller?.signal);
        if (!current() || operation.controller?.signal.aborted) return;
        if (accept(next, scope)) setError(null);
      } catch (cause) {
        if (current() && !operation.controller?.signal.aborted && scopeRef.current?.key === scope.key) {
          markFresh(false);
          setError(safeError(cause));
        }
      } finally {
        if (current()) {
          operationRef.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    await operation.promise;
  }, [accept, markFresh]);

  const mutate = useCallback(async <T extends DirectoryReservation>(request: () => Promise<T>): Promise<T | null> => {
    if (!BOOKINGS_CONFIGURED || !mounted.current || appState.current !== 'active') return null;
    const observed = observationRef.current;
    if (!observed || !freshRef.current || observed.scopeKey !== scopeRef.current?.key || Date.now() - observed.at > MAX_OBSERVATION_AGE_MS) {
      markFresh(false);
      setError('Refresh app reservations for this map area before reserving or cancelling a listed plug.');
      return null;
    }
    const originalScope = scopeRef.current?.key;
    const previous = operationRef.current;
    if (previous?.kind === 'mutation') return null;
    if (previous) {
      previous.controller?.abort();
      await previous.promise;
      if (!mounted.current || operationRef.current || appState.current !== 'active' || scopeRef.current?.key !== originalScope) return null;
    }
    const operation: Operation = { id: ++sequence.current, kind: 'mutation', promise: Promise.resolve() };
    operationRef.current = operation;
    const current = () => mounted.current && operationRef.current?.id === operation.id;
    setBusy(true);
    setRefreshing(false);
    setError(null);
    markFresh(false);

    const mutation = (async (): Promise<T | null> => {
      let result: T | null = null;
      let mutationError: string | null = null;
      try {
        try {
          // One explicit tap sends one RPC, never an automatic write retry.
          result = await request();
          if (current()) setReservation(result.status === 'held' ? result : null);
        } catch (cause) {
          mutationError = safeError(cause);
        }
        if (!current()) return result;
        // Reconcile both successful and uncertain writes. Use the latest scope;
        // owned active holds are included even after panning elsewhere.
        const scope = scopeRef.current;
        if (scope) {
          try {
            const next = await fetchDirectoryHolds(scope.ids);
            if (current() && accept(next, scope)) setError(mutationError);
          } catch (cause) {
            if (current()) {
              markFresh(false);
              setError(mutationError ?? safeError(cause));
            }
          }
        } else if (current()) {
          markFresh(false);
          setError(mutationError ?? 'Search a smaller area and refresh to confirm your directory hold.');
        }
        return result;
      } finally {
        if (current()) {
          operationRef.current = null;
          setBusy(false);
          setLoading(false);
          setRefreshing(false);
          // A scope change during reconciliation requires another scoped read.
          if (observationRef.current?.scopeKey !== scopeRef.current?.key) void read(true);
        }
      }
    })();
    operation.promise = mutation;
    return mutation;
  }, [accept, markFresh, read]);

  const refresh = useCallback(() => read(false), [read]);
  const reserve = useCallback((stationId: number, slotKey: string, minutes: HoldMinutes) => {
    if (!scopeRef.current?.ids.includes(stationId) || !isDirectorySlotKey(slotKey)) {
      setError('Select a listed plug in the currently loaded directory area.');
      return Promise.resolve(null);
    }
    return mutate(() => reserveDirectoryPlug(stationId, slotKey, minutes));
  }, [mutate]);
  const reserveBooking = useCallback((stationId: number, slotKey: string, options: DirectoryBookingOptions) => {
    if (!scopeRef.current?.ids.includes(stationId) || !isDirectorySlotKey(slotKey)) {
      setError('Select a listed plug in the currently loaded directory area.');
      return Promise.resolve(null);
    }
    return mutate(() => reserveDirectoryBooking(stationId, slotKey, options));
  }, [mutate]);
  const extend = useCallback((id: string) => {
    const snapshot = observationRef.current?.snapshot;
    if (!snapshot?.myBookings?.some(booking => booking.id === id) &&
      !snapshot?.holds.some(hold => hold.isMine && hold.myReservationId === id)) {
      setError('Refresh app reservations to restore your booking before extending.');
      return Promise.resolve(null);
    }
    return mutate(() => extendDirectoryBooking(id));
  }, [mutate]);
  const cancel = useCallback(async (id: string) => {
    const snapshot = observationRef.current?.snapshot;
    if (!snapshot?.holds.some(hold => hold.isMine && hold.myReservationId === id) && !snapshot?.myBookings?.some(booking => booking.id === id)) {
      setError('Refresh app reservations to restore your active hold before cancelling.');
      return false;
    }
    const result = await mutate(() => cancelDirectoryHold(id));
    return result !== null && result.status !== 'held';
  }, [mutate]);

  useEffect(() => {
    mounted.current = true;
    void read(false);
    const poll = setInterval(() => {
      if (appState.current === 'active') void read(true);
    }, POLL_MS);
    const freshnessTimer = setInterval(() => {
      if (freshRef.current && observationRef.current && Date.now() - observationRef.current.at > MAX_OBSERVATION_AGE_MS) markFresh(false);
    }, 1_000);
    const subscription = AppState.addEventListener('change', next => {
      appState.current = next;
      if (next === 'active') void read(true);
      else {
        markFresh(false);
        if (operationRef.current?.kind === 'read') operationRef.current.controller?.abort();
      }
    });
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(freshnessTimer);
      subscription.remove();
      operationRef.current?.controller?.abort();
      operationRef.current = null;
    };
  }, [markFresh, read]);

  useEffect(() => {
    if (observationRef.current?.scopeKey !== scopeKey) markFresh(false);
    void read(false);
  }, [scopeKey, markFresh, read]);

  const fresh = freshState && scopeKey !== null && observation?.scopeKey === scopeKey &&
    Date.now() - observation.at <= MAX_OBSERVATION_AGE_MS && appState.current === 'active';
  return {
    configured: BOOKINGS_CONFIGURED, loading, refreshing, busy, error,
    snapshot: observation?.snapshot ?? null, reservation,
    queriedStationIds: observation?.ids ?? [], fresh, refresh, reserve, reserveBooking, extend, cancel,
  };
}

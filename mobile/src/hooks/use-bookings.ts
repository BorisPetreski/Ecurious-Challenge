import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  BOOKINGS_CONFIGURED,
  BookingApiError,
  cancelBooking,
  fetchBookingSnapshot,
  reserveBay,
  setBookingAuthActive,
  type BookingReservation,
  type BookingSnapshot,
  type HoldMinutes,
} from '@/lib/bookings-api';

export interface UseBookingsResult {
  configured: boolean;
  loading: boolean;
  refreshing: boolean;
  busy: boolean;
  error: string | null;
  snapshot: BookingSnapshot | null;
  reservation: BookingReservation | null;
  /** A recent successful server read, rather than inferred local availability. */
  fresh: boolean;
  refresh: () => Promise<void>;
  reserve: (bayId: string, minutes: HoldMinutes, connectorId: string) => Promise<BookingReservation | null>;
  cancel: (reservationId: string) => Promise<boolean>;
}

interface Operation {
  id: number;
  kind: 'read' | 'mutation';
  promise: Promise<unknown>;
  controller?: AbortController;
}

const POLL_INTERVAL_MS = 10_000;
// This is a UI connection freshness policy, not a claim of physical occupancy.
const OBSERVATION_MAX_AGE_MS = 25_000;

function safeError(error: unknown): string {
  return error instanceof BookingApiError
    ? error.message
    : 'Shared reservations are unavailable. Refresh before making another reservation.';
}

/** One provider owns the session, foreground polling, and serialized mutations. */
export function useBookingState(): UseBookingsResult {
  const [snapshot, setSnapshot] = useState<BookingSnapshot | null>(null);
  const [reservation, setReservation] = useState<BookingReservation | null>(null);
  const [loading, setLoading] = useState(BOOKINGS_CONFIGURED);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const snapshotRef = useRef<BookingSnapshot | null>(null);
  const freshRef = useRef(false);
  const observedAtRef = useRef(0);
  const mountedRef = useRef(false);
  const appStateRef = useRef<string>(AppState.currentState ?? 'active');
  const operationRef = useRef<Operation | null>(null);
  const sequenceRef = useRef(0);

  const markFresh = useCallback((value: boolean) => {
    freshRef.current = value;
    if (mountedRef.current) setFresh(value);
  }, []);

  const acceptSnapshot = useCallback((next: BookingSnapshot) => {
    snapshotRef.current = next;
    observedAtRef.current = Date.now();
    setSnapshot(next);
    markFresh(appStateRef.current === 'active');
    // A cancelled/expired hold must not survive in the convenience response.
    // Owned active reservations are always recoverable from the snapshot IDs.
    setReservation(previous => previous && next.bays.some(bay => bay.myReservationId === previous.id) ? previous : null);
  }, [markFresh]);

  const read = useCallback(async (silent: boolean): Promise<void> => {
    if (!BOOKINGS_CONFIGURED || !mountedRef.current || appStateRef.current !== 'active') return;
    if (operationRef.current) {
      await operationRef.current.promise;
      return;
    }
    const operation: Operation = {
      id: ++sequenceRef.current,
      kind: 'read',
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    operationRef.current = operation;
    const isCurrent = () => mountedRef.current && operationRef.current?.id === operation.id;
    setLoading(snapshotRef.current === null);
    setRefreshing(!silent && snapshotRef.current !== null);

    operation.promise = (async () => {
      try {
        const next = await fetchBookingSnapshot(operation.controller?.signal);
        if (!isCurrent() || operation.controller?.signal.aborted) return;
        acceptSnapshot(next);
        setError(null);
      } catch (cause) {
        if (isCurrent() && !operation.controller?.signal.aborted) {
          markFresh(false);
          setError(safeError(cause));
        }
      } finally {
        if (isCurrent()) {
          operationRef.current = null;
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    await operation.promise;
  }, [acceptSnapshot, markFresh]);

  const mutate = useCallback(async (
    request: () => Promise<BookingReservation>,
  ): Promise<BookingReservation | null> => {
    if (!mountedRef.current || !BOOKINGS_CONFIGURED || appStateRef.current !== 'active') return null;
    if (!freshRef.current || Date.now() - observedAtRef.current > OBSERVATION_MAX_AGE_MS) {
      markFresh(false);
      setError('Refresh shared reservations before reserving or cancelling a bay.');
      return null;
    }
    const previous = operationRef.current;
    if (previous?.kind === 'mutation') return null;
    if (previous) {
      previous.controller?.abort();
      await previous.promise;
      if (!mountedRef.current || operationRef.current || appStateRef.current !== 'active') return null;
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
    setError(null);
    markFresh(false);

    const mutation = (async (): Promise<BookingReservation | null> => {
      let result: BookingReservation | null = null;
      let mutationError: string | null = null;
      try {
        // Each deliberate tap sends at most one write. A network failure is not
        // retried: the server may already have committed the reservation.
        try {
          result = await request();
          if (isCurrent()) setReservation(result.status === 'held' ? result : null);
        } catch (cause) {
          mutationError = safeError(cause);
        }
        if (!isCurrent()) return result;
        // Read after success, rejection, or unknown outcome. Never fabricate an
        // available bay by letting the phone's countdown expire on its own.
        try {
          const next = await fetchBookingSnapshot();
          if (isCurrent()) {
            acceptSnapshot(next);
            setError(mutationError);
          }
        } catch (cause) {
          if (isCurrent()) {
            markFresh(false);
            setError(mutationError ?? safeError(cause));
          }
        }
        return result;
      } finally {
        if (isCurrent()) {
          operationRef.current = null;
          setBusy(false);
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    operation.promise = mutation;
    return mutation;
  }, [acceptSnapshot, markFresh]);

  const refresh = useCallback(() => read(false), [read]);
  const reserve = useCallback((bayId: string, minutes: HoldMinutes, connectorId: string) => {
    const bay = snapshotRef.current?.bays.find(candidate => candidate.id === bayId);
    if (!bay || bay.mode !== 'demo') {
      setError('Choose a registered demo bay. Live hardware reservations are not enabled.');
      return Promise.resolve(null);
    }
    if (!bay.connectors.some(connector => connector.id === connectorId && connector.enabled)) {
      setError('Choose an available connector belonging to this bay.');
      return Promise.resolve(null);
    }
    return mutate(() => reserveBay(bayId, minutes, connectorId));
  }, [mutate]);
  const cancel = useCallback(async (id: string) => {
    if (!snapshotRef.current?.bays.some(bay => bay.myReservationId === id && bay.isMine)) {
      setError('Refresh the map to restore your active reservation before cancelling.');
      return false;
    }
    const result = await mutate(() => cancelBooking(id));
    return result !== null && result.status !== 'held';
  }, [mutate]);

  useEffect(() => {
    mountedRef.current = true;
    setBookingAuthActive(appStateRef.current === 'active');
    void read(false);
    const poll = setInterval(() => {
      if (appStateRef.current === 'active') void read(true);
    }, POLL_INTERVAL_MS);
    const freshnessTimer = setInterval(() => {
      if (freshRef.current && Date.now() - observedAtRef.current > OBSERVATION_MAX_AGE_MS) markFresh(false);
    }, 1_000);
    const subscription = AppState.addEventListener('change', next => {
      appStateRef.current = next;
      setBookingAuthActive(next === 'active');
      if (next === 'active') {
        void read(true);
      } else {
        markFresh(false);
        if (operationRef.current?.kind === 'read') operationRef.current.controller?.abort();
      }
    });
    return () => {
      mountedRef.current = false;
      clearInterval(poll);
      clearInterval(freshnessTimer);
      subscription.remove();
      setBookingAuthActive(false);
      operationRef.current?.controller?.abort();
      operationRef.current = null;
    };
  }, [markFresh, read]);

  return { configured: BOOKINGS_CONFIGURED, loading, refreshing, busy, error, snapshot, reservation, fresh, refresh, reserve, cancel };
}

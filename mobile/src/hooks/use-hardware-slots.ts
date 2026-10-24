import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cancelHardwareSlot, createHardwareSlot, extendHardwareSlot, fetchHardwareSlots, type HardwareSlotInput, type HardwareSlotSnapshot } from '@/lib/hardware-slots-api';

interface Operation { write: boolean; promise: Promise<unknown>; controller?: AbortController }

export function useHardwareSlots(bayId?: string) {
  const [snapshot, setSnapshot] = useState<HardwareSlotSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), active = useRef((AppState.currentState ?? 'active') === 'active');
  const current = useRef<Operation | null>(null), observedAt = useRef(0), freshRef = useRef(false);
  const snapshotRef = useRef<HardwareSlotSnapshot | null>(null);
  const scope = useRef(bayId), observedScope = useRef<string | undefined>(undefined);
  scope.current = bayId;
  const markFresh = useCallback((value: boolean) => { freshRef.current = value; if (mounted.current) setFresh(value); }, []);
  const accept = useCallback((value: HardwareSlotSnapshot) => { snapshotRef.current = value; observedAt.current = Date.now(); observedScope.current = bayId; setSnapshot(value); markFresh(active.current && scope.current === bayId); }, [bayId, markFresh]);

  const refresh = useCallback(async (silent = false) => {
    if (!mounted.current || !active.current) return;
    if (current.current) { await current.current.promise; return; }
    const operation: Operation = { write: false, controller: new AbortController(), promise: Promise.resolve() };
    current.current = operation;
    setLoading(snapshotRef.current === null); setRefreshing(!silent && snapshotRef.current !== null);
    operation.promise = (async () => {
        try { const next = await fetchHardwareSlots(operation.controller?.signal, bayId); if (mounted.current && current.current === operation && !operation.controller?.signal.aborted) { accept(next); setError(null); } }
      catch (cause) { if (mounted.current && current.current === operation && !operation.controller?.signal.aborted) { markFresh(false); setError(cause instanceof Error ? cause.message : 'Scheduled bookings are unavailable.'); } }
      finally { if (mounted.current && current.current === operation) { current.current = null; setLoading(false); setRefreshing(false); } }
    })();
    await operation.promise;
  }, [accept, bayId, markFresh]);

  const mutate = useCallback(async (send: () => Promise<HardwareSlotSnapshot>) => {
    if (!mounted.current || !active.current || current.current?.write) return false;
    if (!freshRef.current || observedScope.current !== scope.current || Date.now() - observedAt.current > 15_000 || snapshotRef.current?.configured === false) { markFresh(false); setError('Refresh the schedule before booking or cancelling.'); return false; }
    const previous = current.current;
    if (previous) { previous.controller?.abort(); await previous.promise; if (!mounted.current || current.current || !active.current) return false; }
    const operation: Operation = { write: true, promise: Promise.resolve() };
    current.current = operation; setBusy(true); setError(null); markFresh(false);
    let accepted = false;
    operation.promise = (async () => {
      let failure: string | null = null;
      try {
        try { const next = await send(); accepted = true; if (mounted.current && current.current === operation && !bayId) accept(next); }
        catch (cause) { failure = cause instanceof Error ? cause.message : 'The booking outcome is unknown. Refresh before another request.'; }
        if (!mounted.current || current.current !== operation || !active.current) return;
        try { const next = await fetchHardwareSlots(undefined, bayId); if (mounted.current && current.current === operation) { accept(next); setError(failure); } }
        catch { if (mounted.current && current.current === operation) { markFresh(false); setError(failure ?? 'The request returned, but current schedule status could not be confirmed. Refresh before another action.'); } }
      } finally { if (mounted.current && current.current === operation) { current.current = null; setBusy(false); setLoading(false); setRefreshing(false); } }
    })();
    await operation.promise;
    return accepted;
  }, [accept, bayId, markFresh]);

  const reserve = useCallback((input: HardwareSlotInput) => mutate(() => createHardwareSlot(input)), [mutate]);
  const cancel = useCallback((slotId: string) => {
    if (!snapshotRef.current?.slots.some(slot => slot.id === slotId && slot.isMine && slot.canCancel)) { setError('Only your cancellable booking can be cancelled. Refresh the schedule.'); return Promise.resolve(false); }
    return mutate(() => cancelHardwareSlot(slotId));
  }, [mutate]);
  const extend = useCallback((slotId: string) => {
    if (!snapshotRef.current?.slots.some(slot => slot.id === slotId && slot.isMine && slot.bookingMode === 'now' && ['scheduled', 'active'].includes(slot.status))) { setError('Only your current Reserve now booking can be extended. Refresh its status.'); return Promise.resolve(false); }
    return mutate(() => extendHardwareSlot(slotId));
  }, [mutate]);

  useEffect(() => {
    mounted.current = true; markFresh(false); void refresh();
    const poll = setInterval(() => { if (active.current) void refresh(true); }, 5_000);
    const stale = setInterval(() => { if (freshRef.current && Date.now() - observedAt.current > 15_000) markFresh(false); }, 1_000);
    const subscription = AppState.addEventListener('change', state => { active.current = state === 'active'; if (active.current) void refresh(true); else { markFresh(false); if (!current.current?.write) current.current?.controller?.abort(); } });
    return () => { mounted.current = false; current.current?.controller?.abort(); current.current = null; clearInterval(poll); clearInterval(stale); subscription.remove(); };
  }, [markFresh, refresh]);
  return { snapshot, loading, refreshing, busy, fresh: fresh && observedScope.current === bayId, error, refresh: () => refresh(false), reserve, cancel, extend };
}

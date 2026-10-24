import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { HoldMinutes } from '@/lib/booking-contract';
import { fetchHardwareWorkflows, requestHardwareAction, reserveHardwareBay, type HardwareWorkflowSnapshot } from '@/lib/hardware-workflow-api';

const MAX_AGE_MS = 15_000;
interface Operation { kind: 'read' | 'write'; promise: Promise<unknown>; controller?: AbortController }

export function useHardwareWorkflows() {
  const [snapshot, setSnapshot] = useState<HardwareWorkflowSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const mounted = useRef(false);
  const active = useRef((AppState.currentState ?? 'active') === 'active');
  const observedAt = useRef(0);
  const snapshotRef = useRef<HardwareWorkflowSnapshot | null>(null);
  const freshRef = useRef(false);
  const operation = useRef<Operation | null>(null);

  const markFresh = useCallback((value: boolean) => {
    freshRef.current = value;
    if (mounted.current) setFresh(value);
  }, []);

  const accept = useCallback((next: HardwareWorkflowSnapshot) => {
    snapshotRef.current = next;
    observedAt.current = Date.now();
    setSnapshot(next);
    markFresh(active.current);
  }, [markFresh]);

  const refresh = useCallback(async (silent = false) => {
    if (!mounted.current || !active.current) return;
    if (operation.current) { await operation.current.promise; return; }
    const current: Operation = { kind: 'read', controller: new AbortController(), promise: Promise.resolve() };
    operation.current = current;
    setLoading(snapshotRef.current === null);
    setRefreshing(!silent && snapshotRef.current !== null);
    current.promise = (async () => {
      try {
        const next = await fetchHardwareWorkflows(current.controller?.signal);
        if (mounted.current && operation.current === current && !current.controller?.signal.aborted) { accept(next); setError(null); }
      } catch (cause) {
        if (mounted.current && operation.current === current && !current.controller?.signal.aborted) {
          markFresh(false);
          setError(cause instanceof Error ? cause.message : 'The designated bay could not be refreshed.');
        }
      } finally {
        if (mounted.current && operation.current === current) { operation.current = null; setLoading(false); setRefreshing(false); }
      }
    })();
    await current.promise;
  }, [accept, markFresh]);

  const mutate = useCallback(async (bayId: string, action: 'reserve' | 'entry' | 'release', send: () => Promise<HardwareWorkflowSnapshot>) => {
    if (!mounted.current || !active.current || operation.current?.kind === 'write') return;
    if (!freshRef.current || Date.now() - observedAt.current > MAX_AGE_MS) { markFresh(false); setError('Refresh the designated bay before another action.'); return; }
    const bay = snapshotRef.current?.workflows.find(item => item.bay.id === bayId);
    const allowed = action === 'reserve' ? bay?.capabilities.canReserve : action === 'entry' ? bay?.capabilities.canRequestEntry : bay?.capabilities.canRequestRelease;
    if (!snapshotRef.current?.commandsEnabled || !allowed || (action !== 'reserve' && (!bay?.reservation.isMine || !bay.reservation.id))) { setError('This action is not currently allowed for your reservation. Refresh the designated bay.'); return; }
    const prior = operation.current;
    if (prior) { prior.controller?.abort(); await prior.promise; if (!mounted.current || operation.current || !active.current) return; }
    const current: Operation = { kind: 'write', promise: Promise.resolve() };
    operation.current = current;
    setBusy(true);
    setRefreshing(false);
    setError(null);
    markFresh(false);
    current.promise = (async () => {
      let failure: string | null = null;
      try {
        try {
          const next = await send();
          if (mounted.current && operation.current === current) accept(next);
        } catch (cause) {
          failure = cause instanceof Error ? cause.message : 'The command outcome is unknown. Refresh before another action.';
        }
        // Read-only reconciliation after success, rejection, or an unknown write.
        if (!mounted.current || operation.current !== current || !active.current) return;
        try {
          const next = await fetchHardwareWorkflows();
          if (mounted.current && operation.current === current) { accept(next); setError(failure); }
        } catch {
          if (mounted.current && operation.current === current) { markFresh(false); setError(failure ?? 'The command response arrived, but its current state could not be refreshed. Check the bay before another action.'); }
        }
      } finally {
        if (mounted.current && operation.current === current) { operation.current = null; setBusy(false); setLoading(false); setRefreshing(false); }
      }
    })();
    await current.promise;
  }, [accept, markFresh]);

  const reserve = useCallback((bayId: string, connectorId: string, minutes: HoldMinutes) => mutate(bayId, 'reserve', () => reserveHardwareBay(bayId, connectorId, minutes)), [mutate]);
  const act = useCallback((action: 'entry' | 'release', bayId: string, reservationId: string) => mutate(bayId, action, () => requestHardwareAction(action, bayId, reservationId)), [mutate]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = setInterval(() => { if (active.current) void refresh(true); }, 5_000);
    const freshness = setInterval(() => { if (freshRef.current && Date.now() - observedAt.current > MAX_AGE_MS) markFresh(false); }, 1_000);
    const subscription = AppState.addEventListener('change', state => {
      active.current = state === 'active';
      if (active.current) void refresh(true);
      else { markFresh(false); if (operation.current?.kind === 'read') operation.current.controller?.abort(); }
    });
    return () => { mounted.current = false; operation.current?.controller?.abort(); operation.current = null; clearInterval(poll); clearInterval(freshness); subscription.remove(); };
  }, [markFresh, refresh]);

  return { snapshot, loading, refreshing, busy, error, fresh, refresh: () => refresh(false), reserve, act };
}

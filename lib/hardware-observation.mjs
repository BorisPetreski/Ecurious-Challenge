/** Retained source facts keep their original timestamp; display aging is not a new sensor event. */
export function hardwareObservation(lock) {
  return {
    p_observed_at: lock?.lastSeenAt ?? null,
    p_barrier: ['raised', 'lowered'].includes(lock?.status) ? lock.status : lock?.barrier ?? 'unknown',
    p_occupancy: ['vacant', 'occupied'].includes(lock?.lastReportedPresence) ? lock.lastReportedPresence : lock?.occupancy ?? 'unknown',
    p_faulted: !lock || lock.faultsKnown !== true || !Array.isArray(lock.activeErrors) || lock.activeErrors.length > 0 || lock.waterIngress !== false,
    p_access_mode: lock?.whitelist?.mode ?? 'unknown',
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, SectionHeading, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import { fetchHardwareSnapshot, type HardwareLock, type HardwareSnapshot } from '@/lib/hardware-api';

function observationTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not reported';
}

function hardwareErrorLabel(value: string) {
  if (value === 'MOTOR_LOWERING_STALL') return 'Motor stalled while lowering';
  return value.replaceAll('_', ' ').toLowerCase();
}

function LockSnapshot({ lock, snapshot, now, connectionFailed }: {
  lock: HardwareLock;
  snapshot: HardwareSnapshot;
  now: number;
  connectionFailed: boolean;
}) {
  // A manual refresh must not make old sensor telemetry appear current.
  const lastSeen = lock.lastSeenAt ? Date.parse(lock.lastSeenAt) : NaN;
  const snapshotAge = now - Date.parse(snapshot.fetchedAt);
  const telemetryAge = now - lastSeen;
  const fresh = !connectionFailed && lock.status !== 'offline' && lock.telemetryFresh &&
    Number.isFinite(telemetryAge) && telemetryAge >= -5_000 && telemetryAge <= snapshot.freshnessLimitMs &&
    snapshotAge >= -5_000 && snapshotAge <= snapshot.freshnessLimitMs;
  const occupancy = fresh ? lock.occupancy : 'unknown';
  const barrier = fresh ? lock.barrier : 'unknown';
  const whitelist = lock.whitelist;

  return (
    <View style={styles.lock}>
      <View style={styles.lockHeading}>
        <View style={ui.flex}><Text style={styles.lockName}>{lock.name}</Text><Text style={ui.small}>{lock.id}{lock.hasCamera ? ' · Camera equipped' : ''}</Text></View>
        <View style={[styles.badge, !fresh && styles.staleBadge]}><Text style={[styles.badgeText, !fresh && styles.staleText]}>{lock.status === 'offline' ? 'OFFLINE' : fresh ? 'FRESH SNAPSHOT' : 'STALE / UNKNOWN'}</Text></View>
      </View>
      <Text style={ui.small}>Service status: {lock.status}. Last device report: {observationTime(lock.lastSeenAt)}.</Text>
      <View style={styles.readings}>
        <View style={styles.reading}><Text style={ui.small}>Occupancy</Text><Text style={styles.readingValue}>{occupancy === 'vacant' ? 'Vacant' : occupancy === 'occupied' ? 'Occupied' : 'Unknown'}</Text></View>
        <View style={styles.reading}><Text style={ui.small}>Barrier position</Text><Text style={styles.readingValue}>{barrier === 'raised' ? 'Raised' : barrier === 'lowered' ? 'Lowered' : 'Unknown'}</Text></View>
      </View>
      <Text style={ui.small}>Last reported occupancy: {lock.lastReportedPresence}. A previous vacant report does not confirm the bay is empty now.</Text>
      {lock.activeErrors.length > 0 ? <View style={styles.alert} accessibilityLiveRegion="polite"><Text style={styles.alertTitle}>Device needs attention</Text>{lock.activeErrors.map((error, index) => <Text key={`${error}-${index}`} style={styles.alertCopy}>{hardwareErrorLabel(error)} ({error})</Text>)}<Text style={styles.alertCopy}>Ask the Ecurious team to check the device before the live reservation cycle.</Text></View> : null}
      {lock.waterIngress === true ? <View style={styles.alert}><Text style={styles.alertTitle}>Water ingress reported</Text><Text style={styles.alertCopy}>Have the Ecurious team inspect the device.</Text></View> : null}
      <View style={styles.policy}>
        <Text style={ui.label}>Camera access policy</Text>
        <Text style={ui.body}>{whitelist.mode === 'any-plate'
          ? 'Any plate is allowed. The wildcard policy does not restrict entry to the driver who booked.'
          : whitelist.mode === 'specific-plates'
            ? `${whitelist.count ?? 'Some'} plate entries configured. Plate values are hidden.`
            : whitelist.mode === 'disabled'
              ? 'Automatic plate-based unlocking is disabled.'
              : 'The access policy is unknown.'}</Text>
        {whitelist.mode === 'any-plate' ? <Text style={styles.policyNote}>Review this policy with the team before demonstrating exclusive reservations.</Text> : null}
      </View>
      <Text style={ui.small}>{lock.plateObservation?.detected ? `Cached plate observation: ${observationTime(lock.plateObservation.timestamp)}. Plate value hidden.` : 'No cached plate observation was returned.'} Camera images are omitted.</Text>
    </View>
  );
}

export function HardwareStatus() {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const next = await fetchHardwareSnapshot(controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(next);
      setError(null);
      setNow(Date.now());
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Hardware status is unavailable.');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // This updates freshness labels locally; it does not poll the hardware.
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  return (
    <View>
      <SectionHeading eyebrow="ECURIOUS · READ ONLY" title="The real test hardware" />
      <View style={ui.card}>
        <Text style={ui.body}>Actual device telemetry from Ecurious, separate from the simulator timeline. This panel sends no barrier or camera configuration commands.</Text>
        {error ? <View style={styles.alert} accessibilityLiveRegion="polite"><Text style={styles.alertTitle}>Hardware connection needs attention</Text><Text style={styles.alertCopy}>{error}</Text>{snapshot ? <Text style={styles.alertCopy}>The snapshot below is retained for reference. Current physical state is unknown.</Text> : null}</View> : null}
        {snapshot && !snapshot.configured ? <View style={styles.policy}><Text style={ui.label}>Backend key required</Text><Text style={ui.body}>Set ECURIOUS_API_KEY in the project’s root .env and restart the backend. Keep the key on the laptop.</Text></View> : null}
        {snapshot?.configured ? <>
          <Text style={ui.label}>{snapshot.team ? `Team: ${snapshot.team}` : 'Assigned hardware'}</Text>
          <Text style={ui.small}>Service snapshot: {observationTime(snapshot.fetchedAt)}. Freshness window: {Math.round(snapshot.freshnessLimitMs / 1_000)} seconds, an app policy rather than a physical safety guarantee.</Text>
          {snapshot.locks.length === 0 ? <Text style={ui.body}>No assigned locks were returned for this key.</Text> : snapshot.locks.map(lock => <LockSnapshot key={lock.id} lock={lock} snapshot={snapshot} now={now} connectionFailed={!!error} />)}
        </> : null}
        {!snapshot && loading ? <Text style={ui.body}>Reading the assigned hardware…</Text> : null}
        <ActionButton label={loading ? 'Reading hardware…' : 'Refresh real hardware'} onPress={() => void refresh()} loading={loading} variant="secondary" />
        <Text style={ui.small}>A fresh service response can still contain stale device telemetry. Unknown or offline state never confirms an empty bay.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { gap: 14, borderTopWidth: 1, borderColor: palette.line, paddingTop: 18 },
  lockHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  lockName: { fontSize: 19, fontWeight: '700', color: palette.ink, marginBottom: 4 },
  badge: { backgroundColor: palette.soft, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10 },
  staleBadge: { backgroundColor: palette.warning },
  badgeText: { fontSize: 10, fontWeight: '800', color: palette.ink, letterSpacing: 0.4 },
  staleText: { color: palette.warningInk },
  readings: { flexDirection: 'row', gap: 12 },
  reading: { flex: 1, backgroundColor: palette.soft, borderRadius: 13, padding: 13, gap: 6 },
  readingValue: { fontSize: 20, fontWeight: '700', color: palette.ink },
  alert: { backgroundColor: palette.error, borderRadius: 13, padding: 14, gap: 8 },
  alertTitle: { fontSize: 15, fontWeight: '700', color: palette.errorInk },
  alertCopy: { fontSize: 14, lineHeight: 21, color: palette.errorInk },
  policy: { backgroundColor: palette.warning, borderRadius: 13, padding: 14, gap: 8 },
  policyNote: { fontSize: 14, lineHeight: 21, color: palette.warningInk },
});

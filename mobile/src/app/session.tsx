import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { HardwareAlternatives, HardwareBookingDetails } from '@/components/hardware-booking-details';
import { useBayReady } from '@/components/reservation-provider';
import { palette } from '@/constants/bayready';
import { useHardwareSlots } from '@/hooks/use-hardware-slots';
import { useHardwareWorkflows } from '@/hooks/use-hardware-workflows';
import { formatHardwareInstant } from '@/lib/hardware-time';

function elapsed(start: string | null, end: string | null, now: number) {
  if (!start) return 'Awaiting matched arrival';
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1_000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function SessionScreen() {
  const parameters = useLocalSearchParams<{ slotId?: string; bayId?: string; simulator?: string }>();
  const schedule = useHardwareSlots();
  const hardware = useHardwareWorkflows();
  const simulator = useBayReady();
  const [now, setNow] = useState(Date.now);
  const anchor = useRef({ serverAt: Date.now(), clientAt: Date.now() });
  useEffect(() => {
    const serverNow = schedule.snapshot?.serverNow ?? hardware.snapshot?.serverNow;
    if (serverNow) { anchor.current = { serverAt: Date.parse(serverNow), clientAt: Date.now() }; setNow(anchor.current.serverAt); }
  }, [schedule.snapshot, hardware.snapshot]);
  useEffect(() => { const timer = setInterval(() => setNow(anchor.current.serverAt + Date.now() - anchor.current.clientAt), 1_000); return () => clearInterval(timer); }, []);

  const ownSlots = schedule.snapshot?.slots.filter(item => item.isMine && (!parameters.bayId || item.bayId === parameters.bayId)) ?? [];
  const slot = parameters.slotId ? ownSlots.find(item => item.id === parameters.slotId) : ownSlots.find(item => item.arrivedAt && !item.departedAt && !['cancelled', 'completed', 'expired'].includes(item.status)) ?? ownSlots.find(item => item.status === 'active') ?? ownSlots.find(item => item.status === 'scheduled') ?? ownSlots[0];
  const workflow = hardware.snapshot?.workflows.find(item => item.bay.id === (slot?.bayId ?? parameters.bayId));
  const observation = hardware.snapshot?.observations.find(item => item.id === workflow?.bay.lockId);
  const connector = workflow?.bay.connectors.find(item => item.id === slot?.connectorId);
  const observationFresh = hardware.fresh && observation?.telemetryFresh && observation.lastSeenAt && now - Date.parse(observation.lastSeenAt) >= 0 && now - Date.parse(observation.lastSeenAt) <= 5_000;
  const showSimulator = !parameters.slotId && !parameters.bayId && (!slot || parameters.simulator === '1') && simulator.state?.reservation?.status === 'charging';

  return <SafeAreaView style={ui.safe}>
    <View style={styles.header}><Link href={showSimulator ? '/reserve' : '/hardware'} asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.backText}>{showSimulator ? '‹ Simulator' : '‹ Hardware bookings'}</Text></Pressable></Link><Text style={styles.mode}>{showSimulator ? 'SIMULATED' : 'SESSION'}</Text></View>
    <ScrollView contentContainerStyle={ui.scroll}>
      <View style={ui.content}>
        <View><Text style={ui.eyebrow}>YOUR TIME AT THE BAY</Text><Text style={styles.title}>Session details.</Text><Text style={ui.body}>Arrival, booking time and available device information. Charging telemetry is not connected.</Text></View>
        {schedule.loading && !showSimulator ? <ActivityIndicator color={palette.ink} /> : null}
        {schedule.error && !showSimulator ? <View style={[ui.notice, ui.errorNotice]}><Text style={ui.body}>{schedule.error}</Text></View> : null}
        {showSimulator ? <View style={ui.card}>
          <Text style={ui.eyebrow}>SIMULATED SESSION</Text><Text style={ui.sectionTitle}>{simulator.state?.bay.label}</Text>
          <Text style={ui.body}>Local charging rehearsal. No electricity is delivered and no shared database booking is changed.</Text>
          <View style={styles.elapsed}><Text style={ui.small}>Elapsed from simulated charge start</Text><Text style={styles.clock}>{elapsed(simulator.state?.reservation?.startedAt ?? null, null, Math.max(now, Date.parse(simulator.state?.now ?? new Date(now).toISOString())))}</Text></View>
          <Text style={ui.body}>Vehicle {simulator.state?.reservation?.maskedPlate}</Text>
          <View style={styles.row}><Fact label="Bay" value={simulator.state?.bay.status ?? 'Unknown'} /><Fact label="Barrier" value={simulator.state?.bay.barrier ?? 'Unknown'} /></View>
          <View style={styles.row}><Fact label="Live power" value="Not simulated" /><Fact label="Energy delivered" value="No measurement" /></View>
          {simulator.error ? <Text style={styles.error}>{simulator.error}</Text> : null}
          <ActionButton label="Simulate vehicle departure" onPress={() => void simulator.act('depart')} disabled={simulator.busy || !!simulator.error || !simulator.state?.capabilities.canDepart} variant="secondary" />
          <Link href="/reserve" asChild><Pressable accessibilityRole="button" style={ui.button}><Text style={ui.buttonText}>Back to simulator controls</Text></Pressable></Link>
        </View> : slot ? <>
          <View style={ui.card}>
            <Text style={ui.eyebrow}>DESIGNATED HARDWARE BOOKING</Text>
            <Text style={ui.sectionTitle}>{workflow?.bay.label ?? 'Your booked bay'}</Text>
            <Text style={ui.label}>{schedule.fresh ? slot.status.replaceAll('_', ' ') : 'Booking state unknown · last received details'}</Text>
            <Text style={ui.body}>Vehicle {slot.maskedPlate ?? 'plate hidden'}</Text>
            <Text style={ui.body}>{formatHardwareInstant(slot.startsAt)} → {formatHardwareInstant(slot.endsAt)} · Berlin</Text>
            {slot.status === 'scheduled' ? <Text style={ui.small}>Awaiting physical activation. Advance protection is requested ten minutes before your booked arrival, subject to safe device observations.</Text> : null}
            <View style={styles.elapsed}><Text style={ui.small}>Time since matched arrival</Text><Text style={styles.clock}>{elapsed(slot.arrivedAt, slot.departedAt, now)}</Text></View>
            <Text style={ui.small}>Matched arrival: {slot.arrivedAt ? formatHardwareInstant(slot.arrivedAt) : 'Not confirmed'}</Text>
            <Text style={ui.small}>Departure: {slot.departedAt ? formatHardwareInstant(slot.departedAt) : 'Not confirmed'}</Text>
            <Text style={ui.small}>Activated: {slot.activatedAt ? formatHardwareInstant(slot.activatedAt) : 'Not activated'}</Text>
            <HardwareBookingDetails slot={slot} policy={schedule.snapshot?.policy} fresh={schedule.fresh} busy={schedule.busy} extensionAllowed={hardware.fresh && !!workflow && !['blocked', 'uncertain'].includes(workflow.phase) && now < Date.parse(slot.endsAt)} extend={schedule.extend} />
            <HardwareAlternatives alternatives={schedule.snapshot?.alternatives} />
            {slot.canCancel && slot.id ? <ActionButton label="Request booking cancellation / release" onPress={() => void schedule.cancel(slot.id!)} disabled={!schedule.fresh || schedule.busy} variant="secondary" /> : null}
          </View>
          <View style={ui.card}>
            <Text style={ui.sectionTitle}>Current bay observations</Text>
            <View style={styles.row}><Fact label="Barrier" value={observationFresh ? observation?.barrier ?? 'unknown' : 'unknown'} /><Fact label="Occupancy" value={observationFresh ? observation?.occupancy ?? 'unknown' : 'unknown'} /></View>
            <Text style={ui.small}>Provider timestamp: {observation?.lastSeenAt ? formatHardwareInstant(observation.lastSeenAt) : 'Unavailable'}. These current readings are separate from a future booking.</Text>
            {!observationFresh && observation ? <Text style={ui.small}>Last reported: barrier {observation.barrier}, occupancy {observation.lastReportedPresence}. Current state is unknown because the report is older than 5 seconds or unavailable.</Text> : null}
            <Text style={ui.body}>Workflow: {hardware.fresh && workflow ? workflow.phase.replaceAll('_', ' ') : 'Unknown · refresh required'}</Text>
            {hardware.error ? <Text style={styles.error}>{hardware.error}</Text> : null}
          </View>
          <View style={ui.card}>
            <Text style={ui.sectionTitle}>Charging information</Text>
            <Fact label="Connector" value={connector ? `${connector.label} · ${connector.type === 'Typ2' ? 'Type 2' : connector.type}` : 'Not available'} />
            <Fact label="Connector rating" value={connector ? `${connector.powerKw} kW rated` : 'Not available'} />
            <View style={styles.row}><Fact label="Live charging power" value="Unavailable" /><Fact label="Energy delivered" value="Unavailable" /></View>
            <Text style={ui.small}>A plate match, open barrier or occupied bay does not prove charging. The connector rating is a catalog value, not a live power measurement.</Text>
          </View>
        </> : !schedule.loading ? <View style={ui.card}><Text style={ui.sectionTitle}>No session found</Text><Text style={ui.body}>Restore the current booking session and choose one of your hardware time slots, or start a simulated charge for a local rehearsal.</Text><Link href="/hardware" asChild><Pressable accessibilityRole="button" style={ui.button}><Text style={ui.buttonText}>Open hardware bookings</Text></Pressable></Link><Link href="/reserve" asChild><Pressable accessibilityRole="button" style={[ui.button, ui.secondaryButton]}><Text style={ui.buttonText}>Open simulator</Text></Pressable></Link></View> : null}
        <ActionButton label={showSimulator ? simulator.refreshing ? 'Refreshing…' : 'Refresh simulated session' : schedule.refreshing || hardware.refreshing ? 'Refreshing…' : 'Refresh session information'} onPress={() => { if (showSimulator) void simulator.refresh(); else { void schedule.refresh(); void hardware.refresh(); } }} disabled={showSimulator ? simulator.busy || simulator.refreshing : schedule.busy || hardware.busy || schedule.refreshing || hardware.refreshing} variant="secondary" />
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function Fact({ label, value }: { label: string; value: string }) { return <View style={styles.fact}><Text style={ui.small}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>; }
const styles = StyleSheet.create({
  header: { minHeight: 62, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  back: { minHeight: 44, justifyContent: 'center' }, backText: { color: palette.ink, fontSize: 14, fontWeight: '700' }, mode: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  title: { color: palette.ink, fontSize: 34, fontWeight: '800', letterSpacing: -1, marginBottom: 11 },
  elapsed: { padding: 15, backgroundColor: palette.soft, borderRadius: 13, gap: 9 }, clock: { color: palette.ink, fontSize: 31, fontWeight: '800', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 10 }, fact: { flex: 1, backgroundColor: palette.soft, borderRadius: 12, padding: 12, gap: 6 }, factValue: { color: palette.ink, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  error: { color: palette.errorInk, fontSize: 14, lineHeight: 21 },
});

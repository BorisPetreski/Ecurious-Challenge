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
  const barrierOnly = connector?.type === 'BARRIER_TEST';
  const observationFresh = hardware.fresh && observation?.telemetryFresh && observation.lastSeenAt && now - Date.parse(observation.lastSeenAt) >= 0 && now - Date.parse(observation.lastSeenAt) <= 5_000;
  const showSimulator = !parameters.slotId && !parameters.bayId && (!slot || parameters.simulator === '1') && simulator.state?.reservation?.status === 'charging';

  const [deviceDetailsOpen, setDeviceDetailsOpen] = useState(false);
  const protectionAt = slot?.protectionStartsAt ?? slot?.startsAt ?? null;
  const deadline = slot?.protectionDeadlineAt ?? slot?.endsAt ?? null;
  const ended = !!slot && ['cancelled', 'completed', 'expired'].includes(slot.status);
  const upcoming = !!slot && slot.activatedAt === null && !!protectionAt && Date.parse(protectionAt) > now;
  const countdown = (value: string | null) => {
    if (!value) return '—';
    const seconds = Math.max(0, Math.ceil((Date.parse(value) - now) / 1_000));
    return seconds > 0 ? Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : 'Checking status';
  };
  const status = !schedule.fresh ? 'Refresh status' : slot?.status === 'cancelled' ? 'Cancelled' : slot?.status === 'expired' ? 'Hold ended' : slot?.status === 'completed' || slot?.departedAt ? 'Completed' : slot?.status === 'cancel_requested' ? 'Releasing' : slot?.status === 'blocked' ? 'Bay needs attention' : upcoming ? 'Upcoming' : slot?.arrivedAt ? 'Vehicle arrived' : slot?.entryAuthorizedAt ? 'Entry authorized' : workflow?.phase === 'protected' ? 'Protection confirmed' : 'Preparing protection';

  return <SafeAreaView style={ui.safe}>
    <View style={styles.header}><Link href={showSimulator ? '/reserve' : '/hardware'} asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.backText}>{showSimulator ? '‹ Simulator' : '‹ Bookings'}</Text></Pressable></Link><Text style={styles.mode}>{showSimulator ? 'SIMULATED' : 'HARDWARE DEMO'}</Text></View>
    <ScrollView contentContainerStyle={ui.scroll}>
      <View style={ui.content}>
        <Text style={styles.title}>Your session.</Text>
        {schedule.loading && !showSimulator ? <ActivityIndicator color={palette.ink} /> : null}
        {schedule.error && !showSimulator ? <View style={[ui.notice, ui.errorNotice]}><Text style={ui.body}>{schedule.error}</Text></View> : null}
        {showSimulator ? <View style={ui.card}>
          <Text style={ui.eyebrow}>SIMULATED</Text><Text style={ui.sectionTitle}>{simulator.state?.bay.label}</Text>
          <View style={styles.elapsed}><Text style={ui.small}>Simulated charging duration</Text><Text style={styles.clock}>{elapsed(simulator.state?.reservation?.startedAt ?? null, null, Math.max(now, Date.parse(simulator.state?.now ?? new Date(now).toISOString())))}</Text></View>
          <Text style={ui.body}>Vehicle {simulator.state?.reservation?.maskedPlate}</Text>
          <Text style={ui.small}>No electricity delivered · no real payment</Text>
          {simulator.error ? <Text style={styles.error}>{simulator.error}</Text> : null}
          <ActionButton label="Simulate departure" onPress={() => void simulator.act('depart')} disabled={simulator.busy || !!simulator.error || !simulator.state?.capabilities.canDepart} />
        </View> : slot ? <>
          <View style={ui.card}>
            <Text style={styles.status}>{status}</Text>
            <Text style={ui.sectionTitle}>{workflow?.bay.label ?? 'Your booked bay'}</Text>
            <Text style={ui.small}>{barrierOnly ? 'Barrier-only test · no charging' : connector ? connector.label + ' · ' + (connector.type === 'Typ2' ? 'Type 2' : connector.type) + ' · rated ' + connector.powerKw + ' kW' : 'Test target information unavailable'}</Text>
            <View style={styles.elapsed}><Text style={ui.small}>{slot.arrivedAt ? slot.departedAt ? 'Session duration' : 'Time since confirmed arrival' : ended ? 'Reservation status' : slot.entryAuthorizedAt ? 'Entry authorized' : upcoming ? 'Protection starts in' : 'Hold time remaining'}</Text><Text style={styles.clock}>{slot.arrivedAt ? elapsed(slot.arrivedAt, slot.departedAt, now) : ended ? status : slot.entryAuthorizedAt ? 'Awaiting arrival' : countdown(upcoming ? protectionAt : deadline)}</Text></View>
            <Text style={ui.body}>Arrival {formatHardwareInstant(slot.startsAt)}</Text>
            <Text style={ui.small}>Vehicle {slot.maskedPlate ?? 'hidden'}</Text>
            <HardwareBookingDetails slot={slot} policy={schedule.snapshot?.policy} fresh={schedule.fresh} busy={schedule.busy} extensionAllowed={hardware.fresh && workflow?.phase === 'protected' && !!deadline && now < Date.parse(deadline)} extend={schedule.extend} />
            {slot.canCancel && slot.id ? <Pressable accessibilityRole="button" onPress={() => void schedule.cancel(slot.id!)} disabled={!schedule.fresh || schedule.busy} style={styles.cancel}><Text style={styles.backText}>Cancel reservation</Text></Pressable> : null}
          </View>
          <HardwareAlternatives alternatives={schedule.snapshot?.alternatives} />
          <Text style={ui.small}>{barrierOnly ? 'Barrier and vehicle-presence test · no electricity delivered · mock payment' : 'Mock payment · live power and energy data unavailable'}</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: deviceDetailsOpen }} onPress={() => setDeviceDetailsOpen(open => !open)} style={styles.cancel}><Text style={styles.backText}>{deviceDetailsOpen ? 'Hide device information −' : 'Device information +'}</Text></Pressable>
          {deviceDetailsOpen ? <View style={ui.card}>
            <View style={styles.row}><Fact label="Barrier" value={observationFresh ? observation?.barrier ?? 'unknown' : 'unknown'} /><Fact label="Occupancy" value={observationFresh ? observation?.occupancy ?? 'unknown' : 'unknown'} /></View>
            <Text style={ui.small}>Last report {observation?.lastSeenAt ? formatHardwareInstant(observation.lastSeenAt) : 'unavailable'}</Text>
            {!observationFresh && observation ? <Text style={ui.small}>Last reported {observation.barrier} · {observation.lastReportedPresence}</Text> : null}
            <Text style={ui.small}>Arrival {slot.arrivedAt ? formatHardwareInstant(slot.arrivedAt) : 'not confirmed'}</Text>
            <Text style={ui.small}>Departure {slot.departedAt ? formatHardwareInstant(slot.departedAt) : 'not confirmed'}</Text>
            {hardware.error ? <Text style={styles.error}>{hardware.error}</Text> : null}
          </View> : null}
        </> : !schedule.loading ? <View style={ui.card}><Text style={ui.sectionTitle}>No active session</Text><Text style={ui.body}>Choose a booking or try the simulator.</Text><Link href="/hardware" asChild><Pressable accessibilityRole="button" style={ui.button}><Text style={ui.buttonText}>Hardware bookings</Text></Pressable></Link><Link href="/reserve" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten([ui.button, ui.secondaryButton])}><Text style={ui.buttonText}>Open simulator</Text></Pressable></Link></View> : null}
        <ActionButton label={showSimulator ? 'Refresh simulation' : 'Refresh status'} onPress={() => { if (showSimulator) void simulator.refresh(); else { void schedule.refresh(); void hardware.refresh(); } }} disabled={showSimulator ? simulator.busy || simulator.refreshing : schedule.busy || hardware.busy || schedule.refreshing || hardware.refreshing} variant="secondary" />
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function Fact({ label, value }: { label: string; value: string }) { return <View style={styles.fact}><Text style={ui.small}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>; }
const styles = StyleSheet.create({
  status: { color: palette.ink, backgroundColor: palette.soft, padding: 8, borderRadius: 8, fontSize: 12, fontWeight: '700', alignSelf: 'flex-start' }, cancel: { minHeight: 42, justifyContent: 'center', alignItems: 'center' },
  header: { minHeight: 62, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  back: { minHeight: 44, justifyContent: 'center' }, backText: { color: palette.ink, fontSize: 14, fontWeight: '700' }, mode: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  title: { color: palette.ink, fontSize: 34, fontWeight: '800', letterSpacing: -1, marginBottom: 11 },
  elapsed: { padding: 15, backgroundColor: palette.soft, borderRadius: 13, gap: 9 }, clock: { color: palette.ink, fontSize: 31, fontWeight: '800', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 10 }, fact: { flex: 1, backgroundColor: palette.soft, borderRadius: 12, padding: 12, gap: 6 }, factValue: { color: palette.ink, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  error: { color: palette.errorInk, fontSize: 14, lineHeight: 21 },
});

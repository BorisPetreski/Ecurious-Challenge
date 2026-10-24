import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { useProfile } from '@/components/profile-provider';
import { palette } from '@/constants/bayready';
import { useHardwareWorkflows } from '@/hooks/use-hardware-workflows';
import { useHardwareSlots } from '@/hooks/use-hardware-slots';
import { HardwareSlotForm } from '@/components/hardware-slot-form';
import { HardwareAlternatives, HardwareBookingDetails } from '@/components/hardware-booking-details';
import { formatHardwareInstant } from '@/lib/hardware-time';
import type { DriverProfile } from '@/lib/driver-profile';
import type { HardwareLock } from '@/lib/hardware-api';
import type { HardwarePhase, HardwareWorkflow } from '@/lib/hardware-workflow-api';

const phaseLabels: Record<HardwarePhase, string> = {
  idle: 'No active hold',
  protect_pending: 'Preparing protection',
  protecting: 'Confirming protection',
  protected: 'Protection confirmed',
  entry_pending: 'Opening for your vehicle',
  entering: 'Confirming entry',
  entry_open: 'Entry open',
  release_pending: 'Releasing reservation',
  releasing: 'Confirming release',
  blocked: 'Bay blocked · recovery required',
  uncertain: 'Hardware outcome unknown',
};

const time = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not reported';
const connectorLabel = (value: string) => value === 'Typ2' ? 'Type 2' : value;
const reasonCopy: Record<string, string> = {
  HARDWARE_SETUP_REQUIRED: 'The backend needs the shared workflow setup, a designated test lock and explicit command activation.',
  HARDWARE_OBSERVATION_UNAVAILABLE: 'Current hardware observations could not be read. Movement is not confirmed.',
  TELEMETRY_UNKNOWN: 'Current occupancy and barrier readings are unavailable or too old.',
  BAY_OCCUPIED: 'A vehicle is reported in the bay. Ask the operator to inspect it before any movement.',
  HARDWARE_FAULT: 'The device reports a fault. Ask the Ecurious team to inspect it.',
  ACCESS_POLICY_UNSAFE: 'Automatic camera access is still enabled. The operator must review the access policy before exclusive protection.',
  COMMAND_RESULT_UNKNOWN: 'The command may have been sent. Its outcome must be observed before another action.',
  OBSERVATION_FAILED: 'The backend could not observe the current physical state.',
  LOCK_NOT_ASSIGNED: 'This device is not assigned to the configured challenge team.',
  TARGET_NOT_OBSERVED: 'A fresh observation has not confirmed the requested barrier position.',
  TARGET_CHANGED: 'The barrier position changed after confirmation. Operator review is required.',
  OBSERVATION_PRECEDES_COMMAND: 'The available observation predates the command and cannot confirm it.',
  COMMAND_DELIVERY_UNRESOLVED: 'Command delivery was not acknowledged. The bay stays quarantined; an operator must stop the dispatchers and inspect the device before recovery.',
  OPERATOR_RECOVERY_REQUIRED: 'An operator must inspect and recover the bay. Refreshing the screen alone cannot release this quarantine.',
  OBSERVATION_CONFLICT: 'The hardware observation conflicts with the requested state. Keep the bay unavailable and ask the operator to review it.',
  DISPATCHER_STOPPED: 'The command dispatcher is stopped. An operator must confirm device state and recovery before actions resume.',
  NO_SHOW_RELEASE_REQUESTED: 'The arrival window ended without a confirmed arrival. Safe cleanup is requested; the bay remains allocated until that is observed.',
  SLOT_ENDED: 'The booked time ended. Safe cleanup is requested; an occupied or uncertain bay remains guarded.',
  DEPARTURE_CLEANUP_REQUESTED: 'Departure was observed. The allocation remains held while the backend checks safe cleanup.',
};
const explainReason = (value: string) => reasonCopy[value] ?? value.replaceAll('_', ' ').toLowerCase();

function deadlineLabel(deadline: string | null, now: number) {
  if (!deadline) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1_000));
  return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Checking deadline';
}

function WorkflowCard({ workflow, observation, fresh, busy, now, profile, refresh }: {
  workflow: HardwareWorkflow; observation: HardwareLock | undefined; fresh: boolean; busy: boolean; now: number;
  profile: DriverProfile | null; refresh: () => Promise<void>;
}) {
  const schedule = useHardwareSlots(workflow.bay.id);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const observationFresh = fresh && observation?.telemetryFresh && observation.lastSeenAt && now - Date.parse(observation.lastSeenAt) <= 5_000 && now - Date.parse(observation.lastSeenAt) >= 0;
  const protectionReady = workflow.capabilities.canReserve && fresh && !!observationFresh && observation?.occupancy === 'vacant' &&
    observation.barrier === 'lowered' && observation.whitelist.mode === 'disabled' && observation.activeErrors.length === 0 && observation.waterIngress === false;
  const activeSlot = schedule.snapshot?.slots.find(slot => slot.isMine && slot.bayId === workflow.bay.id &&
    ['scheduled', 'active', 'blocked', 'cancel_requested'].includes(slot.status) &&
    (slot.activatedAt !== null || Date.parse(slot.protectionStartsAt ?? slot.startsAt) <= now));
  const barrierOnly = workflow.bay.connectors.some(connector => connector.enabled && connector.type === 'BARRIER_TEST');
  const controlsReady = workflow.controlsEnabled === true && workflow.interlocksConfirmed === true;
  const noHeldReservation = workflow.reservation.expiresAt === null && workflow.reservation.id === null && !workflow.reservation.isMine;
  const intentPhaseAllowed = workflow.phase === 'idle' || workflow.phase === 'blocked' && workflow.reason === 'TELEMETRY_UNKNOWN';
  const noPendingOperation = !workflow.operation || ['confirmed', 'cancelled'].includes(workflow.operation.status);
  const knownDeviceBlock = observation?.occupancy === 'occupied' || observation?.lastReportedPresence === 'occupied' ||
    observation?.waterIngress === true || !!observation?.activeErrors.length;
  const nowAvailable = fresh && controlsReady && noHeldReservation && intentPhaseAllowed && noPendingOperation && !knownDeviceBlock;
  const needsAttention = workflow.phase === 'blocked' || workflow.phase === 'uncertain';
  const phaseText = !fresh ? 'Refresh status' : workflow.reason === 'TELEMETRY_UNKNOWN' ? 'Waiting for device update' : phaseLabels[workflow.phase];
  const lastReportedBarrier = observation && ['raised', 'lowered', 'raising', 'lowering'].includes(observation.status) ? observation.status : observation?.barrier ?? 'unknown';
  return <View style={ui.card}>
    <View style={styles.bayHeading}><View style={ui.flex}><Text style={ui.eyebrow}>{barrierOnly ? 'ECURIOUS · BARRIER-ONLY TEST' : 'ECURIOUS BAY'}</Text><Text style={ui.sectionTitle}>{workflow.bay.label}</Text></View></View>
    <Text style={ui.label}>{workflow.bay.lockId}</Text>
    <View style={[styles.phase, needsAttention && styles.attention]}><Text style={styles.phaseText}>{phaseText}</Text>{needsAttention && workflow.reason ? <Text style={ui.small}>{explainReason(workflow.reason)}</Text> : null}</View>
    <View style={styles.readings}><View style={styles.reading}><Text style={ui.small}>Barrier</Text><Text style={styles.readingValue}>{observationFresh ? observation?.barrier : 'unknown'}</Text></View><View style={styles.reading}><Text style={ui.small}>Occupancy</Text><Text style={styles.readingValue}>{observationFresh ? observation?.occupancy : 'unknown'}</Text></View></View>
    <Text style={ui.small}>Device report {time(observation?.lastSeenAt ?? null)}</Text>
    {!observationFresh && observation ? <Text style={ui.small}>Last reported {lastReportedBarrier} · {observation.lastReportedPresence}. Current state is unknown.</Text> : null}
    {activeSlot ? <Text style={ui.small}>{activeSlot.entryAuthorizedAt ? 'Plate matched · entry authorized' : activeSlot.activatedAt === null ? 'Reservation pending · protection waits for a fresh device report. Your arrival window continues while waiting.' : 'Your reservation is shown above. Entry waits for a matching plate.'}</Text> : <HardwareSlotForm bay={workflow.bay} profile={profile} now={now} schedule={schedule} nowAvailable={nowAvailable} bookingsAvailable={controlsReady} protectionPending={!protectionReady} />}
    {!activeSlot && !nowAvailable ? <ActionButton label="Refresh device" onPress={() => void refresh()} disabled={busy} variant="secondary" /> : null}
    <HardwareAlternatives alternatives={schedule.snapshot?.alternatives} />
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(open => !open)} style={styles.detailToggle}><Text style={styles.detailToggleText}>{detailsOpen ? 'Hide device details −' : 'Device details +'}</Text></Pressable>
    {detailsOpen ? <View style={styles.operation}>
      {workflow.operation ? <Text style={ui.small}>Operation {workflow.operation.kind} · {workflow.operation.status}</Text> : null}
      {observation?.activeErrors.map((error, index) => <Text key={index} style={styles.pendingCopy}>{error.replaceAll('_', ' ')}</Text>)}
      <Text style={ui.label}>Booked arrivals</Text>
      {schedule.snapshot?.slots.filter(slot => !['cancelled', 'completed', 'expired'].includes(slot.status)).slice(0, 8).map((slot, index) => <Text key={slot.id ?? index} style={ui.small}>{formatHardwareInstant(slot.startsAt)} · {slot.isMine ? 'yours' : 'booked'}</Text>)}
      <ActionButton label="Refresh device" onPress={() => void refresh()} disabled={busy} variant="secondary" />
    </View> : null}
  </View>;
}

export default function HardwareScreen() {
  const hardware = useHardwareWorkflows();
  const schedule = useHardwareSlots();
  const { profile } = useProfile();
  const [now, setNow] = useState(Date.now);
  const anchor = useRef({ serverAt: Date.now(), clientAt: Date.now() });
  useEffect(() => {
    const serverNow = schedule.snapshot?.serverNow ?? hardware.snapshot?.serverNow;
    if (serverNow) { anchor.current = { serverAt: Date.parse(serverNow), clientAt: Date.now() }; setNow(anchor.current.serverAt); }
  }, [hardware.snapshot, schedule.snapshot]);
  useEffect(() => { const timer = setInterval(() => setNow(anchor.current.serverAt + Date.now() - anchor.current.clientAt), 1_000); return () => clearInterval(timer); }, []);
  const ownSlots = schedule.snapshot?.slots.filter(slot => slot.isMine && !['completed', 'cancelled', 'expired'].includes(slot.status)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) ?? [];
  const upcoming = ownSlots.filter(slot => slot.activatedAt === null && Date.parse(slot.protectionStartsAt ?? slot.startsAt) > now);
  const current = ownSlots.filter(slot => !upcoming.includes(slot));
  const bookingCard = (slot: typeof ownSlots[number], future: boolean) => {
    const workflow = hardware.snapshot?.workflows.find(item => item.bay.id === slot.bayId);
    const deadline = slot.protectionDeadlineAt ?? slot.endsAt;
    const status = !schedule.fresh ? 'Refresh status' : future ? 'Upcoming' : slot.arrivedAt ? 'Vehicle arrived' : slot.entryAuthorizedAt ? 'Entry authorized' : slot.status === 'cancel_requested' ? 'Releasing' : workflow?.phase === 'protected' ? 'Protection confirmed' : slot.activatedAt === null ? 'Reservation pending' : slot.status === 'blocked' ? 'Blocked' : 'Protection pending';
    return <View key={slot.id!} style={ui.card}>
      <View style={styles.bayHeading}><Text style={[ui.sectionTitle, ui.flex]}>{workflow?.bay.label ?? 'Your hardware bay'}</Text><Text style={styles.badgeText}>{status}</Text></View>
      <Text style={ui.body}>Arrival {formatHardwareInstant(slot.startsAt)}</Text>
      {!future && slot.activatedAt === null ? <Text style={ui.small}>Reservation pending · protection waits for a fresh device report. The bay is not protected yet.</Text> : null}
      {!slot.entryAuthorizedAt && !slot.arrivedAt ? <Text style={styles.bookingClock}>{deadlineLabel(future ? slot.protectionStartsAt ?? slot.startsAt : deadline, now)}{future ? ' · until protection' : ''}</Text> : null}
      <HardwareBookingDetails slot={slot} policy={schedule.snapshot?.policy} fresh={schedule.fresh} busy={schedule.busy} extensionAllowed={hardware.fresh && workflow?.phase === 'protected' && now < Date.parse(deadline)} extend={schedule.extend} />
      <View style={styles.actionsRow}><Link href={{ pathname: '/session', params: { slotId: slot.id!, bayId: slot.bayId } }} asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten([ui.button, ui.secondaryButton, ui.flex])}><Text style={ui.buttonText}>View session</Text></Pressable></Link>{slot.canCancel ? <Pressable accessibilityRole="button" disabled={!schedule.fresh || schedule.busy} onPress={() => void schedule.cancel(slot.id!)} style={styles.cancelLink}><Text style={styles.detailToggleText}>Cancel</Text></Pressable> : null}</View>
    </View>;
  };
  return <SafeAreaView style={ui.safe}>
    <View style={styles.header}><Link href="/" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.backText}>‹ Map</Text></Pressable></Link><Link href="/sign-in" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.backText}>Account</Text></Pressable></Link></View>
    <ScrollView contentContainerStyle={ui.scroll} refreshControl={<RefreshControl refreshing={hardware.refreshing || schedule.refreshing} onRefresh={() => { void hardware.refresh(); void schedule.refresh(); }} colors={[palette.ink]} tintColor={palette.ink} />}>
      <View style={ui.content}>
        <View><Text style={ui.eyebrow}>ECURIOUS HARDWARE DEMO</Text><Text style={styles.title}>Hardware test.</Text></View>
        {schedule.error || hardware.error ? <View style={[ui.notice, ui.errorNotice]}><Text style={ui.body}>{schedule.error ?? hardware.error}</Text><ActionButton label="Reconnect" onPress={() => { void hardware.refresh(); void schedule.refresh(); }} disabled={hardware.busy || schedule.busy} variant="secondary" /></View> : null}
        {current.length ? <><Text style={ui.sectionTitle}>Current reservation</Text>{current.map(slot => bookingCard(slot, false))}</> : null}
        {upcoming.length ? <><Text style={ui.sectionTitle}>Upcoming</Text>{upcoming.map(slot => bookingCard(slot, true))}</> : null}
        {hardware.loading ? <ActivityIndicator color={palette.ink} /> : null}
        {hardware.snapshot && !hardware.snapshot.commandsEnabled ? <View style={ui.card}>
          <Text style={ui.sectionTitle}>lock-0002 · setup pending</Text>
          <Text style={ui.label}>Barrier-only test · no charging</Text>
          <Text style={ui.body}>Live movement is disabled until the Ecurious operator confirms occupancy interlocks and automatic re-raising, checks that OCR works with automatic camera unlocking disabled, and activates this test bay.</Text>
          <Text style={ui.small}>Save a test plate in Profile. Once activated, reserve here and present that plate to the onboard camera; the app will follow protection, plate-matched entry and sensor-confirmed departure.</Text>
          <Link href="/profile" asChild><Pressable accessibilityRole="button" style={ui.button}><Text style={ui.buttonText}>{profile?.licensePlate.trim() ? 'Review saved test plate' : 'Add test plate in Profile'}</Text></Pressable></Link>
          <Link href="/activity" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten([ui.button, ui.secondaryButton])}><Text style={ui.buttonText}>View read-only device status</Text></Pressable></Link>
          <Link href="/simulation" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten([ui.button, ui.secondaryButton])}><Text style={ui.buttonText}>Rehearse with fictional cars</Text></Pressable></Link>
        </View> : null}
        {hardware.snapshot?.commandsEnabled ? hardware.snapshot.workflows.map(workflow => <WorkflowCard key={workflow.bay.id} workflow={workflow} observation={hardware.snapshot?.observations.find(item => item.id === workflow.bay.lockId)} fresh={hardware.fresh} busy={hardware.busy} now={now} profile={profile} refresh={hardware.refresh} />) : null}
        <HardwareAlternatives alternatives={schedule.snapshot?.alternatives} />
        <Text style={ui.small}>Hardware demo · payments simulated · charging data unavailable</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  detailToggle: { minHeight: 40, justifyContent: 'center' }, detailToggleText: { color: palette.muted, fontSize: 13, fontWeight: '700' },
  bookingClock: { color: palette.ink, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }, actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, cancelLink: { padding: 10, minHeight: 44, justifyContent: 'center' },
  header: { minHeight: 62, paddingHorizontal: 20, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between' },
  back: { minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 15, color: palette.ink, fontWeight: '700' },
  headerMode: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  title: { color: palette.ink, fontWeight: '800', fontSize: 32, letterSpacing: -1, marginBottom: 12 },
  bayHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { backgroundColor: palette.soft, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 10 },
  badgeText: { color: palette.ink, fontSize: 10, fontWeight: '800' },
  phase: { backgroundColor: palette.soft, borderRadius: 13, padding: 13, gap: 7 },
  phaseText: { color: palette.ink, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  attention: { backgroundColor: palette.warning, borderRadius: 13, padding: 13, gap: 7 },
  deadline: { backgroundColor: palette.cream, borderRadius: 12, padding: 12, gap: 6 },
  deadlineText: { color: palette.ink, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  readings: { flexDirection: 'row', gap: 10 },
  reading: { flex: 1, padding: 11, backgroundColor: palette.soft, borderRadius: 12, gap: 6 },
  readingValue: { color: palette.ink, fontSize: 18, fontWeight: '700', textTransform: 'capitalize' },
  operation: { gap: 8, borderTopWidth: 1, borderColor: palette.line, paddingTop: 14 },
  pendingCopy: { fontSize: 14, lineHeight: 21, color: palette.warningInk },
  choices: { gap: 8 },
  choice: { padding: 12, minHeight: 65, borderWidth: 1, borderColor: palette.line, borderRadius: 12, backgroundColor: palette.cream, gap: 5 },
  selectedChoice: { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
  durations: { flexDirection: 'row', gap: 8 },
  duration: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.line, borderRadius: 11 },
  confirmation: { padding: 13, backgroundColor: palette.soft, borderRadius: 13, gap: 9 },
  slot: { gap: 10, borderTopWidth: 1, borderColor: palette.line, paddingTop: 14 },
});

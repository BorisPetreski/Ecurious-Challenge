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
  idle: 'No active hardware reservation',
  protect_pending: 'Protection requested · waiting to dispatch',
  protecting: 'Awaiting protection observation',
  protected: 'Protection confirmed by the backend',
  entry_pending: 'Entry requested · waiting to dispatch',
  entering: 'Awaiting entry observation',
  entry_open: 'Entry opening confirmed by the backend',
  release_pending: 'Release requested · waiting to dispatch',
  releasing: 'Awaiting release observation',
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
  return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} to the server deadline` : 'Deadline reached · checking the bay';
}

function WorkflowCard({ workflow, observation, fresh, busy, now, profile, refresh }: {
  workflow: HardwareWorkflow;
  observation: HardwareLock | undefined;
  fresh: boolean;
  busy: boolean;
  now: number;
  profile: DriverProfile | null;
  refresh: () => Promise<void>;
}) {
  const schedule = useHardwareSlots(workflow.bay.id);
  const observationFresh = fresh && observation?.telemetryFresh && observation.lastSeenAt && now - Date.parse(observation.lastSeenAt) <= 5_000 && now - Date.parse(observation.lastSeenAt) >= 0;
  const activeSlot = schedule.snapshot?.slots.find(slot => slot.isMine && slot.bayId === workflow.bay.id && slot.activatedAt !== null && ['active', 'blocked', 'cancel_requested'].includes(slot.status));
  const deadline = deadlineLabel(workflow.reservation.expiresAt, now);
  const needsAttention = workflow.phase === 'blocked' || workflow.phase === 'uncertain';

  return <View style={ui.card}>
    <View style={styles.bayHeading}><View style={ui.flex}><Text style={ui.eyebrow}>DESIGNATED ECURIOUS BAY</Text><Text style={ui.sectionTitle}>{workflow.bay.label}</Text><Text style={ui.small}>{workflow.bay.lockId}</Text></View><View style={styles.badge}><Text style={styles.badgeText}>HARDWARE</Text></View></View>
    <View style={[styles.phase, needsAttention && styles.attention]} accessibilityLiveRegion="polite"><Text style={styles.phaseText}>{fresh ? phaseLabels[workflow.phase] : 'Current workflow status unknown · refresh required'}</Text>{workflow.reason ? <Text style={ui.small}>{explainReason(workflow.reason)}</Text> : null}</View>
    <Text style={ui.label}>{workflow.reservation.isMine ? 'Your reservation' : workflow.reservation.expiresAt ? 'Reserved by another driver' : 'Reservation ownership'}</Text>
    <Text style={ui.body}>{workflow.reservation.isMine ? 'Your authenticated session owns this reservation. Entry also requires the backend to match its booked plate.' : workflow.reservation.expiresAt ? 'Another session holds this bay. Its owner and reservation ID are private.' : 'No active reservation is reported in this snapshot.'}</Text>
    {deadline ? <View style={styles.deadline}><Text style={styles.deadlineText}>{deadline}</Text><Text style={ui.small}>Server deadline: {time(workflow.reservation.expiresAt)}</Text></View> : null}
    <View style={styles.readings}><View style={styles.reading}><Text style={ui.small}>Barrier observation</Text><Text style={styles.readingValue}>{observationFresh ? observation?.barrier : 'unknown'}</Text></View><View style={styles.reading}><Text style={ui.small}>Occupancy observation</Text><Text style={styles.readingValue}>{observationFresh ? observation?.occupancy : 'unknown'}</Text></View></View>
    <Text style={ui.small}>Provider observation: {time(observation?.lastSeenAt ?? null)}. A fresh application response can still contain stale sensor data.</Text>
    {!observationFresh && observation ? <Text style={ui.small}>Last reported: barrier {observation.barrier}, occupancy {observation.lastReportedPresence}. Current state requires a report no older than five seconds.</Text> : null}
    {observation?.activeErrors.length ? <View style={styles.attention}><Text style={ui.label}>Device errors</Text>{observation.activeErrors.map((error, index) => <Text style={ui.small} key={`${error}-${index}`}>{error.replaceAll('_', ' ')}</Text>)}</View> : null}
    {workflow.operation ? <View style={styles.operation}><Text style={ui.label}>Latest command: {workflow.operation.kind}</Text><Text style={ui.small}>State: {workflow.operation.status}. Target: {workflow.operation.target}. Requested: {time(workflow.operation.requestedAt)}.</Text>{workflow.operation.status === 'acknowledged' ? <Text style={styles.pendingCopy}>Command accepted. Waiting for a fresh hardware observation; movement is not yet confirmed.</Text> : null}{workflow.operation.status === 'uncertain' ? <Text style={styles.pendingCopy}>The command is quarantined. Operator review is required; refreshing alone cannot authorize another movement.</Text> : null}</View> : null}

    <HardwareSlotForm bay={workflow.bay} profile={profile} now={now} schedule={schedule} />
    <HardwareAlternatives alternatives={schedule.snapshot?.alternatives} />
    <View style={styles.operation}><Text style={ui.label}>Booked windows for this bay</Text>{schedule.snapshot?.slots.filter(slot => slot.bayId === workflow.bay.id && !['cancelled', 'completed', 'expired'].includes(slot.status)).slice(0, 8).map((slot, index) => <Text key={slot.id ?? `${slot.startsAt}-${index}`} style={ui.small}>{formatHardwareInstant(slot.startsAt)} → {formatHardwareInstant(slot.endsAt)} · {slot.isMine ? 'your booking' : 'booked'} · {slot.status.replaceAll('_', ' ')}</Text>)}{!schedule.fresh ? <Text style={ui.small}>Refresh the schedule before relying on these windows.</Text> : null}</View>

    {workflow.reservation.isMine && workflow.reservation.id ? <>
      <ActionButton label="Check booked plate and entry status" onPress={() => void refresh()} disabled={busy} />
      <Link href={{ pathname: '/session', params: { bayId: workflow.bay.id } }} asChild><Pressable accessibilityRole="button" style={ui.button}><Text style={ui.buttonText}>Open session details</Text></Pressable></Link>
      <ActionButton label={activeSlot?.status === 'cancel_requested' ? 'Cancellation pending · awaiting safe cleanup' : 'Request cancellation / release'} variant="secondary" onPress={() => { if (activeSlot?.id) void schedule.cancel(activeSlot.id); }} disabled={!fresh || busy || schedule.busy || !schedule.fresh || !workflow.capabilities.canRequestRelease || !activeSlot?.canCancel} />
      {!activeSlot ? <Text style={ui.small}>Restore this reservation's schedule row before requesting cancellation.</Text> : null}
      <Text style={ui.small}>Entry waits for the backend to match a fresh camera observation against the booked plate. Vehicle presence does not confirm charging.</Text>
    </> : null}
    {needsAttention ? <Text style={styles.pendingCopy}>{workflow.phase === 'blocked' ? 'Keep this reservation visible and ask the Ecurious operator to inspect the bay. Missing plate data never proves vacancy.' : 'Do not resend a timed-out command. Unacknowledged delivery requires operator review after stopping dispatchers; refreshing or seeing the target position alone cannot clear quarantine.'}</Text> : null}
    <Text style={ui.small}>An elapsed countdown never confirms vacancy or authorizes movement. Physical charging evidence remains unverified.</Text>
  </View>;
}

export default function HardwareScreen() {
  const hardware = useHardwareWorkflows();
  const schedule = useHardwareSlots();
  const { profile } = useProfile();
  const [now, setNow] = useState(Date.now);
  const anchor = useRef({ serverAt: Date.now(), clientAt: Date.now() });

  useEffect(() => {
    if (!hardware.snapshot) return;
    anchor.current = { serverAt: Date.parse(hardware.snapshot.serverNow), clientAt: Date.now() };
    setNow(anchor.current.serverAt);
  }, [hardware.snapshot]);
  useEffect(() => { const timer = setInterval(() => setNow(anchor.current.serverAt + Date.now() - anchor.current.clientAt), 1_000); return () => clearInterval(timer); }, []);
  const ownSlots = schedule.snapshot?.slots.filter(slot => slot.isMine).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)) ?? [];

  return <SafeAreaView style={ui.safe}>
    <View style={styles.header}><Link href="/activity" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.backText}>‹ Activity</Text></Pressable></Link><Text style={styles.headerMode}>ECURIOUS TEST HARDWARE</Text></View>
    <ScrollView contentContainerStyle={ui.scroll} refreshControl={<RefreshControl refreshing={hardware.refreshing} onRefresh={() => void hardware.refresh()} colors={[palette.ink]} tintColor={palette.ink} />}>
      <View style={ui.content}>
        <View><Text style={ui.eyebrow}>RESERVE A PHYSICAL BAY</Text><Text style={styles.title}>Now, or ahead.</Text><Text style={ui.body}>Reserve now for ten free minutes, or book an arrival time for €1 mock. Advance protection starts ten minutes before arrival. Public map holds and the simulator remain separate.</Text></View>
        <View style={ui.notice}><Text style={ui.label}>Your booking session</Text><Text style={ui.small}>The app restores a sign-in session on this device to own your bookings. A guest session is created automatically when needed. Your local driver profile is separate from that sign-in and does not verify your contact details.</Text><Link href="/sign-in" asChild><Pressable accessibilityRole="button" style={[ui.button, ui.secondaryButton]}><Text style={ui.buttonText}>Sign in & account</Text></Pressable></Link></View>
        {schedule.error ? <View style={[ui.notice, ui.errorNotice]}><Text style={ui.noticeTitle}>Schedule connection needs attention</Text><Text style={ui.body}>{schedule.error}</Text><ActionButton label="Refresh time slots" onPress={() => void schedule.refresh()} disabled={schedule.busy || schedule.refreshing} variant="secondary" /></View> : null}
        <View style={ui.card}>
          <Text style={ui.sectionTitle}>Your time slots</Text>
          {schedule.loading ? <ActivityIndicator color={palette.ink} /> : ownSlots.length === 0 ? <Text style={ui.body}>{schedule.fresh ? 'No time-slot bookings were returned for this session.' : 'Refresh the booking service to restore your schedule.'}</Text> : ownSlots.map(slot => <View key={slot.id!} style={styles.slot}>
            <Text style={ui.label}>{slot.status.replaceAll('_', ' ')} · {slot.maskedPlate ?? 'Vehicle plate hidden'}</Text>
            <Text style={ui.small}>{formatHardwareInstant(slot.startsAt)} → {formatHardwareInstant(slot.endsAt)}</Text>
            <HardwareBookingDetails slot={slot} policy={schedule.snapshot?.policy} fresh={schedule.fresh} busy={schedule.busy} extensionAllowed={hardware.fresh && hardware.snapshot?.workflows.some(workflow => workflow.bay.id === slot.bayId && !['blocked', 'uncertain'].includes(workflow.phase)) === true && now < Date.parse(slot.endsAt)} extend={schedule.extend} />
            <Link href={{ pathname: '/session', params: { slotId: slot.id!, bayId: slot.bayId } }} asChild><Pressable accessibilityRole="button" style={[ui.button, ui.secondaryButton]}><Text style={ui.buttonText}>View session</Text></Pressable></Link>
            {slot.canCancel ? <ActionButton label="Cancel time slot" onPress={() => void schedule.cancel(slot.id!)} disabled={!schedule.fresh || schedule.busy} variant="secondary" /> : null}
          </View>)}
          <ActionButton label={schedule.refreshing ? 'Refreshing…' : 'Refresh schedule'} onPress={() => void schedule.refresh()} disabled={schedule.loading || schedule.refreshing || schedule.busy} variant="secondary" />
          <HardwareAlternatives alternatives={schedule.snapshot?.alternatives} />
        </View>
        {hardware.error ? <View style={[ui.notice, ui.errorNotice]} accessibilityLiveRegion="polite"><Text style={ui.noticeTitle}>Hardware workflow needs attention</Text><Text style={ui.body}>{hardware.error}</Text>{hardware.snapshot ? <Text style={ui.small}>Last received information is retained below. Actions pause while status is unknown.</Text> : null}</View> : null}
        {hardware.loading ? <View style={ui.notice}><ActivityIndicator color={palette.ink} /><Text style={ui.body}>Reading the designated bay…</Text></View> : null}
        {hardware.snapshot && !hardware.snapshot.commandsEnabled ? <View style={ui.card}><Text style={ui.sectionTitle}>Hardware commands are not enabled</Text><Text style={ui.body}>{hardware.snapshot.reason ? explainReason(hardware.snapshot.reason) : 'The backend is waiting for the designated bay configuration and shared reservation setup.'}</Text><Text style={ui.small}>Read-only diagnostics remain available in Activity. No barrier command has been requested from this screen.</Text></View> : null}
        {hardware.snapshot?.commandsEnabled && hardware.snapshot.reason ? <View style={ui.notice}><Text style={ui.body}>{explainReason(hardware.snapshot.reason)}</Text></View> : null}
        {hardware.snapshot?.commandsEnabled && hardware.snapshot.workflows.length === 0 ? <View style={ui.card}><Text style={ui.sectionTitle}>No designated bay registered</Text><Text style={ui.body}>The backend returned no hardware workflows for this session.</Text></View> : null}
        {hardware.snapshot?.commandsEnabled ? hardware.snapshot.workflows.map(workflow => <WorkflowCard key={workflow.bay.id} workflow={workflow} observation={hardware.snapshot?.observations.find(item => item.id === workflow.bay.lockId)} fresh={hardware.fresh} busy={hardware.busy} now={now} profile={profile} refresh={hardware.refresh} />) : null}
        <ActionButton label={hardware.busy ? 'Waiting for request reconciliation…' : hardware.refreshing ? 'Refreshing…' : 'Refresh designated bay'} onPress={() => void hardware.refresh()} disabled={hardware.busy || hardware.loading || hardware.refreshing} variant="secondary" />
        <Text style={ui.small}>Reads refresh every five seconds while the app is active. Actions pause after 15 seconds without a successful workflow read. These are app connection rules, not hardware safety guarantees.</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
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

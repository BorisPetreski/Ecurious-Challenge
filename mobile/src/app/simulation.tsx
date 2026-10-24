import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import { requestLab, type LabAction, type LabSnapshot } from '@/lib/simulation-api';

const clock = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
const readable = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ');
const money = (value: number) => '€' + (value / 100).toFixed(2);

export default function SimulationScreen() {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [carId, setCarId] = useState('car-a');
  const [bayId, setBayId] = useState('bay-1');
  const [scenarioChoice, setScenarioChoice] = useState('race');
  const [manualOpen, setManualOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const mounted = useRef(false), inFlight = useRef(false), fresh = useRef(false);
  const load = async (action?: LabAction) => {
    if (inFlight.current || action && !fresh.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const next = await requestLab(action);
      if (mounted.current) { setSnapshot(next); fresh.current = true; }
    } catch (cause) {
      if (mounted.current) { fresh.current = false; setError(cause instanceof Error ? cause.message : 'Refresh the lab before another action.'); }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  const selected = snapshot?.bays.find(bay => bay.id === bayId);
  const booking = snapshot?.bookings.find(item => item.carId === carId && !['completed', 'expired', 'refunded'].includes(item.status));
  const carName = (id: string | null) => snapshot?.cars.find(car => car.id === id)?.label ?? 'None';
  const activeScenario = snapshot?.scenarios.find(scenario => scenario.id === snapshot.scenarioId);
  const chosenScenario = snapshot?.scenarios.find(scenario => scenario.id === scenarioChoice);
  const disabled = busy || !fresh.current;
  const button = (label: string, action: LabAction) => <ActionButton key={label} label={label} onPress={() => void load(action)} disabled={disabled} variant="secondary" />;

  return <SafeAreaView style={ui.safe}>
    <View style={styles.header}><Link href="/" asChild><Pressable accessibilityRole="button" style={styles.back}><Text style={styles.link}>‹ Map</Text></Pressable></Link><Text style={styles.badge}>FICTIONAL SIMULATION</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.intro}><Text style={ui.eyebrow}>THREE CARS. SHARED BAYS.</Text><Text style={styles.title}>Scenario lab</Text><Text style={ui.body}>Try different drivers and see who owns the bay, who is physically there, and when it reopens.</Text></View>
      <View style={styles.clockRow}><View><Text style={ui.small}>Virtual time · Berlin</Text><Text style={styles.clock}>{snapshot ? clock(snapshot.now) : '—'}</Text></View><View style={styles.clockActions}>{[1, 10].map(minutes => <Pressable key={minutes} accessibilityRole="button" disabled={disabled} onPress={() => void load({ action: 'advance', minutes })} style={[styles.chip, disabled && ui.disabled]}><Text style={ui.label}>+{minutes} min</Text></Pressable>)}</View></View>
      {busy ? <ActivityIndicator color={palette.ink} /> : null}
      {error ? <View style={[ui.notice, ui.errorNotice]}><Text style={ui.body}>{error}</Text><ActionButton label="Refresh lab" onPress={() => void load()} disabled={busy} variant="secondary" /></View> : null}
      <View style={styles.section}><Text style={ui.sectionTitle}>Run a scenario</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scenarioChoices}>{snapshot?.scenarios.map(scenario => <Pressable key={scenario.id} accessibilityRole="radio" accessibilityState={{ selected: scenarioChoice === scenario.id }} onPress={() => setScenarioChoice(scenario.id)} style={[styles.chip, scenarioChoice === scenario.id && styles.selected]}><Text style={ui.label}>{scenario.label}</Text></Pressable>)}</ScrollView>
        {chosenScenario ? <View style={ui.card}><Text style={ui.body}>{chosenScenario.description}</Text><ActionButton label="Run this scenario" onPress={() => void load({ action: 'scenario', scenarioId: chosenScenario.id })} disabled={disabled} /><Text style={ui.small}>Resets the fictional world and checks the result.</Text></View> : null}
      </View>
      {snapshot?.checks.length ? <View style={ui.card}><Text style={ui.sectionTitle}>{activeScenario?.label ?? 'Scenario result'}</Text>{snapshot.checks.map(check => <Text key={check.id} style={[ui.body, !check.passed && styles.error]}>{check.passed ? '✓' : '✕'} {check.label}</Text>)}<Text style={ui.small}>These checks rehearse the model. Separate PostgreSQL tests verify real reservation rules; a live device cycle remains separate.</Text></View> : null}
      <View style={styles.section}><Text style={ui.sectionTitle}>Bays right now</Text>{snapshot?.bays.map(bay => {
        const owner = snapshot.bookings.find(item => item.id === bay.activeBookingId);
        return <Pressable key={bay.id} accessibilityRole="button" accessibilityState={{ selected: bay.id === bayId }} onPress={() => setBayId(bay.id)} style={[ui.card, bay.id === bayId && styles.selected]}>
          <View style={styles.row}><Text style={ui.label}>{bay.label}</Text><Text style={styles.status}>{readable(bay.status)}</Text></View>
          <Text style={ui.small}>{snapshot.locations.find(location => location.id === bay.locationId)?.label} · {bay.connectors.map(connector => connector.type).join(' / ')}</Text>
          <View style={styles.row}><Text style={ui.body}>Owner {carName(owner?.carId ?? null)}</Text><Text style={ui.body}>Car present {carName(bay.occupantCarId)}</Text></View>
          <Text style={ui.small}>Observed barrier: {bay.barrier}{bay.pendingCommand ? ' · ' + bay.pendingCommand.target + ' command acknowledged, awaiting observation' : ''}</Text>
        </Pressable>;
      })}</View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: manualOpen }} onPress={() => setManualOpen(open => !open)} style={styles.disclosure}><Text style={ui.sectionTitle}>Try it yourself</Text><Text style={styles.arrow}>{manualOpen ? '−' : '+'}</Text></Pressable>
      {manualOpen ? <View style={ui.card}>
        <Text style={ui.small}>Select the acting car and a bay. Switching cars simulates distinct drivers; it does not sign into another real account.</Text>
        <View style={styles.row}>{snapshot?.cars.map(car => <Pressable key={car.id} accessibilityRole="radio" accessibilityState={{ selected: car.id === carId }} onPress={() => setCarId(car.id)} style={[styles.chip, car.id === carId && styles.selected]}><Text style={ui.label}>{car.label}</Text><Text style={ui.small}>{car.maskedPlate}</Text></Pressable>)}</View>
        <Text style={ui.label}>{carName(carId)} → {selected?.label}</Text>
        {button('Reserve now · free', { action: 'reserve', carId, bayId, bookingMode: 'now' })}
        {button('Schedule arrival in 20 min · €1 mock', { action: 'reserve', carId, bayId, bookingMode: 'scheduled', arrivalMinutesFromNow: 20 })}
        {booking ? <>{button('Add 10 minutes · €1 mock', { action: 'extend', carId, bookingId: booking.id })}<Text style={ui.small}>Your booking: {readable(booking.status)} · hold {clock(booking.protectionStartsAt)} → {clock(booking.deadlineAt)}</Text></> : null}
        <View style={ui.rule} /><Text style={ui.label}>Camera and sensor events</Text>
        {button('Scan selected car · 99% confidence', { action: 'scan', carId, bayId, confidence: 0.99 })}
        {button('Scan selected car · 40% confidence', { action: 'scan', carId, bayId, confidence: 0.4 })}
        {selected?.pendingCommand ? button('Observe barrier ' + selected.pendingCommand.target, { action: 'observe', bayId }) : null}
        {button('Park selected car', { action: 'park', carId, bayId })}
        {button('Selected car leaves', { action: 'depart', carId })}
        {button('Simulate an unreserved car occupying bay', { action: 'block', carId, bayId })}
        {button('Observe blocker gone', { action: 'clear', bayId })}
      </View> : null}
      {snapshot?.bookings.length ? <View style={styles.section}><Text style={ui.sectionTitle}>Bookings</Text>{snapshot.bookings.slice().reverse().map(item => <View key={item.id} style={styles.booking}><View style={styles.row}><Text style={ui.label}>{carName(item.carId)} · {snapshot.bays.find(bay => bay.id === item.bayId)?.label}</Text><Text style={styles.status}>{readable(item.status)}</Text></View><Text style={ui.small}>{item.bookingMode === 'scheduled' ? 'Arrival ' + clock(item.startsAt) + ' · ' : ''}Hold {clock(item.protectionStartsAt)} → {clock(item.deadlineAt)}</Text><Text style={ui.small}>{money(item.mockFeeCents)} mock fee{item.mockRefundCents ? ' · ' + money(item.mockRefundCents) + ' mock refund' : ''}{item.entryAuthorizedAt ? ' · plate matched' : ''}</Text>{item.alternativeLocationId ? <Text style={ui.body}>Suggested: {snapshot.locations.find(location => location.id === item.alternativeLocationId)?.label}</Text> : null}</View>)}</View> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: timelineOpen }} onPress={() => setTimelineOpen(open => !open)} style={styles.disclosure}><Text style={ui.sectionTitle}>Event timeline</Text><Text style={styles.arrow}>{timelineOpen ? '−' : '+'}</Text></Pressable>
      {timelineOpen ? <View style={ui.card}>{snapshot?.events.slice(0, 30).map(event => <View key={event.id} style={styles.event}><Text style={ui.small}>{clock(event.at)} · {readable(event.type)}</Text><Text style={ui.body}>{event.message}</Text></View>)}</View> : null}
      <ActionButton label="Reset fictional world" onPress={() => void load({ action: 'reset' })} disabled={disabled} variant="secondary" />
      <Text style={styles.note}>Local rehearsal only · fictional cars and locations · no real reservations, camera images, hardware commands or payments. Reset affects this lab only.</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingHorizontal: 20 },
  back: { minHeight: 52, justifyContent: 'center' }, link: { color: palette.ink, fontWeight: '700', fontSize: 14 }, badge: { color: palette.muted, fontSize: 10, fontWeight: '800' },
  content: { padding: 20, gap: 20, maxWidth: 700, width: '100%', alignSelf: 'center' }, intro: { gap: 10 }, title: { color: palette.ink, fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  clockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: palette.lime, borderRadius: 18 }, clock: { color: palette.ink, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] }, clockActions: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }, section: { gap: 12 },
  scenarioChoices: { gap: 8 }, selected: { borderColor: '#819645', backgroundColor: '#F0F6DC' },
  arrow: { color: palette.ink, fontSize: 25 }, chip: { backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, borderRadius: 12, padding: 12, minHeight: 44, justifyContent: 'center' },
  status: { color: palette.muted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }, disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  booking: { backgroundColor: palette.paper, padding: 15, borderRadius: 14, gap: 9, borderWidth: 1, borderColor: palette.line }, event: { gap: 6, paddingVertical: 8 }, note: { color: palette.muted, fontSize: 11, lineHeight: 17 }, error: { color: palette.errorInk },
});

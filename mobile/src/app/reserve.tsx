import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton, AppScreen, ConnectionNotice, SectionHeading, ui } from '@/components/bayready-ui';
import { useBayReady } from '@/components/reservation-provider';
import { palette, readable } from '@/constants/bayready';
import type { ReservationAction, ReservationCapabilities, ReservationState } from '@/lib/reservation-api';

const stations = [
  { name: 'Venue demo bay', connectors: 'CCS2 · 150 kW', selected: true },
  { name: 'Greenway charging hub', connectors: 'CCS2 · 50 kW', selected: false },
  { name: 'Parkside destination', connectors: 'Type 2 · 22 kW', selected: false },
];

function useArrivalClock(state: ReservationState | null) {
  const anchor = useMemo(() => ({ local: Date.now(), server: state ? Date.parse(state.now) : Date.now() }), [state?.now]);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const reservation = state?.reservation;
  if (!reservation || !['awaiting-arrival', 'manual-review'].includes(reservation.status)) return null;
  const currentTime = anchor.server + Math.max(0, tick - anchor.local);
  const seconds = Math.max(0, Math.ceil((Date.parse(reservation.expiresAt) - currentTime) / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ReserveScreen() {
  const { state, loading, busy, error, reserve, act, plate, setPlate, holdMinutes, setHoldMinutes, confidence, setConfidence } = useBayReady();
  const [showScenarios, setShowScenarios] = useState(false);
  const countdown = useArrivalClock(state);
  const unavailable = loading || busy || !!error || !state;
  const normalized = plate.trim().replace(/[ -]/g, '');
  const validPlate = /^[a-zA-Z0-9 -]+$/.test(plate) && plate.length <= 20 && normalized.length >= 2 && normalized.length <= 12;
  const caps = state?.capabilities;
  const booking = state?.reservation;
  const stages: { action: ReservationAction; capability: keyof ReservationCapabilities; label: string; detail: string }[] = [
    { action: 'arrive', capability: 'canArrive', label: '02 · Simulate arrival', detail: 'Use the fictional plate and confidence below.' },
    { action: 'start-charge', capability: 'canStartCharge', label: '03 · Start simulated charge', detail: 'Changes simulator state; no electricity is delivered.' },
    { action: 'depart', capability: 'canDepart', label: '04 · Simulate departure', detail: 'Mark the demo vehicle as having left.' },
    { action: 'release', capability: 'canRelease', label: booking && ['awaiting-arrival', 'manual-review'].includes(booking.status) ? 'Cancel arrival hold' : '05 · Release demo bay', detail: 'Finish when the simulated bay is empty.' },
  ];

  return (
    <AppScreen>
      <View style={styles.hero}>
        <Text style={ui.eyebrow}>LESS GUESSWORK. MORE GO.</Text>
        <Text accessibilityRole="header" style={styles.headline}>Your next stop,{ '\n' }sorted.</Text>
        <Text style={ui.body}>Reserve a charging bay. Rehearse the arrival. Keep the next driver moving.</Text>
      </View>

      <ConnectionNotice />

      <View style={styles.bayCard} accessibilityLiveRegion="polite">
        <View style={styles.bayTop}>
          <Text style={styles.bayEyebrow}>VENUE DEMO BAY</Text>
          <View style={styles.statusPill}><Text style={styles.statusText}>{state ? readable(state.bay.status) : 'Connecting'}</Text></View>
        </View>
        <View style={styles.bayMain}>
          <View style={styles.bayCopy}>
            <Text style={styles.bayTitle}>{booking ? readable(booking.status) : 'A little peace\nof charge.'}</Text>
            <Text style={styles.bayDescription}>{booking ? `Booking for ${booking.maskedPlate}` : 'One fictional bay. A complete practice journey.'}</Text>
          </View>
          <View style={styles.bayGraphic} accessible accessibilityLabel={`Simulated bay ${state?.bay.occupied ? 'occupied' : 'empty'}`}>
            <View style={styles.parkingLine} />
            {state?.bay.occupied ? <View style={styles.car}><View style={styles.carWindow} /><Text style={styles.carBolt}>ϟ</Text></View> : <Text style={styles.parkingSymbol}>P</Text>}
            <View style={[styles.parkingLine, styles.parkingRight]} />
          </View>
        </View>
        <View style={styles.bayDivider} />
        <View style={styles.bayFacts}>
          <View style={styles.fact}><Text style={styles.factLabel}>SIMULATED SENSOR</Text><Text style={styles.factValue}>{state ? state.bay.occupied ? 'Vehicle present' : 'Bay empty' : 'Not connected'}</Text></View>
          <View style={styles.fact}><Text style={styles.factLabel}>VIRTUAL BARRIER</Text><Text style={styles.factValue}>{state ? readable(state.bay.barrier) : 'Unknown'}</Text></View>
        </View>
        {countdown ? <View style={styles.countdownRow}><Text style={styles.countdown}>{countdown}</Text><Text style={styles.countdownLabel}>arrival window remaining</Text></View> : null}
        <Text style={styles.simulationNote}>All hardware and charging here are simulated.</Text>
      </View>

      <View>
        <SectionHeading eyebrow="01 / RESERVATION" title={booking ? 'Your practice booking' : 'Hold your spot'} />
        <View style={ui.card}>
          <Text style={ui.label}>Fictional licence plate</Text>
          <TextInput
            value={plate}
            onChangeText={setPlate}
            editable={!busy}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            placeholder="M-DEMO-42"
            placeholderTextColor={palette.muted}
            accessibilityLabel="Fictional licence plate for booking and simulated arrival"
            style={styles.plateInput}
            returnKeyType="done"
          />
          <Text style={ui.small}>Use a made-up plate. This same input is used for simulated arrival, so you can also test a mismatch.</Text>
          {!validPlate ? <Text style={styles.validation}>Enter 2–12 letters or numbers. Spaces and hyphens are allowed.</Text> : null}
          <Text style={ui.label}>Arrival hold</Text>
          <View style={styles.optionsRow}>
            {[5, 10, 15].map(minutes => (
              <Pressable
                key={minutes}
                accessibilityRole="radio"
                accessibilityState={{ checked: holdMinutes === minutes, disabled: busy || !!booking }}
                disabled={busy || !!booking}
                onPress={() => setHoldMinutes(minutes)}
                style={({ pressed }) => [styles.option, holdMinutes === minutes && styles.optionSelected, pressed && ui.pressed]}>
                <Text style={styles.optionText}>{minutes} min</Text>
              </Pressable>
            ))}
          </View>
          <ActionButton label={busy ? 'Updating simulator…' : '01 · Reserve demo bay'} onPress={() => void reserve(plate.trim(), holdMinutes)} disabled={unavailable || !caps?.canReserve || !validPlate} loading={busy} />
          {booking ? <Text style={ui.small}>An active booking already holds this bay. Continue below or release the hold.</Text> : null}
        </View>
      </View>

      <View>
        <SectionHeading eyebrow="02—05 / THE JOURNEY" title="Walk through the flow" trailing={busy ? <ActivityIndicator color={palette.ink} /> : undefined} />
        <View style={ui.card}>
          {booking?.status === 'manual-review' ? <View style={styles.review}><Text style={styles.reviewTitle}>Arrival needs a corrected observation</Text><Text style={ui.small}>{booking.reviewReason === 'low-confidence' ? 'The simulated recognition confidence is below the 90% demo threshold.' : 'The observed fictional plate did not match this booking.'} Correct the plate or select 99% confidence, then simulate arrival again.</Text></View> : null}
          {booking?.status === 'expired-occupied' ? <View style={styles.review}><Text style={styles.reviewTitle}>Hold expired while the bay was blocked</Text><Text style={ui.small}>Clear the simulated blocking vehicle in Scenario controls. The hold stays visible until the bay is empty.</Text></View> : null}
          <Text style={ui.label}>Simulated recognition confidence</Text>
          <View style={styles.optionsRow}>
            {[{ value: 0.99, label: '99% · clear' }, { value: 0.75, label: '75% · uncertain' }].map(option => (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: confidence === option.value, disabled: busy }} disabled={busy} onPress={() => setConfidence(option.value)} style={({ pressed }) => [styles.option, confidence === option.value && styles.optionSelected, pressed && ui.pressed]}>
                <Text style={styles.optionText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={ui.small}>These controls supply test observations. No phone camera or live plate recognition is connected.</Text>
          {stages.map(stage => <View key={stage.action} style={styles.stage}>
            <ActionButton label={stage.label} variant={caps?.[stage.capability] ? 'dark' : 'secondary'} disabled={unavailable || !caps?.[stage.capability] || (stage.action === 'arrive' && !validPlate)} onPress={() => void act(stage.action, stage.action === 'arrive' ? { plate: plate.trim(), confidence } : undefined)} />
            <Text style={ui.small}>{stage.detail}</Text>
          </View>)}
        </View>
      </View>

      <View style={styles.scenarioCard}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showScenarios }} onPress={() => setShowScenarios(value => !value)} style={({ pressed }) => [styles.disclosure, pressed && ui.pressed]}>
          <View style={ui.flex}><Text style={styles.disclosureTitle}>Scenario controls</Text><Text style={ui.small}>No-shows, blocked bays and reset</Text></View><Text style={styles.disclosureMark}>{showScenarios ? '−' : '+'}</Text>
        </Pressable>
        {showScenarios ? <View style={styles.scenarios}>
          <Text style={ui.small}>These override the local simulator only. Expire hold advances its clock; reset clears the shared demo booking and events.</Text>
          {([
            { action: 'block', cap: 'canBlock', label: 'Add blocking vehicle' },
            { action: 'clear', cap: 'canClear', label: 'Clear blocking vehicle' },
            { action: 'expire', cap: 'canExpire', label: 'Expire arrival hold' },
            { action: 'reset', cap: 'canReset', label: 'Reset simulator' },
          ] as const).map(item => <ActionButton key={item.action} label={item.label} variant="secondary" disabled={unavailable || !caps?.[item.cap]} onPress={() => void act(item.action)} />)}
        </View> : null}
      </View>

      <View>
        {state?.reservation?.status === 'charging' ? <Link href={{ pathname: '/session', params: { simulator: '1' } }} asChild><Pressable accessibilityRole="button" style={styles.mapLink}><View style={ui.flex}><Text style={styles.mapLinkTitle}>Open simulated session</Text><Text style={ui.small}>Elapsed duration and rehearsal state</Text></View><Text style={styles.mapLinkArrow}>↗</Text></Pressable></Link> : null}
        <SectionHeading eyebrow="DISCOVERY PREVIEW" title="Places to plug in" />
        <Link href="/map" asChild>
          <Pressable accessibilityRole="link" style={({ pressed }) => [styles.mapLink, pressed && ui.pressed]}>
            <View style={ui.flex}><Text style={styles.mapLinkTitle}>Explore the GoingElectric map</Text><Text style={ui.small}>Public chargers, search and filters</Text></View>
            <Text style={styles.mapLinkArrow}>↗</Text>
          </Pressable>
        </Link>
        <Text style={[ui.body, styles.stationIntro]}>Synthetic examples for the mobile starter. Only the venue demo bay supports the simulator flow.</Text>
        <View style={styles.stationList}>
          {stations.map(station => <View key={station.name} style={[styles.station, station.selected && styles.selectedStation]}>
            <View style={ui.row}><View style={styles.stationIcon}><Text style={styles.stationBolt}>ϟ</Text></View><View style={ui.flex}><Text style={styles.stationTitle}>{station.name}</Text><Text style={ui.small}>{station.connectors}</Text></View></View>
            <View style={styles.stationFooter}><Text style={styles.synthetic}>SYNTHETIC EXAMPLE</Text><Text style={styles.stationType}>{station.selected ? 'Selected · simulator' : 'Discovery only'}</Text></View>
          </View>)}
        </View>
        <Text style={[ui.small, styles.directoryNote]}>The Map tab shows GoingElectric’s public directory. These example cards are fictional and have no live availability. Reservations cover the demo bay only.</Text>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 8 },
  headline: { fontSize: 41, lineHeight: 44, fontWeight: '800', letterSpacing: -1.8, color: palette.ink, marginBottom: 4 },
  bayCard: { backgroundColor: palette.ink, padding: 22, borderRadius: 25, gap: 18 },
  bayTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  bayEyebrow: { color: '#C7D3BB', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  statusPill: { backgroundColor: palette.lime, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 13, fontWeight: '800', color: palette.ink },
  bayMain: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bayCopy: { flex: 1, gap: 8 },
  bayTitle: { color: palette.paper, fontSize: 28, lineHeight: 32, fontWeight: '700', letterSpacing: -0.8 },
  bayDescription: { color: '#C7D3BB', fontSize: 14, lineHeight: 20 },
  bayGraphic: { width: 70, height: 98, alignItems: 'center', justifyContent: 'center' },
  parkingLine: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, backgroundColor: '#6C7A62' },
  parkingRight: { left: undefined, right: 0 },
  parkingSymbol: { color: '#7F9272', fontSize: 45, fontWeight: '500' },
  car: { width: 46, height: 78, borderRadius: 14, backgroundColor: palette.lime, padding: 6, alignItems: 'center' },
  carWindow: { backgroundColor: palette.ink, height: 15, width: 31, borderRadius: 5 },
  carBolt: { fontSize: 32, fontWeight: '700', color: palette.ink },
  bayDivider: { height: 1, backgroundColor: '#42503D' },
  bayFacts: { flexDirection: 'row', gap: 16 },
  fact: { flex: 1, gap: 5 },
  factLabel: { color: '#C7D3BB', fontSize: 10, fontWeight: '600', letterSpacing: 0.8 },
  factValue: { color: palette.paper, fontSize: 15, fontWeight: '600', textTransform: 'capitalize' },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  countdown: { color: palette.lime, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  countdownLabel: { flex: 1, color: '#DAE5CF', fontSize: 14, lineHeight: 20 },
  simulationNote: { fontSize: 12, lineHeight: 18, color: '#C7D3BB' },
  plateInput: { minHeight: 56, borderWidth: 1, borderColor: palette.line, borderRadius: 12, backgroundColor: palette.cream, paddingHorizontal: 14, color: palette.ink, fontSize: 21, fontWeight: '600', letterSpacing: 1 },
  optionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  option: { flex: 1, minWidth: 65, minHeight: 48, backgroundColor: palette.cream, borderWidth: 1, borderColor: palette.line, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  optionSelected: { borderColor: palette.ink, backgroundColor: palette.soft },
  optionText: { color: palette.ink, fontWeight: '700', fontSize: 14, textAlign: 'center' },
  validation: { fontSize: 14, color: palette.errorInk, lineHeight: 20 },
  stage: { gap: 7, marginTop: 3 },
  review: { backgroundColor: palette.warning, padding: 14, borderRadius: 12, gap: 7 },
  reviewTitle: { color: palette.warningInk, fontWeight: '700', fontSize: 15 },
  scenarioCard: { borderWidth: 1, borderColor: palette.line, borderRadius: 20, backgroundColor: palette.soft },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 76, padding: 18 },
  disclosureTitle: { color: palette.ink, fontSize: 17, fontWeight: '700', marginBottom: 3 },
  disclosureMark: { color: palette.ink, fontSize: 27, fontWeight: '400' },
  scenarios: { gap: 10, paddingHorizontal: 18, paddingBottom: 18 },
  stationIntro: { marginBottom: 14 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.soft, borderWidth: 1, borderColor: palette.line, borderRadius: 16, padding: 17, marginBottom: 14, minHeight: 72 },
  mapLinkTitle: { color: palette.ink, fontSize: 16, fontWeight: '700', marginBottom: 3 },
  mapLinkArrow: { color: palette.ink, fontSize: 26 },
  stationList: { gap: 12 },
  station: { backgroundColor: palette.paper, padding: 17, borderWidth: 1, borderColor: palette.line, borderRadius: 18, gap: 18 },
  selectedStation: { borderColor: '#839B43' },
  stationIcon: { backgroundColor: palette.soft, height: 45, width: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  stationBolt: { color: palette.ink, fontSize: 29, fontWeight: '700' },
  stationTitle: { fontSize: 16, color: palette.ink, fontWeight: '700', marginBottom: 3 },
  stationFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  synthetic: { fontSize: 10, letterSpacing: 0.6, color: palette.muted, fontWeight: '700' },
  stationType: { fontSize: 12, color: palette.ink, fontWeight: '700' },
  directoryNote: { marginTop: 14 },
});

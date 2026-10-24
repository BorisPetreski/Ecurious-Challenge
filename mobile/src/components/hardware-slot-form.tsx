import DateTimePicker from '@/components/date-time-picker';
import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import type { useHardwareSlots } from '@/hooks/use-hardware-slots';
import type { DriverProfile } from '@/lib/driver-profile';
import { fetchHardwareQuote, type HardwareBookingMode, type HardwareQuote } from '@/lib/hardware-slots-api';
import { berlinTimeChoices, berlinTimeFields, formatHardwareInstant, validateHardwareWindow } from '@/lib/hardware-time';
import type { HardwareWorkflow } from '@/lib/hardware-workflow-api';

const money = (cents: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(cents / 100);
type Schedule = ReturnType<typeof useHardwareSlots>;
const pad = (value: number) => String(value).padStart(2, '0');

export function HardwareSlotForm({ bay, profile, now, schedule, nowAvailable = true, bookingsAvailable = true, protectionPending = false }: { bay: HardwareWorkflow['bay']; profile: DriverProfile | null; now: number; schedule: Schedule; nowAvailable?: boolean; bookingsAvailable?: boolean; protectionPending?: boolean }) {
  const router = useRouter();
  const initial = useRef(now + 30 * 60_000);
  const [bookingMode, setBookingMode] = useState<HardwareBookingMode>('now');
  const [startFields, setStartFields] = useState(() => berlinTimeFields(initial.current));
  const [startOffset, setStartOffset] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [quote, setQuote] = useState<HardwareQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const quoteRequest = useRef<AbortController | null>(null);
  const quoteSequence = useRef(0);
  const mounted = useRef(true);
  const startChoices = berlinTimeChoices(startFields.date, startFields.time);
  const scheduledStart = startChoices.length === 1 ? startChoices[0].iso : startChoices.find(choice => choice.offset === startOffset)?.iso ?? null;
  const scheduledEnd = scheduledStart ? new Date(Date.parse(scheduledStart) + 10 * 60_000).toISOString() : null;
  const hasPlate = !!profile?.licensePlate.trim();
  const barrierOnly = bay.connectors.some(connector => connector.enabled && connector.type === 'BARRIER_TEST');
  const compatible = bay.connectors.filter(connector => connector.enabled && (connector.type === 'BARRIER_TEST' || !profile || connector.type === profile.connectorType));
  const connector = compatible.find(item => item.id === connectorId);
  const nowBlocked = bookingMode === 'now' && !nowAvailable;
  const bookingBlocked = !bookingsAvailable || nowBlocked;
  const windowError = bookingMode === 'now' ? null : scheduledStart && scheduledEnd ? validateHardwareWindow(scheduledStart, scheduledEnd, now) : 'Choose a valid Berlin time and an offset if the time occurs twice.';
  const quoteMatches = !bookingBlocked && hasPlate && !!quote && quote.bookingMode === bookingMode && (bookingMode === 'now' || !!scheduledStart && !!scheduledEnd && Date.parse(quote.startsAt) === Date.parse(scheduledStart) && Date.parse(quote.endsAt) === Date.parse(scheduledEnd));
  const policy = schedule.snapshot?.policy;
  const freeMinutes = policy?.nowFreeMinutes ?? 10;
  const leadMinutes = policy?.protectionLeadMinutes ?? 10;

  useEffect(() => {
    setQuote(null); setError(null); setNotice(null); quoteRequest.current?.abort(); quoteSequence.current++; setQuoting(false);
  }, [bookingMode, scheduledStart, scheduledEnd, connectorId, profile?.licensePlate, profile?.paymentMethod]);
  useEffect(() => {
    if (!bookingBlocked) return;
    setQuote(null); quoteRequest.current?.abort(); quoteSequence.current++; setQuoting(false);
  }, [bookingBlocked]);
  useEffect(() => { setConnectorId(current => compatible.some(item => item.id === current) ? current : compatible[0]?.id ?? null); }, [profile?.connectorType, compatible.map(item => item.id).join(',')]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; quoteRequest.current?.abort(); }; }, []);

  const getWindow = () => bookingMode === 'now'
    ? { startsAt: new Date(now).toISOString(), endsAt: new Date(now + freeMinutes * 60_000).toISOString() }
    : scheduledStart && scheduledEnd ? { startsAt: scheduledStart, endsAt: scheduledEnd } : null;
  const getQuote = async () => {
    if (!profile || !hasPlate) { router.push('/profile'); return; }
    const window = getWindow();
    if (!window || !connector || windowError || !schedule.fresh || bookingBlocked) return;
    quoteRequest.current?.abort(); const controller = new AbortController(); quoteRequest.current = controller;
    const sequence = ++quoteSequence.current; setQuoting(true); setError(null); setQuote(null);
    try { const next = await fetchHardwareQuote(window.startsAt, window.endsAt, controller.signal, bookingMode); if (mounted.current && !controller.signal.aborted && quoteSequence.current === sequence) setQuote(next); }
    catch (failure) { if (mounted.current && !controller.signal.aborted && quoteSequence.current === sequence) setError(failure instanceof Error ? failure.message : 'The mock quote could not be read.'); }
    finally { if (mounted.current && quoteSequence.current === sequence) setQuoting(false); }
  };
  useEffect(() => { if (profile && hasPlate && connector && schedule.fresh && !windowError && !bookingBlocked) void getQuote(); }, [bookingMode, scheduledStart, scheduledEnd, connectorId, profile?.licensePlate, profile?.paymentMethod, schedule.fresh, bookingBlocked]);
  const confirm = async () => {
    const window = getWindow();
    if (!profile || !hasPlate || !connector || !window || windowError || !quoteMatches || !schedule.fresh || bookingBlocked) return;
    setError(null); setNotice(null);
    const accepted = await schedule.reserve({ bayId: bay.id, connectorId: connector.id, ...window, licensePlate: profile.licensePlate, bookingMode });
    if (mounted.current && accepted) { setQuote(null); setNotice(bookingMode === 'now' && protectionPending ? 'Reservation pending · protection waits for a fresh device report.' : 'Booking saved.'); }
  };
  const chooseQuick = (minutes: number) => { setStartFields(berlinTimeFields(now + minutes * 60_000)); setStartOffset(null); };
  const [year, month, day] = startFields.date.split('-').map(Number);
  const [hour, minute] = startFields.time.split(':').map(Number);
  // Android uses device wall fields. Treat its selected fields as Berlin wall
  // time, then resolve them explicitly above instead of trusting its UTC instant.
  const pickerValue = picker === 'time' ? new Date(2000, 0, 15, hour, minute) : new Date(year, month - 1, day, 12);
  const calendarBound = (instant: number) => { const fields = berlinTimeFields(instant).date.split('-').map(Number); return new Date(fields[0], fields[1] - 1, fields[2], 12); };

  return <View style={styles.form}>
    <Text style={ui.sectionTitle}>Reserve this bay</Text>
    {barrierOnly ? <View style={styles.quote}><Text style={ui.label}>Barrier-only test · no charging</Text><Text style={ui.small}>Test reservation, plate recognition and barrier entry on the designated device. Your saved charging connector does not limit this test.</Text></View> : null}
    <View style={styles.modes}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: bookingMode === 'now', disabled: schedule.busy }} disabled={schedule.busy} onPress={() => setBookingMode('now')} style={[styles.mode, bookingMode === 'now' && styles.selected]}><Text style={styles.modeTitle}>Now</Text><Text style={ui.label}>Free</Text><Text style={ui.small}>{freeMinutes}-minute hold</Text></Pressable>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: bookingMode === 'scheduled', disabled: schedule.busy }} disabled={schedule.busy} onPress={() => setBookingMode('scheduled')} style={[styles.mode, bookingMode === 'scheduled' && styles.selected]}><Text style={styles.modeTitle}>Schedule</Text><Text style={ui.label}>{money(policy?.scheduledFeeCents ?? 100)}</Text><Text style={ui.small}>Choose your arrival</Text></Pressable>
    </View>
    {bookingMode === 'now' ? <Text style={ui.small}>A {freeMinutes}-minute hold. Add 10 minutes later for €1.</Text> : <>
      <Text style={ui.label}>Arrival · Berlin time</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open arrival calendar" disabled={schedule.busy} onPress={() => setPicker('date')} style={styles.pickerButton}><Text style={ui.small}>Date</Text><Text style={styles.pickerValue}>{startFields.date}</Text><Text style={ui.small}>Open calendar</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open arrival time picker" disabled={schedule.busy} onPress={() => setPicker('time')} style={styles.pickerButton}><Text style={ui.small}>Time</Text><Text style={styles.pickerValue}>{startFields.time}</Text><Text style={ui.small}>Choose time</Text></Pressable>
      </View>
      {picker ? <View style={styles.nativePicker}><DateTimePicker value={pickerValue} mode={picker} presentation="dialog" display={picker === 'date' ? 'calendar' : 'clock'} is24Hour timeZoneName={Platform.OS === 'ios' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined} minimumDate={picker === 'date' ? calendarBound(now) : undefined} maximumDate={picker === 'date' ? calendarBound(now + 7 * 86_400_000) : undefined} accentColor={palette.ink} onValueChange={(_event, date) => {
        if (picker === 'date') setStartFields(fields => ({ ...fields, date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) }));
        else setStartFields(fields => ({ ...fields, time: pad(date.getHours()) + ':' + pad(date.getMinutes()) }));
        setStartOffset(null); setPicker(null);
      }} onDismiss={() => setPicker(null)} />
      {Platform.OS === 'ios' ? <ActionButton label="Done" onPress={() => setPicker(null)} variant="secondary" /> : null}</View> : null}
      {startChoices.length === 2 ? <View style={styles.offset}><Text style={ui.small}>This Berlin time occurs twice. Choose its offset:</Text><View style={styles.row}>{startChoices.map(choice => <Pressable key={choice.offset} accessibilityRole="button" accessibilityState={{ selected: startOffset === choice.offset }} onPress={() => setStartOffset(choice.offset)} style={[styles.chip, startOffset === choice.offset && styles.selected]}><Text style={ui.label}>{choice.offset}</Text></Pressable>)}</View></View> : null}
      <View style={styles.row}>{[15, 30, 60].map(minutes => <Pressable key={minutes} accessibilityRole="button" disabled={schedule.busy} onPress={() => chooseQuick(minutes)} style={styles.chip}><Text style={styles.durationText}>In {minutes} min</Text></Pressable>)}</View>
      {scheduledStart && scheduledEnd ? <View style={styles.quote}><Text style={ui.small}>Protection from {formatHardwareInstant(new Date(Math.max(now, Date.parse(scheduledStart) - leadMinutes * 60_000)).toISOString())}</Text><Text style={ui.small}>Arrival {formatHardwareInstant(scheduledStart)}</Text><Text style={ui.small}>Unused hold until {formatHardwareInstant(scheduledEnd)}</Text></View> : null}
    </>}
    {!bookingsAvailable ? <Text style={ui.small} accessibilityLiveRegion="polite">This hardware test is paused. New reservations become available when device control is activated.</Text> : nowBlocked ? <Text style={ui.small} accessibilityLiveRegion="polite">A reservation is unavailable in the current device state. Refresh the device before reserving now.</Text> : bookingMode === 'now' && protectionPending ? <Text style={ui.small}>You can save your reservation now. Its {freeMinutes}-minute window starts immediately; protection waits for a fresh device report. The bay is not protected yet.</Text> : null}
    <Text style={ui.label}>{barrierOnly ? 'Test target' : 'Compatible connector'}</Text>
    {compatible.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: connectorId === item.id, disabled: schedule.busy }} disabled={schedule.busy} onPress={() => setConnectorId(item.id)} style={[styles.connector, connectorId === item.id && styles.selected]}><Text style={ui.label}>{item.label}</Text><Text style={ui.small}>{item.type === 'BARRIER_TEST' ? 'Barrier-only test · no charging' : (item.type === 'Typ2' ? 'Type 2' : item.type) + ' · ' + item.powerKw + ' kW'}</Text></Pressable>)}
    {compatible.length === 0 ? <Text style={ui.body}>No enabled connector matches your profile. Update its connector preference.</Text> : null}
    {bay.connectors.length > 1 ? <Text style={ui.small}>The selected connector reserves this entire parking bay.</Text> : null}
    {windowError ? <Text style={styles.error}>{windowError}</Text> : null}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    {profile && !hasPlate ? <View style={styles.quote}>
      <Text style={ui.small}>This hardware booking needs a vehicle plate for camera matching. Public map software holds work without one.</Text>
      <Link href="/profile" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten([ui.button, ui.secondaryButton])}><Text style={ui.buttonText}>Add vehicle plate for hardware booking</Text></Pressable></Link>
    </View> : quoteMatches && quote ? <View style={styles.quote}>
      {profile ? <Text style={ui.body}>Vehicle •••• {profile.licensePlate.replace(/[^\p{L}\p{N}]/gu, '').slice(-2)} · {profile.paymentMethod === 'mock-wallet' ? 'Mock wallet' : 'Mock card'}</Text> : null}
      <ActionButton label={schedule.busy ? 'Recording reservation…' : bookingMode === 'now' ? 'Reserve free · 10 minutes' : 'Confirm booking · ' + money(quote.fixedFeeCents)} onPress={() => void confirm()} disabled={schedule.busy || !schedule.fresh || !hasPlate || !!windowError} />
    </View> : <ActionButton label={!profile ? 'Set up profile to book' : !bookingsAvailable ? 'Test paused' : nowBlocked ? 'Waiting for device' : quoting ? 'Getting reservation quote…' : 'Refresh price'} onPress={() => void getQuote()} disabled={quoting || schedule.busy || (!profile ? false : bookingBlocked || !schedule.fresh || !connector || !!windowError)} />}
    {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
    {schedule.error ? <Text style={styles.error}>{schedule.error}</Text> : null}
    <Text style={ui.small}>Hardware demo · mock payment · plate used for vehicle access</Text>
  </View>;
}

const styles = StyleSheet.create({
  form: { gap: 13, borderTopWidth: 1, borderColor: palette.line, paddingTop: 17 },
  row: { flexDirection: 'row', gap: 8 }, modes: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1, padding: 15, borderWidth: 1, borderColor: palette.line, borderRadius: 13, backgroundColor: palette.paper, gap: 7 },
  modeTitle: { color: palette.ink, fontSize: 19, fontWeight: '800' },
  chip: { flex: 1, minHeight: 43, borderWidth: 1, borderColor: palette.line, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper },
  pickerButton: { flex: 1, minHeight: 92, borderWidth: 1, borderColor: palette.line, borderRadius: 12, padding: 12, gap: 5, backgroundColor: palette.paper },
  pickerValue: { color: palette.ink, fontSize: 18, fontWeight: '700' }, nativePicker: { gap: 8 },
  selected: { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
  connector: { padding: 12, gap: 5, borderWidth: 1, borderColor: palette.line, borderRadius: 12 },
  offset: { gap: 8 }, durationText: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  error: { color: palette.errorInk, fontSize: 13, lineHeight: 20 },
  quote: { backgroundColor: palette.soft, borderRadius: 13, padding: 14, gap: 10 },
  notice: { color: palette.ink, backgroundColor: palette.soft, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 21 },
});

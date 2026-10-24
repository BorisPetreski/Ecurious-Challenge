import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useRouter } from 'expo-router';
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

export function HardwareSlotForm({ bay, profile, now, schedule }: { bay: HardwareWorkflow['bay']; profile: DriverProfile | null; now: number; schedule: Schedule }) {
  const router = useRouter();
  const initial = useRef(now + 30 * 60_000);
  const [bookingMode, setBookingMode] = useState<HardwareBookingMode>('now');
  const [startFields, setStartFields] = useState(() => berlinTimeFields(initial.current));
  const [startOffset, setStartOffset] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(30);
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
  const scheduledEnd = scheduledStart ? new Date(Date.parse(scheduledStart) + durationMinutes * 60_000).toISOString() : null;
  const compatible = bay.connectors.filter(connector => connector.enabled && (!profile || connector.type === profile.connectorType));
  const connector = compatible.find(item => item.id === connectorId);
  const windowError = bookingMode === 'now' ? null : scheduledStart && scheduledEnd ? validateHardwareWindow(scheduledStart, scheduledEnd, now) : 'Choose a valid Berlin time and an offset if the time occurs twice.';
  const quoteMatches = !!quote && quote.bookingMode === bookingMode && (bookingMode === 'now' || !!scheduledStart && !!scheduledEnd && Date.parse(quote.startsAt) === Date.parse(scheduledStart) && Date.parse(quote.endsAt) === Date.parse(scheduledEnd));
  const policy = schedule.snapshot?.policy;
  const freeMinutes = policy?.nowFreeMinutes ?? 10;
  const leadMinutes = policy?.protectionLeadMinutes ?? 10;

  useEffect(() => {
    setQuote(null); setError(null); setNotice(null); quoteRequest.current?.abort(); quoteSequence.current++; setQuoting(false);
  }, [bookingMode, scheduledStart, scheduledEnd, connectorId, profile?.licensePlate, profile?.paymentMethod]);
  useEffect(() => { setConnectorId(null); }, [profile?.connectorType]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; quoteRequest.current?.abort(); }; }, []);

  const getWindow = () => bookingMode === 'now'
    ? { startsAt: new Date(now).toISOString(), endsAt: new Date(now + freeMinutes * 60_000).toISOString() }
    : scheduledStart && scheduledEnd ? { startsAt: scheduledStart, endsAt: scheduledEnd } : null;
  const getQuote = async () => {
    if (!profile) { router.push('/profile'); return; }
    const window = getWindow();
    if (!window || !connector || windowError || !schedule.fresh) return;
    quoteRequest.current?.abort(); const controller = new AbortController(); quoteRequest.current = controller;
    const sequence = ++quoteSequence.current; setQuoting(true); setError(null); setQuote(null);
    try { const next = await fetchHardwareQuote(window.startsAt, window.endsAt, controller.signal, bookingMode); if (mounted.current && !controller.signal.aborted && quoteSequence.current === sequence) setQuote(next); }
    catch (failure) { if (mounted.current && !controller.signal.aborted && quoteSequence.current === sequence) setError(failure instanceof Error ? failure.message : 'The mock quote could not be read.'); }
    finally { if (mounted.current && quoteSequence.current === sequence) setQuoting(false); }
  };
  const confirm = async () => {
    const window = getWindow();
    if (!profile || !connector || !window || windowError || !quoteMatches || !schedule.fresh) return;
    setError(null); setNotice(null);
    const accepted = await schedule.reserve({ bayId: bay.id, connectorId: connector.id, ...window, licensePlate: profile.licensePlate, bookingMode });
    if (mounted.current && accepted) { setQuote(null); setNotice('Your request was recorded. Check the assigned bay and payment status below; protection still needs hardware confirmation.'); }
  };
  const chooseQuick = (minutes: number) => { setStartFields(berlinTimeFields(now + minutes * 60_000)); setStartOffset(null); };
  const [year, month, day] = startFields.date.split('-').map(Number);
  const [hour, minute] = startFields.time.split(':').map(Number);
  // Android uses device wall fields. Treat its selected fields as Berlin wall
  // time, then resolve them explicitly above instead of trusting its UTC instant.
  const pickerValue = picker === 'time' ? new Date(2000, 0, 15, hour, minute) : new Date(year, month - 1, day, 12);
  const calendarBound = (instant: number) => { const fields = berlinTimeFields(instant).date.split('-').map(Number); return new Date(fields[0], fields[1] - 1, fields[2], 12); };

  return <View style={styles.form}>
    <Text style={ui.sectionTitle}>Choose your reservation</Text>
    <View style={styles.modes}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: bookingMode === 'now', disabled: schedule.busy }} disabled={schedule.busy} onPress={() => setBookingMode('now')} style={[styles.mode, bookingMode === 'now' && styles.selected]}><Text style={styles.modeTitle}>Reserve now</Text><Text style={ui.label}>Free · {freeMinutes} minutes</Text><Text style={ui.small}>Start immediately. Add 10 minutes for €1 mock after booking.</Text></Pressable>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: bookingMode === 'scheduled', disabled: schedule.busy }} disabled={schedule.busy} onPress={() => setBookingMode('scheduled')} style={[styles.mode, bookingMode === 'scheduled' && styles.selected]}><Text style={styles.modeTitle}>Book ahead</Text><Text style={ui.label}>{money(policy?.scheduledFeeCents ?? 100)} mock</Text><Text style={ui.small}>Pick an arrival date and time. Protection starts {leadMinutes} minutes before.</Text></Pressable>
    </View>
    {bookingMode === 'now' ? <Text style={ui.body}>The free {freeMinutes}-minute window starts when the server accepts your reservation. Watch for confirmed protection before approaching the bay.</Text> : <>
      <Text style={ui.label}>Arrival · Europe/Berlin</Text>
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
      <Text style={ui.label}>Booked duration</Text>
      <View style={styles.row}>{[15, 30, 60, 120].map(minutes => <Pressable key={minutes} accessibilityRole="button" accessibilityState={{ selected: durationMinutes === minutes }} disabled={schedule.busy} onPress={() => setDurationMinutes(minutes)} style={[styles.chip, durationMinutes === minutes && styles.selected]}><Text style={styles.durationText}>{minutes} min</Text></Pressable>)}</View>
      {scheduledStart && scheduledEnd ? <Text style={ui.small}>{formatHardwareInstant(scheduledStart)} → {formatHardwareInstant(scheduledEnd)} · Berlin. Protection is requested {leadMinutes} minutes before arrival, or immediately if booked closer.</Text> : null}
    </>}
    <Text style={ui.label}>Compatible connector</Text>
    {compatible.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: connectorId === item.id, disabled: schedule.busy }} disabled={schedule.busy} onPress={() => setConnectorId(item.id)} style={[styles.connector, connectorId === item.id && styles.selected]}><Text style={ui.label}>{item.label}</Text><Text style={ui.small}>{item.type === 'Typ2' ? 'Type 2' : item.type} · {item.powerKw} kW</Text></Pressable>)}
    {compatible.length === 0 ? <Text style={ui.body}>No enabled connector matches your profile. Update its connector preference.</Text> : null}
    <Text style={ui.small}>One vehicle occupies the whole bay, including its other plugs. If this bay is occupied, the backend checks another compatible bay at the same location.</Text>
    {windowError ? <Text style={styles.error}>{windowError}</Text> : null}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    {quoteMatches && quote ? <View style={styles.quote}>
      <Text style={ui.label}>{bookingMode === 'now' ? 'Reserve now · ' : 'Book ahead · '}{quote.fixedFeeCents === 0 ? 'Free' : money(quote.fixedFeeCents) + ' mock'}</Text>
      <Text style={ui.small}>{bookingMode === 'now' ? 'Ten minutes free. Add another ten minutes for €1 mock from your booking.' : 'One fixed mock reservation fee. Protection is requested ten minutes before your arrival.'} No real payment is taken.</Text>
      <Text style={ui.small}>If the whole location is unavailable, a paid mock booking is refunded and nearby registered alternatives are suggested. Acknowledgement alone does not confirm safe movement.</Text>
      {profile ? <Text style={ui.body}>Vehicle •••• {profile.licensePlate.replace(/[^\p{L}\p{N}]/gu, '').slice(-2)} · {profile.paymentMethod === 'mock-wallet' ? 'Mock wallet' : 'Mock card'}</Text> : null}
      <ActionButton label={schedule.busy ? 'Recording reservation…' : bookingMode === 'now' ? 'Confirm free 10-minute reservation' : 'Confirm ' + money(quote.fixedFeeCents) + ' mock booking'} onPress={() => void confirm()} disabled={schedule.busy || !schedule.fresh || !!windowError} />
    </View> : <ActionButton label={!profile ? 'Set up profile to book' : quoting ? 'Getting reservation quote…' : 'Review reservation'} onPress={() => void getQuote()} disabled={quoting || schedule.busy || (!profile ? false : !schedule.fresh || !connector || !!windowError)} />}
    {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
    {schedule.error ? <Text style={styles.error}>{schedule.error}</Text> : null}
    <Text style={ui.small}>Your plate is sent only for this hardware reservation and compared with a fresh camera observation. Contact details and mock payment stay on your phone.</Text>
  </View>;
}

const styles = StyleSheet.create({
  form: { gap: 13, borderTopWidth: 1, borderColor: palette.line, paddingTop: 17 },
  row: { flexDirection: 'row', gap: 8 }, modes: { gap: 10 },
  mode: { padding: 15, borderWidth: 1, borderColor: palette.line, borderRadius: 13, backgroundColor: palette.paper, gap: 7 },
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

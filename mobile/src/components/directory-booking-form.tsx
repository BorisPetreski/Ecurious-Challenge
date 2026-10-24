import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import type { DriverProfile } from '@/lib/driver-profile';
import { berlinTimeChoices, berlinTimeFields, formatHardwareInstant, validateHardwareWindow } from '@/lib/hardware-time';

export interface DirectoryBookingChoice { bookingMode: 'now' | 'scheduled'; startsAt?: string }
const pad = (value: number) => String(value).padStart(2, '0');

export function DirectoryBookingForm({ profile, now, fresh, busy, nowAllowed, onConfirm }: {
  profile: DriverProfile; now: number; fresh: boolean; busy: boolean; nowAllowed: boolean;
  onConfirm: (choice: DirectoryBookingChoice) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'now' | 'scheduled'>(nowAllowed ? 'now' : 'scheduled');
  const [fields, setFields] = useState(() => berlinTimeFields(now + 30 * 60_000));
  const [offset, setOffset] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const choices = berlinTimeChoices(fields.date, fields.time);
  const startsAt = choices.length === 1 ? choices[0].iso : choices.find(choice => choice.offset === offset)?.iso ?? null;
  const windowError = mode === 'now' ? nowAllowed ? null : 'This app plug is reserved now. Choose Book ahead.' : startsAt ? validateHardwareWindow(startsAt, new Date(Date.parse(startsAt) + 10 * 60_000).toISOString(), now) : 'Choose a valid Berlin time and its offset if the time occurs twice.';
  useEffect(() => { setReviewing(false); }, [mode, startsAt, profile.licensePlate, profile.paymentMethod]);
  useEffect(() => { if (!nowAllowed && mode === 'now') { setMode('scheduled'); setReviewing(false); } }, [mode, nowAllowed]);
  const confirm = async () => {
    if (!fresh || busy || windowError || mode === 'scheduled' && !startsAt) return;
    if (!reviewing) { setReviewing(true); return; }
    if (await onConfirm({ bookingMode: mode, ...(mode === 'scheduled' && startsAt ? { startsAt } : {}) })) setReviewing(false);
  };
  const [year, month, day] = fields.date.split('-').map(Number);
  const [hour, minute] = fields.time.split(':').map(Number);
  const value = picker === 'time' ? new Date(2000, 0, 15, hour, minute) : new Date(year, month - 1, day, 12);
  const bound = (instant: number) => { const parts = berlinTimeFields(instant).date.split('-').map(Number); return new Date(parts[0], parts[1] - 1, parts[2], 12); };

  return <View style={styles.form}>
    <View style={styles.modes}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === 'now', disabled: busy || !nowAllowed }} disabled={busy || !nowAllowed} onPress={() => setMode('now')} style={[styles.mode, mode === 'now' && styles.selected, !nowAllowed && styles.disabled]}><Text style={styles.title}>Reserve now</Text><Text style={ui.label}>Free · 10 minutes</Text><Text style={ui.small}>Add 10 minutes for €1 mock after booking.</Text></Pressable>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === 'scheduled', disabled: busy }} disabled={busy} onPress={() => setMode('scheduled')} style={[styles.mode, mode === 'scheduled' && styles.selected]}><Text style={styles.title}>Book ahead</Text><Text style={ui.label}>€1 mock</Text><Text style={ui.small}>Choose an arrival. The app allocation starts 10 minutes before.</Text></Pressable>
    </View>
    {mode === 'scheduled' ? <>
      <Text style={ui.label}>Arrival · Europe/Berlin</Text>
      <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel="Open arrival calendar" disabled={busy} onPress={() => setPicker('date')} style={styles.pickerButton}><Text style={ui.small}>Calendar</Text><Text style={ui.label}>{fields.date}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Open arrival time picker" disabled={busy} onPress={() => setPicker('time')} style={styles.pickerButton}><Text style={ui.small}>Time</Text><Text style={ui.label}>{fields.time}</Text></Pressable></View>
      {picker ? <View><DateTimePicker value={value} mode={picker} presentation="dialog" display={picker === 'date' ? 'calendar' : 'clock'} is24Hour minimumDate={picker === 'date' ? bound(now) : undefined} maximumDate={picker === 'date' ? bound(now + 7 * 86_400_000) : undefined} onDismiss={() => setPicker(null)} onValueChange={(_event, date) => {
        if (picker === 'date') setFields(previous => ({ ...previous, date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) }));
        else setFields(previous => ({ ...previous, time: pad(date.getHours()) + ':' + pad(date.getMinutes()) }));
        setOffset(null); setPicker(null);
      }} />{Platform.OS === 'ios' ? <ActionButton label="Done" onPress={() => setPicker(null)} variant="secondary" /> : null}</View> : null}
      {choices.length === 2 ? <><Text style={ui.small}>This Berlin time occurs twice. Choose its offset:</Text><View style={styles.row}>{choices.map(choice => <Pressable key={choice.offset} accessibilityRole="button" accessibilityState={{ selected: offset === choice.offset }} onPress={() => setOffset(choice.offset)} style={[styles.chip, offset === choice.offset && styles.selected]}><Text style={ui.label}>{choice.offset}</Text></Pressable>)}</View></> : null}
      <View style={styles.row}>{[15, 30, 60].map(minutes => <Pressable key={minutes} accessibilityRole="button" disabled={busy} onPress={() => { setFields(berlinTimeFields(now + minutes * 60_000)); setOffset(null); }} style={styles.chip}><Text style={styles.chipText}>In {minutes} min</Text></Pressable>)}</View>
      {startsAt ? <Text style={ui.small}>Arrival {formatHardwareInstant(startsAt)}. App allocation ends 10 minutes after arrival; a conflicting booking is refused.</Text> : null}
    </> : null}
    {windowError ? <Text style={styles.error}>{windowError}</Text> : null}
    {reviewing ? <View style={styles.review}><Text style={ui.label}>{mode === 'now' ? 'Free 10-minute app reservation' : '€1 fixed mock app reservation'}</Text><Text style={ui.body}>Vehicle •••• {profile.licensePlate.replace(/[^\p{L}\p{N}]/gu, '').slice(-2)} · {profile.paymentMethod === 'mock-wallet' ? 'Mock wallet' : 'Mock card'}</Text><Text style={ui.small}>No real payment. Your vehicle details remain on your phone for this public app booking.</Text></View> : null}
    <ActionButton label={busy ? 'Saving app reservation…' : reviewing ? mode === 'now' ? 'Confirm free 10-minute app booking' : 'Confirm €1 mock app booking' : 'Review app reservation'} onPress={() => void confirm()} disabled={!fresh || busy || !!windowError} />
    <Text style={ui.small}>BayReady software allocation only. Public barrier control, physical occupancy and charging remain unverified.</Text>
  </View>;
}

const styles = StyleSheet.create({
  form: { gap: 12 }, modes: { gap: 9 }, row: { flexDirection: 'row', gap: 8 },
  mode: { borderWidth: 1, borderColor: palette.line, borderRadius: 12, padding: 12, gap: 6, backgroundColor: palette.paper },
  title: { color: palette.ink, fontSize: 18, fontWeight: '800' }, selected: { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
  pickerButton: { flex: 1, borderWidth: 1, borderColor: palette.line, borderRadius: 11, padding: 12, gap: 8, minHeight: 72 },
  chip: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.line, borderRadius: 11 },
  chipText: { color: palette.ink, fontSize: 12, fontWeight: '700' }, review: { backgroundColor: palette.soft, borderRadius: 12, padding: 12, gap: 8 },
  error: { color: palette.errorInk, fontSize: 13, lineHeight: 20 }, disabled: { opacity: 0.45 },
});

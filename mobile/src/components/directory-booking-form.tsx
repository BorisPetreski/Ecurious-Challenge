import DateTimePicker from '@/components/date-time-picker';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import type { DriverProfile } from '@/lib/driver-profile';
import { berlinTimeChoices, berlinTimeFields, formatHardwareInstant, validateHardwareWindow } from '@/lib/hardware-time';

export interface DirectoryBookingChoice { bookingMode: 'now' | 'scheduled'; startsAt?: string }
interface BookingAction { label: string; disabled: boolean }
interface BookingFormHandle { submit: () => Promise<void> }
const pad = (value: number) => String(value).padStart(2, '0');

export function DirectoryBookingForm({ profile, now, fresh, busy, nowAllowed, onConfirm, onProfile, actionRef, onActionChange, externalAction = false }: {
  profile: DriverProfile | null; now: number; fresh: boolean; busy: boolean; nowAllowed: boolean;
  onConfirm: (choice: DirectoryBookingChoice) => Promise<boolean>;
  onProfile?: () => void; actionRef?: Ref<BookingFormHandle>; onActionChange?: (action: BookingAction) => void; externalAction?: boolean;
}) {
  const [mode, setMode] = useState<'now' | 'scheduled'>(nowAllowed ? 'now' : 'scheduled');
  const [fields, setFields] = useState(() => berlinTimeFields(now + 30 * 60_000));
  const [offset, setOffset] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const choices = berlinTimeChoices(fields.date, fields.time);
  const startsAt = choices.length === 1 ? choices[0].iso : choices.find(choice => choice.offset === offset)?.iso ?? null;
  const windowError = mode === 'now' ? nowAllowed ? null : 'This app plug is reserved now. Choose Book ahead.' : startsAt ? validateHardwareWindow(startsAt, new Date(Date.parse(startsAt) + 10 * 60_000).toISOString(), now) : 'Choose a valid Berlin time and its offset if the time occurs twice.';
  useEffect(() => { if (!nowAllowed && mode === 'now') { setMode('scheduled'); } }, [mode, nowAllowed]);
  const confirm = async () => {
    if (!profile) { onProfile?.(); return; }
    if (!fresh || busy || windowError || mode === 'scheduled' && !startsAt) return;
    await onConfirm({ bookingMode: mode, ...(mode === 'scheduled' && startsAt ? { startsAt } : {}) });
  };
  const actionLabel = !profile ? 'Add your vehicle to reserve' : busy ? 'Reserving…' : mode === 'now' ? 'Reserve free · 10 minutes' : 'Confirm booking · €1';
  const actionDisabled = busy || !!profile && (!fresh || !!windowError);
  useImperativeHandle(actionRef, () => ({ submit: confirm }));
  useEffect(() => { onActionChange?.({ label: actionLabel, disabled: actionDisabled }); }, [actionLabel, actionDisabled, onActionChange]);
  const [year, month, day] = fields.date.split('-').map(Number);
  const [hour, minute] = fields.time.split(':').map(Number);
  const value = picker === 'time' ? new Date(2000, 0, 15, hour, minute) : new Date(year, month - 1, day, 12);
  const bound = (instant: number) => { const parts = berlinTimeFields(instant).date.split('-').map(Number); return new Date(parts[0], parts[1] - 1, parts[2], 12); };

  return <View style={styles.form}>
    <View style={styles.modes}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === 'now', disabled: busy || !nowAllowed }} disabled={busy || !nowAllowed} onPress={() => setMode('now')} style={[styles.mode, mode === 'now' && styles.selected, !nowAllowed && styles.disabled]}><Text style={styles.title}>Now</Text><Text style={ui.label}>Free</Text><Text style={ui.small}>10-minute hold</Text></Pressable>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === 'scheduled', disabled: busy }} disabled={busy} onPress={() => setMode('scheduled')} style={[styles.mode, mode === 'scheduled' && styles.selected]}><Text style={styles.title}>Schedule</Text><Text style={ui.label}>€1</Text><Text style={ui.small}>Choose your arrival</Text></Pressable>
    </View>
    {mode === 'scheduled' ? <>
      <Text style={ui.label}>Arrival · Berlin time</Text>
      <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel="Open arrival calendar" disabled={busy} onPress={() => setPicker('date')} style={styles.pickerButton}><Text style={ui.small}>Calendar</Text><Text style={ui.label}>{fields.date}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Open arrival time picker" disabled={busy} onPress={() => setPicker('time')} style={styles.pickerButton}><Text style={ui.small}>Time</Text><Text style={ui.label}>{fields.time}</Text></Pressable></View>
      {picker ? <View><DateTimePicker value={value} mode={picker} presentation="dialog" display={picker === 'date' ? 'calendar' : 'clock'} is24Hour minimumDate={picker === 'date' ? bound(now) : undefined} maximumDate={picker === 'date' ? bound(now + 7 * 86_400_000) : undefined} onDismiss={() => setPicker(null)} onValueChange={(_event, date) => {
        if (picker === 'date') setFields(previous => ({ ...previous, date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) }));
        else setFields(previous => ({ ...previous, time: pad(date.getHours()) + ':' + pad(date.getMinutes()) }));
        setOffset(null); setPicker(null);
      }} />{Platform.OS === 'ios' ? <ActionButton label="Done" onPress={() => setPicker(null)} variant="secondary" /> : null}</View> : null}
      {choices.length === 2 ? <><Text style={ui.small}>This Berlin time occurs twice. Choose its offset:</Text><View style={styles.row}>{choices.map(choice => <Pressable key={choice.offset} accessibilityRole="button" accessibilityState={{ selected: offset === choice.offset }} onPress={() => setOffset(choice.offset)} style={[styles.chip, offset === choice.offset && styles.selected]}><Text style={ui.label}>{choice.offset}</Text></Pressable>)}</View></> : null}
      <View style={styles.row}>{[15, 30, 60].map(minutes => <Pressable key={minutes} accessibilityRole="button" disabled={busy} onPress={() => { setFields(berlinTimeFields(now + minutes * 60_000)); setOffset(null); }} style={styles.chip}><Text style={styles.chipText}>In {minutes} min</Text></Pressable>)}</View>
      {startsAt ? <View style={styles.review}><Text style={ui.small}>Hold starts {formatHardwareInstant(new Date(Date.parse(startsAt) - 10 * 60_000).toISOString())}</Text><Text style={ui.small}>Hold ends {formatHardwareInstant(new Date(Date.parse(startsAt) + 10 * 60_000).toISOString())}</Text></View> : null}
    </> : null}
    {windowError ? <Text style={styles.error}>{windowError}</Text> : null}
    {profile ? <Text style={ui.small}>{profile.licensePlate.trim() ? 'Vehicle •••• ' + profile.licensePlate.replace(/[^\p{L}\p{N}]/gu, '').slice(-2) : 'Vehicle plate not added'} · {profile.paymentMethod === 'mock-wallet' ? 'Mock wallet' : 'Mock card'}</Text> : null}
    {!externalAction ? <ActionButton label={actionLabel} onPress={() => void confirm()} disabled={actionDisabled} /> : null}
  </View>;
}

export function DirectoryBookingModal({ visible, title, plugLabel, profile, now, fresh, busy, nowAllowed, error, unavailableReason, onConfirm, onClose, onChangePlug, onProfile, onRefresh, onSource }: {
  visible: boolean; title: string; plugLabel: string; profile: DriverProfile | null; now: number; fresh: boolean; busy: boolean; nowAllowed: boolean; error: string | null; unavailableReason?: string;
  onConfirm: (choice: DirectoryBookingChoice) => Promise<boolean>; onClose: () => void; onChangePlug: () => void; onProfile: () => void; onRefresh: () => void; onSource: () => void;
}) {
  const handle = useRef<BookingFormHandle | null>(null);
  const [action, setAction] = useState<BookingAction>({ label: 'Review reservation', disabled: true });
  const updateAction = useCallback((next: BookingAction) => setAction(previous => previous.label === next.label && previous.disabled === next.disabled ? previous : next), []);
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaView style={styles.modal}>
      <View style={styles.modalHeader}><View style={ui.flex}><Text style={ui.eyebrow}>RESERVE A CHARGER</Text><Text style={styles.modalTitle}>{title}</Text><Text style={ui.small}>{plugLabel}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close reservation" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View>
      <ScrollView style={ui.flex} contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={onChangePlug} style={styles.changePlug}><Text style={styles.changePlugText}>‹ Choose another app plug</Text></Pressable>
        {!fresh && !error ? <Text style={ui.small}>Refresh booking status to continue.</Text> : null}
        {error || unavailableReason ? <View style={[ui.notice, ui.errorNotice]}><Text style={styles.error}>{unavailableReason ?? error}</Text></View> : null}
        <DirectoryBookingForm profile={profile} now={now} fresh={fresh && !unavailableReason} busy={busy} nowAllowed={nowAllowed} onConfirm={onConfirm} onProfile={onProfile} actionRef={handle} onActionChange={updateAction} externalAction />
        <Pressable accessibilityRole="link" onPress={onSource} style={styles.changePlug}><Text style={styles.changePlugText}>Directory © GoingElectric · station source ↗</Text></Pressable>
      </ScrollView>
      <View style={styles.modalFooter}>
        {!fresh ? <ActionButton label="Reconnect bookings" onPress={onRefresh} disabled={busy} variant="secondary" /> : null}
        <ActionButton label={action.label} onPress={() => void handle.current?.submit()} disabled={action.disabled || !!unavailableReason} />
        <Text style={styles.footerCopy}>App hold only · no barrier control · mock payment</Text>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  form: { gap: 12 }, modes: { flexDirection: 'row', gap: 9 }, row: { flexDirection: 'row', gap: 8 },
  mode: { flex: 1, borderWidth: 1, borderColor: palette.line, borderRadius: 12, padding: 12, gap: 6, backgroundColor: palette.paper },
  title: { color: palette.ink, fontSize: 18, fontWeight: '800' }, selected: { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
  pickerButton: { flex: 1, borderWidth: 1, borderColor: palette.line, borderRadius: 11, padding: 12, gap: 8, minHeight: 72 },
  chip: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.line, borderRadius: 11 },
  chipText: { color: palette.ink, fontSize: 12, fontWeight: '700' }, review: { backgroundColor: palette.soft, borderRadius: 12, padding: 12, gap: 8 },
  error: { color: palette.errorInk, fontSize: 13, lineHeight: 20 }, disabled: { opacity: 0.45 },
  modal: { flex: 1, backgroundColor: palette.paper }, modalHeader: { padding: 20, flexDirection: 'row', gap: 12, borderBottomWidth: 1, borderColor: palette.line },
  modalTitle: { color: palette.ink, fontSize: 22, fontWeight: '800', marginVertical: 6 }, modalContent: { padding: 20, gap: 14 },
  modalFooter: { paddingHorizontal: 20, paddingVertical: 14, gap: 10, borderTopWidth: 1, borderColor: palette.line, backgroundColor: palette.paper }, footerCopy: { color: palette.muted, fontSize: 10, textAlign: 'center' },
  close: { width: 38, height: 38, borderRadius: 12, backgroundColor: palette.soft, alignItems: 'center', justifyContent: 'center' }, closeText: { color: palette.ink, fontSize: 27 },
  changePlug: { minHeight: 38, justifyContent: 'center' }, changePlugText: { color: palette.ink, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
});

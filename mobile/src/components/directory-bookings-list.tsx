import { Link } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import type { DirectoryBooking } from '@/lib/directory-booking-contract';
import { formatHardwareInstant } from '@/lib/hardware-time';

function countdown(deadline: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1_000));
  return seconds > 0 ? Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : 'Checking status';
}
const clock = (instant: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).format(new Date(instant));

export function DirectoryBookingsList({ visible, bookings, activeIds, now, fresh, busy, loading, error, labelFor, onClose, onRefresh, onExtend, onCancel }: {
  visible: boolean; bookings: DirectoryBooking[]; activeIds: Set<string>; now: number; fresh: boolean; busy: boolean; loading: boolean; error: string | null;
  labelFor: (booking: DirectoryBooking) => { station: string; plug: string };
  onClose: () => void; onRefresh: () => void; onExtend: (id: string) => void; onCancel: (id: string) => void;
}) {
  const active = bookings.filter(booking => activeIds.has(booking.id));
  const upcoming = bookings.filter(booking => !activeIds.has(booking.id) && Date.parse(booking.protectionStartsAt) > now);
  const pending = bookings.filter(booking => !activeIds.has(booking.id) && !upcoming.includes(booking));
  const card = (booking: DirectoryBooking, status: 'Active' | 'Upcoming' | 'Checking') => {
    const label = labelFor(booking);
    return <View key={booking.id} style={styles.card}>
      <View style={styles.row}><Text style={styles.station}>{label.station}</Text><Text style={styles.status}>{fresh ? status : 'Refresh'}</Text></View>
      <Text style={ui.small}>{label.plug}</Text>
      <Text style={styles.timer}>{!fresh ? 'Status unavailable' : status === 'Upcoming' ? countdown(booking.protectionStartsAt, now) + ' until protection' : countdown(booking.expiresAt, now) + (Date.parse(booking.expiresAt) > now ? ' remaining' : '')}</Text>
      {booking.bookingMode === 'scheduled' ? <Text style={ui.body}>Arrival {formatHardwareInstant(booking.startsAt)}</Text> : null}
      <Text style={ui.small}>Hold {clock(booking.protectionStartsAt)} → {clock(booking.expiresAt)}</Text>
      <View style={styles.row}><Text style={styles.price}>{booking.reservationFeeCents === 0 ? 'Free' : '€' + (booking.reservationFeeCents / 100).toFixed(2) + ' mock'}</Text><Pressable accessibilityRole="button" disabled={!fresh || busy} onPress={() => onCancel(booking.id)} style={styles.cancel}><Text style={[styles.cancelText, (!fresh || busy) && styles.disabled]}>Cancel</Text></Pressable></View>
      {fresh && booking.bookingMode !== 'legacy' && status === 'Active' && now < Date.parse(booking.expiresAt) ? <ActionButton label="Add 10 minutes · €1" onPress={() => onExtend(booking.id)} disabled={busy} variant="secondary" /> : null}
    </View>;
  };
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}><View style={ui.flex}><Text style={ui.eyebrow}>BAYREADY</Text><Text style={styles.title}>My bookings</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close bookings" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator>
        {error ? <View style={[ui.notice, ui.errorNotice]}><Text style={ui.body}>{error}</Text></View> : null}
        {loading && bookings.length === 0 ? <Text style={ui.body}>Loading your bookings…</Text> : bookings.length === 0 ? <View style={styles.card}><Text style={ui.sectionTitle}>No bookings yet</Text><Text style={ui.body}>Choose a charger on the map to reserve now or schedule an arrival.</Text><ActionButton label="Find a charger" onPress={onClose} /></View> : null}
        {active.length ? <><Text style={styles.section}>Active holds</Text>{active.map(booking => card(booking, 'Active'))}</> : null}
        {upcoming.length ? <><Text style={styles.section}>Upcoming</Text><Text style={ui.small}>These bookings leave current map availability unchanged until their protection time.</Text>{upcoming.map(booking => card(booking, 'Upcoming'))}</> : null}
        {pending.length ? <><Text style={styles.section}>Checking status</Text>{pending.map(booking => card(booking, 'Checking'))}</> : null}
        <Link href="/hardware" asChild><Pressable accessibilityRole="button" onPress={onClose} style={styles.hardwareLink}><Text style={styles.cancelText}>Ecurious hardware bookings ›</Text></Pressable></Link>
      </ScrollView>
      <View style={styles.footer}><ActionButton label={busy ? 'Updating…' : 'Refresh bookings'} onPress={onRefresh} disabled={busy} variant="secondary" /><Text style={styles.note}>App reservations · mock payment · physical occupancy unverified</Text></View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.cream }, header: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.paper },
  title: { color: palette.ink, fontSize: 30, fontWeight: '800', marginTop: 6 }, content: { padding: 20, gap: 13 },
  card: { padding: 17, gap: 10, borderRadius: 18, backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, station: { flex: 1, color: palette.ink, fontSize: 18, fontWeight: '800' },
  status: { color: palette.ink, fontSize: 11, fontWeight: '700', backgroundColor: palette.soft, padding: 6, borderRadius: 7 },
  timer: { color: palette.ink, fontSize: 23, fontWeight: '800', fontVariant: ['tabular-nums'] }, price: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  section: { color: palette.ink, fontSize: 20, fontWeight: '800', marginTop: 8 }, cancel: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 8 }, cancelText: { color: palette.muted, fontSize: 13, fontWeight: '700' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.soft, borderRadius: 12 }, closeText: { color: palette.ink, fontSize: 26 },
  footer: { paddingHorizontal: 20, paddingVertical: 13, gap: 10, backgroundColor: palette.paper, borderTopWidth: 1, borderColor: palette.line }, note: { color: palette.muted, fontSize: 10, textAlign: 'center' }, hardwareLink: { minHeight: 44, justifyContent: 'center', alignItems: 'center' }, disabled: { opacity: 0.4 },
});

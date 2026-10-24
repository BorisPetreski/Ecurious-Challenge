import { Linking, StyleSheet, Text, View } from 'react-native';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import type { HardwareAlternative, HardwareFeePolicy, HardwareSlot } from '@/lib/hardware-slots-api';
import { formatHardwareInstant } from '@/lib/hardware-time';

const money = (cents: number) => '€' + (cents / 100).toFixed(2);

export function HardwareBookingDetails({ slot, policy, fresh, busy, extensionAllowed, extend }: {
  slot: HardwareSlot; policy: HardwareFeePolicy | undefined; fresh: boolean; busy: boolean;
  extensionAllowed: boolean; extend: (id: string) => Promise<boolean>;
}) {
  const canExtend = slot.isMine && !!slot.id && slot.bookingMode === 'now' && ['scheduled', 'active'].includes(slot.status);
  const fee = slot.reservationFeeCents;
  return <View style={styles.details}>
    <Text style={ui.label}>{slot.bookingMode === 'now' ? 'Reserve now' : slot.bookingMode === 'scheduled' ? 'Book ahead' : 'Hardware reservation'}</Text>
    {fee !== null && fee !== undefined ? <Text style={ui.body}>{slot.paymentStatus === 'mock_refunded' ? 'Mock refund: ' + money(fee) : fee === 0 ? 'Free reservation' : 'Mock reservation fee: ' + money(fee)} · no real payment</Text> : null}
    {slot.protectionStartsAt ? <Text style={ui.small}>Protection requested no earlier than {formatHardwareInstant(slot.protectionStartsAt)}. The backend still needs fresh safe observations and movement confirmation.</Text> : null}
    {slot.requestedBayId && slot.requestedBayId !== slot.bayId ? <View style={ui.notice}><Text style={ui.label}>A different bay was assigned</Text><Text style={ui.small}>The requested bay was unavailable. This reservation uses another compatible physical bay at the same location; check its assigned label before arrival.</Text></View> : null}
    {slot.failureReason === 'LOCATION_FULL' || slot.fallbackReason === 'LOCATION_FULL' ? <View style={ui.notice}><Text style={ui.label}>This location is full</Text><Text style={ui.small}>{slot.paymentStatus === 'mock_refunded' ? 'The mock fee was refunded. ' : ''}No compatible bay could be protected. Check the registered alternatives below.</Text></View> : null}
    {canExtend ? <><ActionButton label={'Add ' + (policy?.extensionMinutes ?? 10) + ' minutes · ' + money(policy?.extensionFeeCents ?? 100) + ' mock'} onPress={() => { if (slot.id) void extend(slot.id); }} disabled={!fresh || busy || !extensionAllowed} variant="secondary" /><Text style={ui.small}>The server checks the next booking and device state before extending. Your current deadline stays unchanged if the extension is refused.</Text></> : null}
  </View>;
}

export function HardwareAlternatives({ alternatives }: { alternatives: HardwareAlternative[] | undefined }) {
  if (!alternatives?.length) return null;
  return <View style={styles.details}><Text style={ui.sectionTitle}>Nearby registered alternatives</Text><Text style={ui.small}>Compatible registered inventory from the latest backend check. Public map listings do not establish physical vacancy.</Text>{alternatives.slice(0, 3).map(location => <View key={location.locationId} style={styles.alternative}>
    <Text style={ui.label}>{location.label}</Text>
    <Text style={ui.small}>{location.availableBays} compatible {location.availableBays === 1 ? 'bay' : 'bays'} at the last check{location.distanceKm !== null ? ' · ' + location.distanceKm.toFixed(1) + ' km away' : ''}</Text>
    <Text style={ui.small}>{location.connectorTypes.map(type => type === 'Typ2' ? 'Type 2' : type).join(' · ')}</Text>
    {location.latitude !== null && location.longitude !== null ? <ActionButton label="View location in Maps" variant="secondary" onPress={() => void Linking.openURL('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location.latitude + ',' + location.longitude))} /> : null}
  </View>)}</View>;
}

const styles = StyleSheet.create({
  details: { gap: 10 }, alternative: { gap: 8, padding: 13, borderWidth: 1, borderColor: palette.line, borderRadius: 12 },
});

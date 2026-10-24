import DateTimePicker from '@/components/date-time-picker';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import type { DriverProfile } from '@/lib/driver-profile';
import type { AudimaxActiveHold, AudimaxLock } from '@/lib/audimax-lock-api';
import { berlinTimeChoices, berlinTimeFields, formatHardwareInstant, validateHardwareWindow } from '@/lib/hardware-time';

const pad = (value: number) => String(value).padStart(2, '0');

export interface AudimaxBookingModalProps {
  visible: boolean;
  lock?: AudimaxLock;
  allLocks: AudimaxLock[];
  team?: string;
  profile: DriverProfile | null;
  activeHold: AudimaxActiveHold | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSelectLock: (lockId: string) => void;
  onReserve: (choice: { bookingMode: 'now' | 'scheduled'; startsAt?: string; plate: string }) => Promise<void>;
  onExtend?: () => Promise<void>;
  onLeave: () => Promise<void>;
  onClose: () => void;
  onProfile: () => void;
}

export function AudimaxBookingModal({
  visible,
  lock,
  allLocks,
  team,
  profile,
  activeHold,
  busy,
  error,
  notice,
  onSelectLock,
  onReserve,
  onExtend,
  onLeave,
  onClose,
  onProfile,
}: AudimaxBookingModalProps) {
  const now = Date.now();
  const [mode, setMode] = useState<'now' | 'scheduled'>('now');
  const [fields, setFields] = useState(() => berlinTimeFields(now + 30 * 60_000));
  const [offset, setOffset] = useState<string | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);

  const choices = berlinTimeChoices(fields.date, fields.time);
  const startsAt = choices.length === 1 ? choices[0].iso : choices.find(choice => choice.offset === offset)?.iso ?? null;
  const windowError =
    mode === 'now'
      ? null
      : startsAt
      ? validateHardwareWindow(startsAt, new Date(Date.parse(startsAt) + 10 * 60_000).toISOString(), now)
      : 'Choose a valid Berlin time and its offset if the time occurs twice.';

  const isUserHold = !!activeHold && activeHold.lockId === lock?.id;
  const userPlate = profile?.licensePlate?.trim() || 'MBD14E';

  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!activeHold?.expiresAt) return 0;
    return Math.max(0, Math.ceil((Date.parse(activeHold.expiresAt) - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!activeHold?.expiresAt) return;
    const updateCountdown = () => {
      const left = Math.max(0, Math.ceil((Date.parse(activeHold.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [activeHold?.expiresAt]);

  const [year, month, day] = fields.date.split('-').map(Number);
  const [hour, minute] = fields.time.split(':').map(Number);
  const value = picker === 'time' ? new Date(2000, 0, 15, hour, minute) : new Date(year, month - 1, day, 12);
  const bound = (instant: number) => {
    const parts = berlinTimeFields(instant).date.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12);
  };

  const handleAction = async () => {
    if (isUserHold) {
      await onLeave();
    } else {
      await onReserve({
        bookingMode: mode,
        startsAt: mode === 'scheduled' && startsAt ? startsAt : undefined,
        plate: userPlate,
      });
    }
  };

  const actionLabel = busy
    ? isUserHold
      ? activeHold.status === 'scheduled'
        ? 'Cancelling scheduled booking…'
        : 'Lowering barrier & clearing whitelist…'
      : mode === 'now'
      ? 'Raising barrier & whitelisting plate…'
      : 'Scheduling booking…'
    : isUserHold
    ? activeHold.status === 'scheduled'
      ? 'Cancel Scheduled Booking'
      : activeHold.status === 'occupied'
      ? 'Leave Bay · Lower Barrier & Clear Whitelist'
      : `Leave Bay (${secondsLeft > 0 ? `${secondsLeft}s left · ` : ''}Unlock & Clear)`
    : mode === 'now'
    ? `Reserve free · 30 seconds (${lock?.name || lock?.id || 'Lock 0002'})`
    : `Book ahead · Raises 30s before arrival (${lock?.name || lock?.id || 'Lock 0002'})`;

  const actionDisabled = busy || (!isUserHold && mode === 'scheduled' && (!!windowError || !startsAt));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal}>
        {/* Header - matching DirectoryBookingModal */}
        <View style={styles.modalHeader}>
          <View style={ui.flex}>
            <Text style={ui.eyebrow}>
              {team ? `ECURIOUS · ${team.toUpperCase()}` : 'ECURIOUS LIVE HARDWARE'}
            </Text>
            <Text style={styles.modalTitle}>Audimax Munich (TUM)</Text>
            <Text style={ui.small}>
              {lock?.name || lock?.id || 'Lock 0002'} · Arcisstraße 21, 80333 München
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close reservation" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <ScrollView style={ui.flex} contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
          {/* Lock / Bay selection */}
          {allLocks.length > 1 ? (
            <View style={styles.baySelector}>
              <Text style={ui.label}>Select Hardware Bay</Text>
              <View style={styles.row}>
                {allLocks.map(l => {
                  const isSelected = l.id === lock?.id;
                  const isHold = activeHold?.lockId === l.id;
                  return (
                    <Pressable
                      key={l.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      disabled={busy}
                      onPress={() => onSelectLock(l.id)}
                      style={[
                        styles.chip,
                        isSelected && styles.selected,
                        isHold && { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
                      ]}>
                      <Text style={[styles.chipText, isSelected && { fontWeight: '800' }]}>
                        {l.name || l.id}
                        {l.id === 'lock-0002' ? ' ★' : ''}
                        {isHold ? ' (Yours)' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Error & Notices */}
          {error ? (
            <View style={[ui.notice, ui.errorNotice]}>
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={[ui.notice, { backgroundColor: '#F0F6DC', borderColor: '#8DA93C' }]}>
              <Text style={[styles.chipText, { color: palette.ink }]}>{notice}</Text>
            </View>
          ) : null}

          {/* If user currently holds this lock */}
          {isUserHold ? (
            activeHold.status === 'scheduled' ? (
              <View style={styles.review}>
                <Text style={[styles.title, { fontSize: 16, color: '#1565C0' }]}>
                  ⏰ Scheduled Booking Confirmed
                </Text>
                <Text style={ui.small}>Bay: {activeHold.lockName} ({activeHold.lockId})</Text>
                <Text style={ui.small}>Whitelisted Plate: {activeHold.plate}</Text>
                {activeHold.startsAt ? (
                  <Text style={[ui.small, { fontWeight: '700' }]}>
                    Arrival Time: {formatHardwareInstant(activeHold.startsAt)}
                  </Text>
                ) : null}
                <Text style={ui.small}>
                  Barrier raises at: {new Date(activeHold.raiseAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (30s before arrival)
                </Text>
                <Text style={ui.small}>
                  No-show rule: waits 30s after reservation until {new Date(activeHold.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} before unlocking if car does not show up.
                </Text>
                <Text style={[ui.small, { marginTop: 4, color: palette.muted }]}>
                  The barrier is currently lowered. It will automatically raise and register your plate exactly 30 seconds before your booked arrival time.
                </Text>
              </View>
            ) : activeHold.status === 'occupied' ? (
              <View style={styles.review}>
                <Text style={[styles.title, { fontSize: 16, color: '#2E7D32' }]}>
                  🚗 Vehicle Detected in Bay · Occupied
                </Text>
                <Text style={ui.small}>Bay: {activeHold.lockName} ({activeHold.lockId})</Text>
                <Text style={ui.small}>Whitelisted Plate: {activeHold.plate}</Text>
                <Text style={ui.small}>Status: Parked & Charging</Text>
                <Text style={[ui.small, { marginTop: 4, color: palette.muted }]}>
                  Your vehicle arrived and is parked in the bay. The barrier protects the bay. Tap below when departing to unlock and clear the whitelist.
                </Text>
              </View>
            ) : (
              <View style={styles.review}>
                <Text style={[styles.title, { fontSize: 16, color: secondsLeft > 0 ? '#A77A24' : '#C62828' }]}>
                  {secondsLeft > 0 ? `✓ Barrier Raised · Waiting for Car (${secondsLeft}s left)` : '⚠ 30-Second No-Show Window Expired'}
                </Text>
                <Text style={ui.small}>Bay: {activeHold.lockName} ({activeHold.lockId})</Text>
                <Text style={ui.small}>Whitelisted Plate: {activeHold.plate}</Text>
                <Text style={ui.small}>Barrier raised at: {new Date(activeHold.raiseAt).toLocaleTimeString()}</Text>
                <Text style={ui.small}>Auto-unlocks at: {new Date(activeHold.expiresAt).toLocaleTimeString()} if car is not showing up</Text>
                <Text style={[ui.small, { marginTop: 4, color: palette.muted }]}>
                  {secondsLeft > 0
                    ? `Waiting 30 seconds for your car to arrive. If the vehicle is not showing up within ${secondsLeft}s, the barrier will automatically unlock.`
                    : 'The 30-second arrival window has elapsed without vehicle detection. Barrier is unlocking…'}
                </Text>
                {secondsLeft > 0 && onExtend ? (
                  <View style={{ marginTop: 8, gap: 4 }}>
                    <ActionButton
                      label="+ Add 30 seconds · €1 fee"
                      variant="primary"
                      disabled={busy}
                      onPress={onExtend}
                    />
                    <Text style={[ui.small, { textAlign: 'center', color: palette.muted, fontSize: 11 }]}>
                      Haven't arrived yet? Add 30 more seconds to prevent no-show barrier unlock (€1 mock fee).
                    </Text>
                  </View>
                ) : null}
              </View>
            )
          ) : (
            /* Modes - Now / Schedule (exact same design as DirectoryBookingModal) */
            <View style={styles.form}>
              <View style={styles.modes}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mode === 'now' }}
                  disabled={busy}
                  onPress={() => setMode('now')}
                  style={[styles.mode, mode === 'now' && styles.selected]}>
                  <Text style={styles.title}>Now</Text>
                  <Text style={ui.label}>Free</Text>
                  <Text style={ui.small}>30-second hold</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mode === 'scheduled' }}
                  disabled={busy}
                  onPress={() => setMode('scheduled')}
                  style={[styles.mode, mode === 'scheduled' && styles.selected]}>
                  <Text style={styles.title}>Schedule</Text>
                  <Text style={ui.label}>€1</Text>
                  <Text style={ui.small}>Choose arrival</Text>
                </Pressable>
              </View>

              {mode === 'scheduled' ? (
                <>
                  <Text style={ui.label}>Arrival · Berlin time</Text>
                  <View style={styles.row}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open arrival calendar"
                      disabled={busy}
                      onPress={() => setPicker('date')}
                      style={styles.pickerButton}>
                      <Text style={ui.small}>Calendar</Text>
                      <Text style={ui.label}>{fields.date}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open arrival time picker"
                      disabled={busy}
                      onPress={() => setPicker('time')}
                      style={styles.pickerButton}>
                      <Text style={ui.small}>Time</Text>
                      <Text style={ui.label}>{fields.time}</Text>
                    </Pressable>
                  </View>

                  {picker ? (
                    <View>
                      <DateTimePicker
                        value={value}
                        mode={picker}
                        presentation="dialog"
                        display={picker === 'date' ? 'calendar' : 'clock'}
                        is24Hour
                        minimumDate={picker === 'date' ? bound(now) : undefined}
                        maximumDate={picker === 'date' ? bound(now + 7 * 86_400_000) : undefined}
                        onDismiss={() => setPicker(null)}
                        onValueChange={(_event, date) => {
                          if (picker === 'date')
                            setFields(prev => ({
                              ...prev,
                              date: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()),
                            }));
                          else
                            setFields(prev => ({
                              ...prev,
                              time: pad(date.getHours()) + ':' + pad(date.getMinutes()),
                            }));
                          setOffset(null);
                          setPicker(null);
                        }}
                      />
                      {Platform.OS === 'ios' ? (
                        <ActionButton label="Done" onPress={() => setPicker(null)} variant="secondary" />
                      ) : null}
                    </View>
                  ) : null}

                  {choices.length === 2 ? (
                    <>
                      <Text style={ui.small}>This Berlin time occurs twice. Choose its offset:</Text>
                      <View style={styles.row}>
                        {choices.map(choice => (
                          <Pressable
                            key={choice.offset}
                            accessibilityRole="button"
                            accessibilityState={{ selected: offset === choice.offset }}
                            onPress={() => setOffset(choice.offset)}
                            style={[styles.chip, offset === choice.offset && styles.selected]}>
                            <Text style={ui.label}>{choice.offset}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}

                  <View style={styles.row}>
                    {[15, 30, 60].map(minutes => (
                      <Pressable
                        key={minutes}
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => {
                          setFields(berlinTimeFields(now + minutes * 60_000));
                          setOffset(null);
                        }}
                        style={styles.chip}>
                        <Text style={styles.chipText}>In {minutes} min</Text>
                      </Pressable>
                    ))}
                  </View>

                  {startsAt ? (
                    <View style={styles.review}>
                      <Text style={[ui.small, { fontWeight: '700', color: '#1565C0' }]}>
                        Barrier raises at {new Date(Date.parse(startsAt) - 30 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} (30s before arrival)
                      </Text>
                      <Text style={ui.small}>
                        Arrival time: {formatHardwareInstant(startsAt)}
                      </Text>
                      <Text style={ui.small}>
                        Hold duration: 30 seconds
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              {windowError ? <Text style={styles.error}>{windowError}</Text> : null}
            </View>
          )}

          {/* Hardware Live Telemetry Card */}
          {lock ? (
            <View style={styles.review}>
              <Text style={ui.label}>Live Telemetry · {lock.name || lock.id}</Text>
              <Text style={ui.small}>
                Barrier Position: <Text style={{ fontWeight: '700' }}>{lock.status}</Text>
                {' · '}Presence: <Text style={{ fontWeight: '700' }}>{lock.carPresence}</Text>
              </Text>
              <Text style={ui.small}>
                {lock.battery12V !== undefined ? `12V: ${lock.battery12V}V` : ''}
                {lock.signalStrength4G !== undefined ? ` · 4G Signal: ${lock.signalStrength4G}` : ''}
                {lock.hasCamera ? ' · 📷 Optical Plate Scanner' : ''}
                {lock.waterIngress ? ' · ⚠ Water Alert' : ''}
              </Text>
            </View>
          ) : null}

          {/* License Plate info */}
          <View style={styles.review}>
            <Text style={ui.label}>Optical Auto-Unlock Whitelist</Text>
            <Text style={ui.small}>
              Vehicle License Plate: <Text style={{ fontWeight: '800' }}>{userPlate}</Text>
            </Text>
            {!profile?.licensePlate?.trim() ? (
              <Pressable accessibilityRole="button" onPress={onProfile} style={{ marginTop: 4 }}>
                <Text style={styles.changePlugText}>Edit plate in Driver Profile ›</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>

        {/* Modal Footer - identical to DirectoryBookingModal */}
        <View style={styles.modalFooter}>
          <ActionButton
            label={actionLabel}
            onPress={() => void handleAction()}
            disabled={actionDisabled}
            variant={isUserHold ? 'secondary' : 'primary'}
          />
          <Text style={styles.footerCopy}>
            Live hardware interlock · Barrier control · Optical plate recognition
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  modes: { flexDirection: 'row', gap: 9 },
  row: { flexDirection: 'row', gap: 8 },
  mode: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    backgroundColor: palette.paper,
  },
  title: { color: palette.ink, fontSize: 18, fontWeight: '800' },
  selected: { borderColor: '#8DA93C', backgroundColor: '#F0F6DC' },
  pickerButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 11,
    padding: 12,
    gap: 8,
    minHeight: 72,
  },
  chip: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 11,
    paddingHorizontal: 8,
  },
  chipText: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  review: { backgroundColor: palette.soft, borderRadius: 12, padding: 12, gap: 6 },
  error: { color: palette.errorInk, fontSize: 13, lineHeight: 20 },
  disabled: { opacity: 0.45 },
  modal: { flex: 1, backgroundColor: palette.paper },
  modalHeader: {
    padding: 20,
    flexDirection: 'row',
    gap: 12,
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  modalTitle: { color: palette.ink, fontSize: 22, fontWeight: '800', marginVertical: 6 },
  modalContent: { padding: 20, gap: 14 },
  modalFooter: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 10,
    borderTopWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.paper,
  },
  footerCopy: { color: palette.muted, fontSize: 10, textAlign: 'center' },
  close: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: palette.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: palette.ink, fontSize: 27 },
  baySelector: { gap: 8 },
  changePlugText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

import type { DateTimePickerProps } from '@expo/ui/community/datetime-picker';
import { createElement, useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/bayready';

export type { DateTimePickerProps };

const pad = (value: number) => String(value).padStart(2, '0');
const dateFields = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const timeFields = (value: Date) => `${pad(value.getHours())}:${pad(value.getMinutes())}`;

function inputValue(value: Date, mode: DateTimePickerProps['mode']) {
  return mode === 'time' ? timeFields(value) : mode === 'datetime' ? `${dateFields(value)}T${timeFields(value)}` : dateFields(value);
}

// Preserve wall-clock fields: the booking forms resolve these explicitly into
// Berlin time, including the two offsets during the autumn clock change.
function selectedDate(input: string, value: Date, mode: DateTimePickerProps['mode']) {
  const result = new Date(value.getTime());
  const [date, time] = mode === 'time' ? ['', input] : input.split('T');
  if (mode !== 'time') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const [year, month, day] = date.split('-').map(Number);
    result.setFullYear(year, month - 1, day);
    if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) return null;
  }
  if (mode === 'time' || mode === 'datetime') {
    if (!/^\d{2}:\d{2}$/.test(time ?? '')) return null;
    const [hour, minute] = time.split(':').map(Number);
    if (hour > 23 || minute > 59) return null;
    result.setHours(hour, minute, 0, 0);
  }
  return Number.isNaN(result.getTime()) ? null : result;
}

export default function DateTimePicker({ value, mode = 'date', minimumDate, maximumDate, onValueChange, onChange, onDismiss, disabled, accentColor = palette.ink, style, testID, positiveButton, negativeButton }: DateTimePickerProps) {
  const current = inputValue(value, mode);
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current, mode]);
  const minimum = minimumDate ? inputValue(minimumDate, mode) : undefined;
  const maximum = maximumDate ? inputValue(maximumDate, mode) : undefined;
  const selected = selectedDate(draft, value, mode);
  const valid = !!selected && (!minimum || draft >= minimum) && (!maximum || draft <= maximum);
  const confirm = () => {
    if (!selected || !valid || disabled) return;
    const event = { nativeEvent: { timestamp: selected.getTime(), utcOffset: -selected.getTimezoneOffset() } };
    if (onValueChange) onValueChange(event, selected);
    else onChange?.({ ...event, type: 'set' }, selected);
  };
  const dismiss = () => {
    if (onDismiss) onDismiss();
    else onChange?.({ type: 'dismissed', nativeEvent: { timestamp: value.getTime(), utcOffset: -value.getTimezoneOffset() } });
  };

  return <View style={[styles.container, style]} testID={testID}>
    {createElement('input', {
      type: mode === 'datetime' ? 'datetime-local' : mode,
      value: draft,
      min: minimum,
      max: maximum,
      step: mode === 'date' ? undefined : 60,
      disabled,
      'aria-label': mode === 'date' ? 'Arrival date' : mode === 'time' ? 'Arrival time' : 'Arrival date and time',
      onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.currentTarget.value),
      style: { ...inputStyle, accentColor },
    })}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={dismiss} style={styles.cancel}><Text style={styles.label}>{negativeButton?.label ?? 'Cancel'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled || !valid} onPress={confirm} style={[styles.confirm, { backgroundColor: accentColor }, (disabled || !valid) && styles.disabled]}><Text style={styles.confirmLabel}>{positiveButton?.label ?? 'Done'}</Text></Pressable>
    </View>
  </View>;
}

const inputStyle: CSSProperties = {
  boxSizing: 'border-box', width: '100%', minHeight: 48, border: `1px solid ${palette.line}`,
  borderRadius: 10, padding: '10px 12px', color: palette.ink, background: palette.paper,
  fontFamily: 'inherit', fontSize: 16, colorScheme: 'light',
};

const styles = StyleSheet.create({
  container: { gap: 10, padding: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 12, backgroundColor: palette.soft },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancel: { minHeight: 42, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  confirm: { minHeight: 42, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { color: palette.ink, fontWeight: '700' }, confirmLabel: { color: '#FFFFFF', fontWeight: '700' }, disabled: { opacity: 0.4 },
});

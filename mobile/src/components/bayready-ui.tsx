import { Link, usePathname } from 'expo-router';
import { type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/bayready';
import { useBayReady } from '@/components/reservation-provider';

export function AppFrame({ children, mode = 'simulator' }: PropsWithChildren<{ mode?: 'simulator' | 'directory' }>) {
  const pathname = usePathname();
  return (
    <SafeAreaView style={ui.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={ui.header}>
        <View style={ui.brandRow}>
          <View style={ui.brandMark}><Text style={ui.brandMarkText}>ϟ</Text></View>
          <Text style={ui.brand}>BayReady</Text>
        </View>
        <View style={ui.mode}><View style={ui.modeDot} /><Text style={ui.modeText}>{mode === 'directory' ? 'DIRECTORY' : 'SIMULATOR'}</Text></View>
      </View>
      <View style={ui.flex}>{children}</View>
      <View style={ui.navigation}>
        {([{ href: '/', label: 'Map', mark: '01' }, { href: '/reserve', label: 'Simulator', mark: '02' }, { href: '/activity', label: 'Activity', mark: '03' }] as const).map((tab) => {
          const selected = pathname === tab.href;
          return (
            <Link href={tab.href} asChild replace key={tab.href}>
              <Pressable
                accessibilityRole="tab"
                accessibilityLabel={`${tab.label} tab`}
                accessibilityState={{ selected }}
                style={({ pressed }) => [ui.navItem, selected && ui.navSelected, pressed && ui.pressed]}>
                <Text style={[ui.navMark, selected && ui.navSelectedText]}>{tab.mark}</Text>
                <Text style={[ui.navLabel, selected && ui.navSelectedText]}>{tab.label}</Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export function AppScreen({ children }: PropsWithChildren) {
  const { refreshing, refresh } = useBayReady();
  return (
    <AppFrame>
      <KeyboardAvoidingView style={ui.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={ui.flex}
          contentContainerStyle={ui.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.ink} colors={[palette.ink]} />}>
          <View style={ui.content}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppFrame>
  );
}

export function ConnectionNotice() {
  const { state, loading, error, refresh, refreshing } = useBayReady();
  if (!loading && !error && state) return null;
  return (
    <View style={[ui.notice, !!error && ui.errorNotice]} accessibilityLiveRegion="polite">
      {loading && !error ? <ActivityIndicator color={palette.ink} /> : null}
      <Text style={ui.noticeTitle}>{error ? 'Simulator connection needs attention' : 'Connecting to your simulator…'}</Text>
      {error ? (
        <>
          <Text style={ui.body}>{error}</Text>
          <Text style={ui.body}>Keep the laptop server running and connect your phone to the same Wi-Fi. Connection details are in Activity.</Text>
          <ActionButton label={refreshing ? 'Retrying…' : 'Retry connection'} onPress={() => void refresh()} disabled={refreshing} variant="secondary" />
        </>
      ) : null}
      {state && error ? <Text style={ui.small}>The state below is the last received snapshot. Actions are paused until it refreshes.</Text> : null}
    </View>
  );
}

export function ActionButton({ label, onPress, disabled = false, loading = false, variant = 'primary', style }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'dark';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [ui.button, variant === 'secondary' && ui.secondaryButton, variant === 'dark' && ui.darkButton, (disabled || loading) && ui.disabled, pressed && ui.pressed, style]}>
      {loading ? <ActivityIndicator color={variant === 'dark' ? palette.paper : palette.ink} /> : null}
      <Text style={[ui.buttonText, variant === 'dark' && ui.darkButtonText]}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeading({ eyebrow, title, trailing }: { eyebrow?: string; title: string; trailing?: ReactNode }) {
  return <View style={ui.sectionHeading}><View style={ui.flex}>{eyebrow ? <Text style={ui.eyebrow}>{eyebrow}</Text> : null}<Text accessibilityRole="header" style={ui.sectionTitle}>{title}</Text></View>{trailing}</View>;
}

export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.cream },
  flex: { flex: 1 },
  header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: { width: 31, height: 34, borderRadius: 10, backgroundColor: palette.lime, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { fontSize: 29, fontWeight: '800', color: palette.ink, lineHeight: 32 },
  brand: { fontSize: 23, fontWeight: '800', letterSpacing: -0.8, color: palette.ink },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 8, borderWidth: 1, borderColor: palette.line, borderRadius: 20 },
  modeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#6D8730' },
  modeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: palette.ink },
  scroll: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 28, alignItems: 'center' },
  content: { width: '100%', maxWidth: 620, gap: 24 },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderColor: palette.line, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6, backgroundColor: palette.cream },
  navItem: { flex: 1, minHeight: 52, borderRadius: 15, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center' },
  navSelected: { backgroundColor: palette.ink },
  navMark: { fontSize: 12, fontWeight: '600', color: palette.muted },
  navLabel: { fontSize: 15, fontWeight: '700', color: palette.muted },
  navSelectedText: { color: palette.lime },
  pressed: { opacity: 0.72 },
  button: { minHeight: 50, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: palette.lime, borderWidth: 1, borderColor: 'transparent', borderRadius: 14, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 },
  secondaryButton: { backgroundColor: palette.paper, borderColor: palette.line },
  darkButton: { backgroundColor: palette.ink },
  buttonText: { color: palette.ink, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  darkButtonText: { color: palette.paper },
  disabled: { opacity: 0.4 },
  notice: { padding: 18, borderRadius: 18, backgroundColor: palette.soft, gap: 10 },
  errorNotice: { backgroundColor: palette.error },
  noticeTitle: { fontSize: 16, fontWeight: '700', color: palette.ink },
  body: { fontSize: 15, lineHeight: 22, color: palette.muted },
  small: { fontSize: 14, lineHeight: 21, color: palette.muted },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1, color: palette.muted, marginBottom: 5 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  sectionTitle: { fontSize: 23, fontWeight: '800', letterSpacing: -0.6, color: palette.ink },
  card: { backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, borderRadius: 22, padding: 20, gap: 14 },
  label: { fontSize: 14, color: palette.ink, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rule: { height: 1, backgroundColor: palette.line },
});

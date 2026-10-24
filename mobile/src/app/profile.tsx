import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { useProfile } from '@/components/profile-provider';
import { palette } from '@/constants/bayready';
import {
  CONNECTOR_OPTIONS, PAYMENT_OPTIONS, validateProfileInput,
  type ProfileFieldErrors, type ProfileInput,
} from '@/lib/driver-profile';

const EMPTY_PROFILE: ProfileInput = {
  name: '', email: '', phone: '', licensePlate: '', connectorType: 'CCS', paymentMethod: 'mock-card',
};

function ProfileField({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#777D68"
        selectionColor={palette.ink}
        style={[styles.input, !!error && styles.inputError]}
        {...props}
      />
      {error ? <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, loading, error, setupSeen, saveProfile, skipSetup, reload } = useProfile();
  const [draft, setDraft] = useState<ProfileInput>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<ProfileFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);
  const edited = useRef(false);
  const editing = profile !== null;
  const disabled = loading || saving;

  function returnToMap() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  useEffect(() => {
    if (loading || error || initialized.current) return;
    initialized.current = true;
    if (profile && !edited.current) {
      const { name, email, phone, licensePlate, connectorType, paymentMethod } = profile;
      setDraft({ name, email, phone, licensePlate, connectorType, paymentMethod });
    }
  }, [loading, error, profile]);

  function update<K extends keyof ProfileInput>(field: K, value: ProfileInput[K]) {
    edited.current = true;
    setDraft(previous => ({ ...previous, [field]: value }));
    setErrors(previous => ({ ...previous, [field]: undefined }));
  }

  async function save() {
    if (disabled) return;
    const validation = validateProfileInput(draft);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (await saveProfile(validation.value)) returnToMap();
    } finally {
      setSaving(false);
    }
  }

  async function explore() {
    if (disabled) return;
    setSaving(true);
    try {
      if (await skipSetup()) returnToMap();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.brandRow}><View style={styles.brandMark}><Text style={styles.brandSymbol}>ϟ</Text></View><Text style={styles.brand}>BayReady</Text></View>
              {setupSeen ? <Pressable accessibilityRole="button" accessibilityLabel="Back to map" onPress={returnToMap} disabled={saving} style={({ pressed }) => [styles.backButton, pressed && ui.pressed]}><Text style={styles.backText}>Map ↗</Text></Pressable> : <Text style={styles.setupBadge}>QUICK SETUP</Text>}
            </View>

            <View style={styles.intro}>
              <Text style={ui.eyebrow}>{editing ? 'YOUR DRIVER PROFILE' : 'READY FOR YOUR NEXT STOP'}</Text>
              <Text accessibilityRole="header" style={styles.heading}>{editing ? 'Your car.\nYour preferences.' : 'Set up once.\nFind your space.'}</Text>
              <Text style={styles.introText}>Save your details on this phone so your connector and reservation summary are ready next time.</Text>
            </View>

            {loading ? <View style={styles.notice}><ActivityIndicator color={palette.ink} /><Text style={styles.noticeText}>Loading your saved profile…</Text></View> : null}
            {error ? <View style={styles.errorNotice} accessibilityLiveRegion="polite"><Text style={styles.noticeTitle}>Profile storage needs attention</Text><Text style={styles.noticeText}>{error}</Text><ActionButton label="Retry profile storage" variant="secondary" disabled={disabled} onPress={() => void reload()} /></View> : null}

            <View style={styles.card}>
              <View style={styles.sectionTitleRow}><Text style={styles.step}>01</Text><View><Text style={styles.sectionTitle}>Your contact details</Text><Text style={styles.sectionCopy}>For your saved profile.</Text></View></View>
              <ProfileField label="Name" value={draft.name} onChangeText={value => update('name', value)} placeholder="Your name" autoComplete="name" textContentType="name" autoCapitalize="words" maxLength={100} editable={!disabled} error={errors.name} />
              <ProfileField label="Email" value={draft.email} onChangeText={value => update('email', value)} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" autoCapitalize="none" autoCorrect={false} maxLength={254} editable={!disabled} error={errors.email} />
              <ProfileField label="Phone with country code" value={draft.phone} onChangeText={value => update('phone', value)} placeholder="+49 151 23456789" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={30} editable={!disabled} error={errors.phone} />
            </View>

            <View style={styles.card}>
              <View style={styles.sectionTitleRow}><Text style={styles.step}>02</Text><View><Text style={styles.sectionTitle}>Your car</Text><Text style={styles.sectionCopy}>Your connector filters the map.</Text></View></View>
              <ProfileField label="License plate" value={draft.licensePlate} onChangeText={value => update('licensePlate', value)} placeholder="Your vehicle’s plate" autoCapitalize="characters" autoCorrect={false} maxLength={20} editable={!disabled} error={errors.licensePlate} />
              <Text style={styles.label}>Connector type</Text>
              <View style={styles.choices}>
                {CONNECTOR_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: draft.connectorType === option.value, disabled }} onPress={() => update('connectorType', option.value)} disabled={disabled} style={({ pressed }) => [styles.choice, draft.connectorType === option.value && styles.choiceSelected, pressed && ui.pressed]}><Text style={[styles.choiceText, draft.connectorType === option.value && styles.choiceTextSelected]}>{option.label}</Text></Pressable>)}
              </View>
              {errors.connectorType ? <Text style={styles.fieldError}>{errors.connectorType}</Text> : null}
              <Text style={styles.help}>Minimum charging power stays adjustable in the map filters.</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.sectionTitleRow}><Text style={styles.step}>03</Text><View><Text style={styles.sectionTitle}>Demo payment method</Text><Text style={styles.sectionCopy}>A preference for this prototype.</Text></View></View>
              <View style={styles.paymentChoices}>
                {PAYMENT_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: draft.paymentMethod === option.value, disabled }} onPress={() => update('paymentMethod', option.value)} disabled={disabled} style={({ pressed }) => [styles.paymentChoice, draft.paymentMethod === option.value && styles.paymentSelected, pressed && ui.pressed]}><View style={[styles.radio, draft.paymentMethod === option.value && styles.radioSelected]}>{draft.paymentMethod === option.value ? <View style={styles.radioDot} /> : null}</View><Text style={styles.paymentLabel}>{option.label}</Text><Text style={styles.demoTag}>DEMO</Text></Pressable>)}
              </View>
              {errors.paymentMethod ? <Text style={styles.fieldError}>{errors.paymentMethod}</Text> : null}
              <Text style={styles.help}>No real card details are collected and no payment is taken.</Text>
            </View>

            <View style={styles.privacy}><Text style={styles.privacyTitle}>Saved on this device</Text><Text style={styles.help}>Your profile stays in this phone’s secure storage. Only a hardware time-slot booking sends its vehicle plate to the backend for camera matching; the backend stores a keyed fingerprint rather than the raw plate. Contact details and mock payment preferences stay local. If you choose email sign-in, that account email goes to Supabase Auth. The charging directory receives no profile details. This local profile is separate from your booking sign-in.</Text></View>
            <Link href="/sign-in" asChild><Pressable accessibilityRole="button" style={[ui.button, ui.secondaryButton]}><Text style={ui.buttonText}>Sign in & account</Text></Pressable></Link>
            {Object.keys(errors).some(key => errors[key as keyof ProfileFieldErrors]) ? <Text accessibilityLiveRegion="polite" style={styles.fieldError}>Check the highlighted fields, then save again.</Text> : null}
            <ActionButton label={saving ? 'Saving…' : editing ? 'Save changes' : 'Save & continue'} onPress={() => void save()} disabled={disabled} loading={saving} variant="dark" />
            {!editing ? <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void explore()} style={({ pressed }) => [styles.skipButton, pressed && ui.pressed, disabled && styles.disabled]}><Text style={styles.skipText}>Explore map first</Text><Text style={styles.skipCopy}>You can add your profile before reserving.</Text></Pressable> : null}
            <Text style={styles.footer}>{Platform.OS === 'web' ? 'Browser preview keeps this profile in memory for this page session.' : 'Your profile stays on this device. You can edit it from the map.'}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.cream },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28, alignItems: 'center' },
  content: { width: '100%', maxWidth: 620, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: { width: 31, height: 34, borderRadius: 10, backgroundColor: palette.lime, alignItems: 'center', justifyContent: 'center' },
  brandSymbol: { fontSize: 29, fontWeight: '800', color: palette.ink, lineHeight: 32 },
  brand: { fontSize: 23, fontWeight: '800', letterSpacing: -0.8, color: palette.ink },
  setupBadge: { fontSize: 10, letterSpacing: 1, fontWeight: '800', color: palette.muted },
  backButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: palette.line },
  backText: { fontSize: 14, fontWeight: '700', color: palette.ink },
  intro: { gap: 10, paddingVertical: 8 },
  heading: { fontSize: 35, lineHeight: 40, fontWeight: '800', letterSpacing: -1.2, color: palette.ink },
  introText: { color: palette.muted, fontSize: 16, lineHeight: 24 },
  card: { padding: 18, backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.line, borderRadius: 22, gap: 15 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 3 },
  step: { backgroundColor: palette.soft, color: '#667D2B', borderRadius: 12, padding: 10, fontSize: 15, fontWeight: '800', overflow: 'hidden' },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: palette.ink, letterSpacing: -0.3 },
  sectionCopy: { fontSize: 13, color: palette.muted, marginTop: 4 },
  field: { gap: 7 },
  label: { fontSize: 14, fontWeight: '700', color: palette.ink },
  input: { minHeight: 52, backgroundColor: palette.cream, borderWidth: 1, borderColor: palette.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 12, fontSize: 16, color: palette.ink },
  inputError: { borderColor: '#B64532' },
  fieldError: { color: '#9A3625', fontSize: 13, lineHeight: 19 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 46, paddingHorizontal: 12, paddingVertical: 12, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.cream },
  choiceSelected: { backgroundColor: palette.ink, borderColor: palette.ink },
  choiceText: { fontSize: 13, fontWeight: '700', color: palette.ink },
  choiceTextSelected: { color: palette.lime },
  help: { color: palette.muted, fontSize: 13, lineHeight: 20 },
  paymentChoices: { gap: 9 },
  paymentChoice: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.cream },
  paymentSelected: { backgroundColor: palette.soft, borderColor: '#7A8E46' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: palette.muted, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: palette.ink },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.ink },
  paymentLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: palette.ink },
  demoTag: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  privacy: { paddingHorizontal: 3, gap: 6 },
  privacyTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  notice: { padding: 16, backgroundColor: palette.soft, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorNotice: { padding: 16, backgroundColor: palette.error, borderRadius: 16, gap: 10 },
  noticeTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  noticeText: { color: palette.muted, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  skipButton: { minHeight: 56, justifyContent: 'center', alignItems: 'center', gap: 5, paddingVertical: 8 },
  skipText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  skipCopy: { color: palette.muted, fontSize: 12 },
  disabled: { opacity: 0.45 },
  footer: { textAlign: 'center', color: palette.muted, fontSize: 12, lineHeight: 19, paddingHorizontal: 10 },
});

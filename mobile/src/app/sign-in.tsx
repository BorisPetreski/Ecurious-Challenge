import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';
import { BookingApiError } from '@/lib/bookings-api';
import { checkAccountEmailVerified, getBookingAccount, requestAccountEmail, setAccountPassword, signInToAccount, verifyAccountEmail, type BookingAccount } from '@/lib/account-api';

export default function SignInScreen() {
  const router = useRouter();
  const [account, setAccount] = useState<BookingAccount | null>(null);
  const [mode, setMode] = useState<'sign-in' | 'email' | 'verify' | 'password'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void getBookingAccount().then(setAccount).catch(() => setError('Account status could not be loaded. Check your connection.')); }, []);

  async function submit() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === 'sign-in') {
        await signInToAccount(email, password);
        setPassword(''); setAccount(await getBookingAccount());
        setNotice('Signed in. Your reservations use this account.');
      } else if (mode === 'email') {
        await requestAccountEmail(email); setMode('verify');
        setNotice('Open the verification link in your email, then return here and tap “I verified my email”. If your email includes a code, you can enter it below. Your existing booking identity is kept.');
      } else if (mode === 'verify') {
        await verifyAccountEmail(email, code); setCode(''); setMode('password'); setAccount(await getBookingAccount());
        setNotice('Email verified. Choose a password to sign in on another device.');
      } else {
        await setAccountPassword(password); setPassword(''); setAccount(await getBookingAccount());
        setNotice('Account ready. Your existing reservations stay with this account.');
      }
    } catch (cause) {
      setError(cause instanceof BookingApiError ? cause.message : 'The account request could not be completed. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function checkEmail() {
    if (busy) return;
    setBusy(true); setError(null);
    try { setAccount(await checkAccountEmailVerified()); setMode('password'); setNotice('Email verified. Choose a password to use this account on another device.'); }
    catch (cause) { setError(cause instanceof BookingApiError ? cause.message : 'Your email status could not be refreshed. Try again.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={ui.safe} edges={['top', 'bottom', 'left', 'right']}>
    <KeyboardAvoidingView style={ui.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={ui.eyebrow}>YOUR BAYREADY ACCOUNT</Text>
        <Text accessibilityRole="header" style={ui.sectionTitle}>{mode === 'verify' ? 'Verify your email' : mode === 'password' ? 'Choose a password' : 'Sign in & keep your bookings'}</Text>
        <Text style={ui.body}>{account && !account.guest ? `Signed in as ${account.email ?? 'your account'}.` : 'Browsing and reservations work with a guest session. Add an email to keep the same booking identity across devices.'}</Text>
        {mode === 'sign-in' ? <Text style={ui.small}>Signing in to an existing account switches booking ownership to that account. Finish any guest reservations first. To keep this device’s guest bookings, choose Create account from this guest session.</Text> : null}
        {mode !== 'password' ? <View style={styles.field}><Text style={styles.label}>Email address</Text><TextInput accessibilityLabel="Account email address" style={styles.input} placeholder="you@example.com" placeholderTextColor={palette.muted} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" maxLength={254} editable={!busy && mode !== 'verify'} /></View> : null}
        {mode === 'verify' ? <View style={styles.field}><Text style={styles.label}>Verification code</Text><TextInput accessibilityLabel="Email verification code" style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={8} editable={!busy} /></View> : null}
        {mode === 'sign-in' || mode === 'password' ? <View style={styles.field}><Text style={styles.label}>Password</Text><TextInput accessibilityLabel="Account password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'password' ? 'new-password' : 'current-password'} autoCapitalize="none" autoCorrect={false} maxLength={256} editable={!busy} /></View> : null}
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={ui.body}>{notice}</Text> : null}
        <ActionButton label={busy ? 'Connecting…' : mode === 'sign-in' ? 'Sign in' : mode === 'email' ? 'Send verification email' : mode === 'verify' ? 'Verify email' : 'Save password'} onPress={() => void submit()} loading={busy} variant="dark" />
        {mode === 'verify' ? <ActionButton label="I verified my email" variant="secondary" disabled={busy} onPress={() => void checkEmail()} /> : null}
        {mode === 'sign-in' && (!account || account.guest) ? <ActionButton label="Create account from this guest session" variant="secondary" disabled={busy} onPress={() => { setMode('email'); setError(null); setNotice(null); }} /> : null}
        {mode === 'verify' ? <ActionButton label="Request another code" variant="secondary" disabled={busy} onPress={() => setMode('email')} /> : null}
        {mode === 'email' ? <ActionButton label="Use an existing account" variant="secondary" disabled={busy} onPress={() => setMode('sign-in')} /> : null}
        <Text style={ui.small}>Your chosen account email goes to Supabase Authentication. Driver profile details and mock payment preferences stay on this phone. No payment is taken.</Text>
        <ActionButton label="Back to map" variant="secondary" disabled={busy} onPress={() => router.replace('/')} />
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: 24, gap: 20, maxWidth: 620, width: '100%', alignSelf: 'center' },
  field: { gap: 8 }, label: { color: palette.ink, fontWeight: '700', fontSize: 14 },
  input: { borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper, color: palette.ink, borderRadius: 14, padding: 15, minHeight: 52, fontSize: 16 },
  error: { color: '#B53D28', fontSize: 14, lineHeight: 21 },
});

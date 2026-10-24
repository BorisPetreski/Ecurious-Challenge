import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionButton, ui } from '@/components/bayready-ui';
import { useProfile } from '@/components/profile-provider';
import { palette } from '@/constants/bayready';
import { getBookingAccount, type BookingAccount } from '@/lib/account-api';
import { BOOKINGS_CONFIGURED, BookingApiError } from '@/lib/bookings-api';
import { fetchCloudDataExport, fetchPrivacyRequest, requestAccountDataErasure, type PrivacyRequest } from '@/lib/privacy-api';

export default function PrivacyScreen() {
  const router = useRouter();
  const { profile, loading: profileLoading, loadError, error: profileError, clearProfile } = useProfile();
  const [account, setAccount] = useState<BookingAccount | null>(null);
  const [request, setRequest] = useState<PrivacyRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLocal, setConfirmLocal] = useState(false);
  const [confirmCloud, setConfirmCloud] = useState(false);
  const mounted = useRef(false);
  const actionRunning = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = BOOKINGS_CONFIGURED ? await getBookingAccount() : null;
      const pending = current ? await fetchPrivacyRequest() : null;
      if (mounted.current) { setAccount(current); setRequest(pending); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof BookingApiError ? cause.message : 'Your privacy status could not be refreshed. Reconnect and try again.');
    } finally { if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (cause) {
      if (mounted.current) setError(cause instanceof BookingApiError ? cause.message : 'This action could not be completed. No deletion is confirmed.');
    } finally {
      actionRunning.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function exportData(includeCloud: boolean) {
    await run(async () => {
      if (profileLoading || loadError) throw new BookingApiError('Retry profile storage before exporting. Its contents could not be read completely.');
      const current = includeCloud ? await getBookingAccount() : null;
      if (includeCloud && !current) throw new BookingApiError('No existing booking account was found. You can export your local profile separately.');
      const cloud = includeCloud ? await fetchCloudDataExport() : null;
      if (cloud && cloud.ownerId !== current?.id) throw new BookingApiError('The booking account changed. Refresh privacy status before exporting.');
      if (!mounted.current) return;
      await Share.share({ title: 'Your BayReady data', message: JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        scope: includeCloud ? 'Local profile and current-account BayReady booking records' : 'Local profile only; cloud and provider records excluded',
        localProfile: profile,
        account: current,
        cloud,
        excluded: ['Other accounts', 'Provider camera/lock records', 'Auth security logs and backups', 'Access tokens and secrets'],
      }, null, 2) });
    });
  }

  async function removeLocal() {
    await run(async () => {
      if (!await clearProfile()) throw new BookingApiError('Local profile deletion could not be confirmed. Retry before assuming your saved details are removed.');
      if (mounted.current) {
        setConfirmLocal(false);
        setNotice('Saved profile deleted from this device. Your booking account, cloud reservations and provider camera data are unchanged.');
      }
    });
  }

  async function requestDeletion() {
    await run(async () => {
      const pending = await requestAccountDataErasure();
      if (mounted.current) {
        setRequest(pending); setConfirmCloud(false);
        setNotice('Deletion request recorded for Ecurious review. Account and booking data have not been deleted.');
      }
    });
  }

  const disabled = loading || busy || profileLoading;
  return <SafeAreaView style={ui.safe} edges={['top', 'bottom', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.heading}>
        <Text style={ui.eyebrow}>YOUR INFORMATION</Text>
        <Text accessibilityRole="header" style={styles.title}>Privacy & your data</Text>
        <Text style={ui.body}>Control what stays on this phone and access the records attached to your booking account.</Text>
      </View>

      <View style={ui.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>What goes where</Text>
        <Text style={ui.small}>Your car profile and optional contact details stay on this device. Email sign-in sends your chosen account email to Supabase Auth.</Text>
        <Text style={ui.small}>A hardware reservation sends its plate to the backend for matching. BayReady stores a keyed fingerprint and masked suffix; it does not save camera images. The camera provider’s storage is separate.</Text>
        <Text style={ui.small}>The charger directory receives no profile details. Map/location requests go to external map and directory services; location is optional.</Text>
      </View>

      {loading ? <View style={styles.status}><ActivityIndicator color={palette.ink} /><Text style={ui.small}>Checking your existing account…</Text></View> : null}
      {error ? <View style={[ui.notice, ui.errorNotice]} accessibilityLiveRegion="polite"><Text style={ui.noticeTitle}>Could not confirm this action</Text><Text style={ui.small}>{error}</Text><ActionButton label="Refresh privacy status" disabled={disabled} variant="secondary" onPress={() => void refresh()} /></View> : null}
      {notice ? <View style={ui.notice} accessibilityLiveRegion="polite"><Text style={ui.small}>{notice}</Text></View> : null}

      <View style={ui.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Export your information</Text>
        <Text style={ui.small}>Exports may include your plate and optional contact details. Sharing opens your phone’s share sheet; choose where to send it.</Text>
        <ActionButton label="Export local profile" variant="secondary" disabled={disabled || !!loadError} onPress={() => void exportData(false)} />
        <ActionButton label="Export profile & account bookings" variant="dark" disabled={disabled || !account || !!loadError} onPress={() => void exportData(true)} />
        <Text style={styles.caption}>{account ? `Current ${account.guest ? 'guest' : 'email'} booking account. The export covers BayReady booking records; provider camera records, Auth security logs and backups require operator handling.` : 'No booking account is loaded. Local export works without creating one.'}</Text>
      </View>

      <View style={ui.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Delete your saved profile</Text>
        <Text style={ui.small}>Removes car, contact and mock payment preferences from this phone. It does not cancel reservations, sign you out or delete cloud/provider data.</Text>
        {confirmLocal ? <View style={styles.actions}>
          <Text style={styles.warning}>Delete the profile saved on this device?</Text>
          <ActionButton label="Yes, delete local profile" disabled={disabled} variant="dark" onPress={() => void removeLocal()} />
          <ActionButton label="Keep profile" disabled={disabled} variant="secondary" onPress={() => setConfirmLocal(false)} />
        </View> : <ActionButton label="Delete saved profile on this device" variant="secondary" disabled={disabled || (!profile && !loadError)} onPress={() => setConfirmLocal(true)} />}
        {profileError ? <Text style={styles.warning}>{profileError}</Text> : null}
      </View>

      <View style={ui.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Request account data deletion</Text>
        <Text style={ui.small}>Ecurious reviews this request for your current booking account. Active hardware bookings need safe cleanup first. Recording a request does not delete data or cancel a booking.</Text>
        {request ? <View style={ui.notice} accessibilityLiveRegion="polite">
          <Text style={ui.noticeTitle}>Pending Ecurious review</Text>
          <Text style={ui.small}>Requested {new Date(request.requestedAt).toLocaleString()}. Your account and booking data have not been deleted.</Text>
          {request.hasActiveHardwareBookings ? <Text style={ui.small}>An active or unresolved hardware booking needs operator handling.</Text> : null}
          <Text selectable style={styles.caption}>Reference: {request.id}</Text>
        </View> : confirmCloud ? <View style={styles.actions}>
          <Text style={styles.warning}>Send a deletion request for this booking account? Keep access to the account while it is reviewed.</Text>
          <ActionButton label="Send deletion request" disabled={disabled || !account} variant="dark" onPress={() => void requestDeletion()} />
          <ActionButton label="Back" disabled={disabled} variant="secondary" onPress={() => setConfirmCloud(false)} />
        </View> : <ActionButton label="Request account data deletion" disabled={disabled || !account} variant="secondary" onPress={() => setConfirmCloud(true)} />}
        <ActionButton label="Refresh request status" disabled={disabled || !account} variant="secondary" onPress={() => void refresh()} />
      </View>

      <View style={ui.notice}>
        <Text style={ui.noticeTitle}>Operated by Ecurious</Text>
        <Text style={ui.small}>This hackathon notice is a draft. Ecurious must provide its legal entity, privacy contact, lawful basis and full camera/retention notice before live rollout. These controls do not establish GDPR compliance.</Text>
        <ActionButton label="Read about your data rights" variant="secondary" disabled={busy} onPress={() => void Linking.openURL('https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en').catch(() => setError('The data-rights page could not be opened.'))} />
      </View>
      <ActionButton label="Back" variant="secondary" disabled={busy} onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }} />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  scroll: { padding: 22, gap: 20, paddingBottom: 32, width: '100%', maxWidth: 680, alignSelf: 'center' },
  heading: { gap: 8, paddingTop: 6 },
  title: { color: palette.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  cardTitle: { color: palette.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  caption: { color: palette.muted, fontSize: 12, lineHeight: 19 },
  warning: { color: palette.errorInk, fontSize: 14, lineHeight: 21 },
  actions: { gap: 12 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

import { useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppScreen, ConnectionNotice, SectionHeading, ui } from '@/components/bayready-ui';
import { useBayReady } from '@/components/reservation-provider';
import { HardwareStatus } from '@/components/hardware-status';
import { palette, readable } from '@/constants/bayready';

function eventTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ActivityScreen() {
  const { state, loading, refreshing, refresh, apiBaseUrl } = useBayReady();
  const [developerOpen, setDeveloperOpen] = useState(false);
  const events = state?.events ?? [];

  return (
    <AppScreen>
      <View style={styles.intro}>
        <Text style={ui.eyebrow}>EVERY STEP, VISIBLE</Text>
        <Text accessibilityRole="header" style={styles.heading}>A clear picture.</Text>
        <Text style={ui.body}>Follow the local simulator as a booking becomes an arrival, a session and an empty bay.</Text>
      </View>

      <ConnectionNotice />

      <Link href="/simulation" asChild><Pressable accessibilityRole="button" style={StyleSheet.flatten([ui.button, ui.darkButton])}><Text style={[ui.buttonText, ui.darkButtonText]}>Open multi-car Scenario lab</Text></Pressable></Link>

      <HardwareStatus />

      <View>
        <SectionHeading eyebrow="SHARED SIMULATOR" title="Latest activity" trailing={<Text style={styles.eventCount}>{events.length} events</Text>} />
        <View style={ui.card}>
          <Text style={ui.small}>Newest first. Events are supplied by the local simulator and do not confirm physical hardware or real charging.</Text>
          {events.length === 0 ? <View style={styles.empty}><View style={styles.emptyMark}><Text style={styles.emptyMarkText}>↗</Text></View><Text style={styles.emptyTitle}>{loading ? 'Waiting for the first snapshot' : 'Your journey starts here'}</Text><Text style={styles.emptyCopy}>Connect the laptop simulator, then reserve the demo bay from the Reserve tab.</Text></View> : <View style={styles.timeline}>{events.map((event, index) => <View key={event.id} style={styles.event}>
            <View style={styles.track}><View style={[styles.dot, index === 0 && styles.newestDot]} />{index < events.length - 1 ? <View style={styles.trackLine} /> : null}</View>
            <View style={styles.eventContent}>
              <View style={styles.eventHeading}><Text style={styles.eventType}>{readable(event.type)}</Text><Text style={styles.eventTime}>{eventTime(event.at)}</Text></View>
              <Text style={styles.eventMessage}>{event.message}</Text>
            </View>
          </View>)}</View>}
          <ActionButton label={refreshing ? 'Refreshing…' : 'Refresh activity'} onPress={() => void refresh()} disabled={refreshing || loading} variant="secondary" />
        </View>
      </View>

      <View style={styles.principle}>
        <Text style={styles.principleNumber}>01</Text><View style={ui.flex}><Text style={styles.principleTitle}>A booking is a promise.</Text><Text style={ui.body}>An arrival deadline prevents unused holds. Occupancy stays separate, so an expired hold never implies an empty bay.</Text></View>
      </View>

      <View style={styles.developerCard}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: developerOpen }} onPress={() => setDeveloperOpen(open => !open)} style={({ pressed }) => [styles.disclosure, pressed && ui.pressed]}>
          <View style={ui.flex}><Text style={styles.developerTitle}>Developer connection setup</Text><Text style={ui.small}>Laptop server, Wi-Fi and API address</Text></View><Text style={styles.expand}>{developerOpen ? '−' : '+'}</Text>
        </Pressable>
        {developerOpen ? <View style={styles.developerBody}>
          <Text style={ui.label}>Current simulator API</Text>
          <Text selectable style={styles.code}>{apiBaseUrl}</Text>
          <Text style={ui.body}>Connect this Android phone and your laptop to the same Wi-Fi. Keep the project running on the laptop:</Text>
          <Text selectable style={styles.code}>npm start</Text>
          <Text style={ui.body}>Run that command from the project root. It starts the simulator and Expo. Scan the Expo QR code with Expo Go on Android.</Text>
          <View style={ui.rule} />
          <Text style={ui.label}>If the API address is wrong</Text>
          <Text style={ui.body}>Set the public laptop address in mobile/.env, then restart Expo:</Text>
          <Text selectable style={styles.code}>EXPO_PUBLIC_API_URL=http://{'<laptop-LAN-IP>'}:3000</Text>
          <Text style={ui.small}>Use the laptop’s Wi-Fi address, not localhost on your phone. This setting is a public server address; never put credentials in EXPO_PUBLIC_ variables.</Text>
          <Text style={ui.body}>A venue guest network may block device-to-device traffic. Try a shared private hotspot if the QR code opens but the simulator stays unreachable.</Text>
          <ActionButton label="Retry simulator connection" onPress={() => void refresh()} disabled={refreshing || loading} variant="secondary" />
          <Text style={ui.small}>The starter uses one in-memory bay shared by all connected clients. Restarting the laptop simulator clears its booking and timeline.</Text>
          {state ? <Text style={ui.small}>Last server snapshot: {new Date(state.now).toLocaleString()}. Simulator time can advance when you expire a hold.</Text> : null}
        </View> : null}
      </View>

      <Text style={styles.footer}>BayReady · Ecurious hackathon starter{ '\n' }Local rehearsal · Android + Expo Go</Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  heading: { fontSize: 36, fontWeight: '800', color: palette.ink, letterSpacing: -1.3 },
  eventCount: { fontSize: 13, color: palette.muted, backgroundColor: palette.soft, borderRadius: 15, paddingVertical: 7, paddingHorizontal: 10 },
  empty: { paddingVertical: 20, alignItems: 'center', gap: 10 },
  emptyMark: { backgroundColor: palette.soft, width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  emptyMarkText: { fontSize: 27, color: palette.ink },
  emptyTitle: { fontSize: 17, color: palette.ink, fontWeight: '700', textAlign: 'center' },
  emptyCopy: { fontSize: 15, lineHeight: 22, color: palette.muted, textAlign: 'center' },
  timeline: { paddingTop: 8 },
  event: { flexDirection: 'row', gap: 13 },
  track: { width: 12, alignItems: 'center', paddingTop: 5 },
  dot: { height: 10, width: 10, backgroundColor: palette.line, borderRadius: 5 },
  newestDot: { backgroundColor: '#6E852E' },
  trackLine: { flex: 1, width: 1, backgroundColor: palette.line, marginTop: 5, marginBottom: 5 },
  eventContent: { flex: 1, paddingBottom: 22, gap: 7 },
  eventHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  eventType: { color: palette.ink, fontWeight: '700', fontSize: 14, textTransform: 'capitalize' },
  eventTime: { color: palette.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  eventMessage: { color: palette.muted, fontSize: 15, lineHeight: 22 },
  principle: { flexDirection: 'row', gap: 16, padding: 4 },
  principleNumber: { color: '#82964E', fontSize: 19, fontWeight: '600', paddingTop: 1 },
  principleTitle: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3, color: palette.ink, marginBottom: 7 },
  developerCard: { backgroundColor: palette.soft, borderWidth: 1, borderColor: palette.line, borderRadius: 20 },
  disclosure: { minHeight: 78, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  developerTitle: { color: palette.ink, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  expand: { fontSize: 26, color: palette.ink },
  developerBody: { padding: 18, paddingTop: 0, gap: 14 },
  code: { padding: 13, backgroundColor: palette.cream, borderWidth: 1, borderColor: palette.line, borderRadius: 10, color: palette.ink, fontSize: 14, lineHeight: 21, fontFamily: 'monospace' },
  footer: { textAlign: 'center', fontSize: 12, lineHeight: 19, color: palette.muted, marginVertical: 6 },
});

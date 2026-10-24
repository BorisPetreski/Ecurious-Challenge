import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReservationProvider } from '@/components/reservation-provider';
import { BookingsProvider } from '@/components/bookings-provider';
import { ProfileProvider, useProfile } from '@/components/profile-provider';
import { ActionButton, ui } from '@/components/bayready-ui';
import { palette } from '@/constants/bayready';

export default function RootLayout() {
  return <ProfileProvider><AppRoutes /></ProfileProvider>;
}

function AppRoutes() {
  const { profile, loading, loadError, setupSeen, reload, skipSetup } = useProfile();
  const routesStarted = useRef(false);
  // Only initial storage recovery gates navigation. A later retry must preserve
  // the mounted form and its unsaved edits.
  if (!routesStarted.current && (loading || (loadError && !setupSeen && !profile))) {
    return <SafeAreaView style={[ui.safe, { justifyContent: 'center', padding: 28, gap: 18 }]}>
      <StatusBar style="dark" />
      <Text style={ui.sectionTitle}>BayReady</Text>
      {loading ? <><ActivityIndicator color={palette.ink} /><Text style={ui.body}>Loading your driver profile…</Text></>
        : <><Text style={ui.body}>{loadError}</Text><ActionButton label="Retry profile storage" onPress={() => void reload()} /><ActionButton label="Explore map first" variant="secondary" onPress={() => void skipSetup()} /></>}
    </SafeAreaView>;
  }
  routesStarted.current = true;
  return (
    <ReservationProvider>
      <BookingsProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.cream }, animation: 'none' }}>
        <Stack.Protected guard={setupSeen || profile !== null}>
        <Stack.Screen name="index" />
        <Stack.Screen name="map" />
        <Stack.Screen name="reserve" />
        <Stack.Screen name="activity" />
        <Stack.Screen name="hardware" />
        <Stack.Screen name="session" />
        </Stack.Protected>
        <Stack.Screen name="profile" />
        <Stack.Screen name="sign-in" />
      </Stack>
      </BookingsProvider>
    </ReservationProvider>
  );
}

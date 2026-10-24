import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ReservationProvider } from '@/components/reservation-provider';
import { palette } from '@/constants/bayready';

export default function RootLayout() {
  return (
    <ReservationProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.cream }, animation: 'none' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="map" />
        <Stack.Screen name="activity" />
      </Stack>
    </ReservationProvider>
  );
}

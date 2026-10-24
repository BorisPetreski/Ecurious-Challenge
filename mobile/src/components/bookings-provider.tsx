import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import { useBookingState, type UseBookingsResult } from '@/hooks/use-bookings';
import { BOOKINGS_CONFIGURED, getBookingAccountClient } from '@/lib/bookings-api';

const BookingsContext = createContext<UseBookingsResult | null>(null);

export function BookingsProvider({ children }: PropsWithChildren) {
  const [identity, setIdentity] = useState('restoring');
  useEffect(() => {
    if (!BOOKINGS_CONFIGURED) return;
    // Reset every allocation screen on a UID switch. A delayed response from
    // the former account must never become the new account's cached snapshot.
    const { data } = getBookingAccountClient().auth.onAuthStateChange((_event, session) => {
      setIdentity(session?.user.id ?? 'signed-out');
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return <BookingIdentity key={identity}>{children}</BookingIdentity>;
}

function BookingIdentity({ children }: PropsWithChildren) {
  const bookings = useBookingState();
  return <BookingsContext.Provider value={bookings}>{children}</BookingsContext.Provider>;
}

export function useBookings(): UseBookingsResult {
  const context = useContext(BookingsContext);
  if (!context) throw new Error('Shared reservation screens require BookingsProvider.');
  return context;
}

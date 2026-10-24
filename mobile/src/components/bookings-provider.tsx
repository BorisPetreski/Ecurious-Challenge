import { createContext, type PropsWithChildren, useContext } from 'react';

import { useBookingState, type UseBookingsResult } from '@/hooks/use-bookings';

const BookingsContext = createContext<UseBookingsResult | null>(null);

export function BookingsProvider({ children }: PropsWithChildren) {
  const bookings = useBookingState();
  return <BookingsContext.Provider value={bookings}>{children}</BookingsContext.Provider>;
}

export function useBookings(): UseBookingsResult {
  const context = useContext(BookingsContext);
  if (!context) throw new Error('Shared reservation screens require BookingsProvider.');
  return context;
}

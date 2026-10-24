import { createContext, type PropsWithChildren, useContext, useState } from 'react';

import { useReservation } from '@/hooks/use-reservation';

type ReservationContextValue = ReturnType<typeof useReservation> & {
  plate: string;
  setPlate: (plate: string) => void;
  holdMinutes: number;
  setHoldMinutes: (minutes: number) => void;
  confidence: number;
  setConfidence: (confidence: number) => void;
};

const ReservationContext = createContext<ReservationContextValue | null>(null);

export function ReservationProvider({ children }: PropsWithChildren) {
  const reservation = useReservation();
  // Keep rehearsal inputs in memory across route changes. They are never persisted.
  const [plate, setPlate] = useState('M-DEMO-42');
  const [holdMinutes, setHoldMinutes] = useState(10);
  const [confidence, setConfidence] = useState(0.99);
  return (
    <ReservationContext.Provider value={{ ...reservation, plate, setPlate, holdMinutes, setHoldMinutes, confidence, setConfidence }}>
      {children}
    </ReservationContext.Provider>
  );
}

export function useBayReady() {
  const context = useContext(ReservationContext);
  if (!context) throw new Error('BayReady screens require ReservationProvider.');
  return context;
}

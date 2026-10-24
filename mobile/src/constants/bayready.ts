export const palette = {
  cream: '#F5F4EC',
  paper: '#FFFFFF',
  ink: '#1C2A20',
  muted: '#60695E',
  lime: '#D4F66A',
  line: '#DCDFD2',
  soft: '#EAEDE0',
  warning: '#FEF0D6',
  warningInk: '#714A0A',
  error: '#FCEAE5',
  errorInk: '#923A29',
} as const;

const labels: Record<string, string> = {
  free: 'Available', reserved: 'Reserved', occupied: 'Occupied', blocked: 'Blocked',
  charging: 'Simulated charging', 'awaiting-release': 'Ready to release',
  'awaiting-arrival': 'Awaiting arrival', 'manual-review': 'Needs review',
  authorized: 'Arrival authorised', completed: 'Vehicle departed',
  'expired-occupied': 'Hold expired · bay occupied',
};

export function readable(value: string) {
  return labels[value] ?? value.replaceAll('-', ' ');
}

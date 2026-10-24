export const CONNECTOR_OPTIONS = [
  { value: 'CCS', label: 'CCS (DC)' },
  { value: 'Typ2', label: 'Type 2 (AC)' },
  { value: 'CHAdeMO', label: 'CHAdeMO (DC)' },
] as const;

export const PAYMENT_OPTIONS = [
  { value: 'mock-card', label: 'Demo card •••• 4242' },
  { value: 'mock-wallet', label: 'Demo wallet' },
] as const;

export interface DriverProfile {
  version: 1;
  name: string;
  email: string;
  phone: string;
  paymentMethod: typeof PAYMENT_OPTIONS[number]['value'];
  licensePlate: string;
  connectorType: typeof CONNECTOR_OPTIONS[number]['value'];
  updatedAt: string;
}

export type ProfileInput = Omit<DriverProfile, 'version' | 'updatedAt'>;
export type ProfileFieldErrors = Partial<Record<keyof ProfileInput, string>>;
export type ProfileValidation = { valid: true; value: ProfileInput } | { valid: false; errors: ProfileFieldErrors };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().normalize('NFKC') : '';
}

/** Validate local preferences only; this does not verify identity or payment. */
export function validateProfileInput(input: unknown): ProfileValidation {
  const fields = isRecord(input) ? input : {};
  const errors: ProfileFieldErrors = {};
  const name = text(fields.name).replace(/ +/g, ' ');
  const email = text(fields.email).toLowerCase();
  const rawPhone = text(fields.phone);
  const phone = rawPhone.replace(/[ ().-]/g, '');
  const rawPlate = text(fields.licensePlate);
  const licensePlate = rawPlate.toUpperCase().replace(/ +/g, ' ');
  const plateCharacters = Array.from(licensePlate.replace(/[ -]/g, '')).length;

  if (Array.from(name).length < 1 || Array.from(name).length > 100 || /\p{C}/u.test(name)) {
    errors.name = 'Enter a name between 1 and 100 printable characters.';
  }
  if (Array.from(email).length > 254 || /\p{C}/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    errors.email = 'Enter a valid email address, for example driver@example.com.';
  }
  if (!/^\+[1-9]\d{6,14}$/.test(phone) || !/^\+[\d ().-]+$/.test(rawPhone)) {
    errors.phone = 'Include the country code, for example +49 151 23456789 (7–15 digits).';
  }
  if (!/^[\p{L}\p{N} -]+$/u.test(licensePlate) || Array.from(licensePlate).length > 20 || plateCharacters < 2 || plateCharacters > 15) {
    errors.licensePlate = 'Use 2–15 letters or numbers, with optional spaces or hyphens (20 characters maximum).';
  }
  if (!CONNECTOR_OPTIONS.some(option => option.value === fields.connectorType)) {
    errors.connectorType = 'Choose the connector your car uses.';
  }
  if (!PAYMENT_OPTIONS.some(option => option.value === fields.paymentMethod)) {
    errors.paymentMethod = 'Choose a demo payment method. No real payment is taken.';
  }
  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: {
      name, email, phone, licensePlate,
      connectorType: fields.connectorType as ProfileInput['connectorType'],
      paymentMethod: fields.paymentMethod as ProfileInput['paymentMethod'],
    },
  };
}

export function parseDriverProfile(value: unknown): DriverProfile | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.updatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt) ||
    !Number.isFinite(Date.parse(value.updatedAt)) || new Date(value.updatedAt).toISOString() !== value.updatedAt) return null;
  const validated = validateProfileInput(value);
  return validated.valid ? { version: 1, ...validated.value, updatedAt: value.updatedAt } : null;
}

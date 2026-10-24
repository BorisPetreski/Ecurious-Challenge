import { BookingApiError, getBookingAccessToken, getBookingAccountClient } from './bookings-api';

export interface BookingAccount { id: string; email: string | null; guest: boolean; emailVerified: boolean }

function emailInput(value: string): string {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BookingApiError('Enter a valid email address.', 'INVALID_EMAIL');
  }
  return email;
}

export async function getBookingAccount(): Promise<BookingAccount | null> {
  const client = getBookingAccountClient();
  const local = await client.auth.getSession();
  if (!local.data.session) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new BookingApiError('Your account could not be refreshed. Check your connection.', 'AUTH_REQUIRED');
  return { id: data.user.id, email: data.user.email ?? null, guest: data.user.is_anonymous === true,
    emailVerified: !!data.user.email_confirmed_at };
}

export async function signInToAccount(email: string, password: string): Promise<void> {
  if (!password || password.length > 256) throw new BookingApiError('Enter your password.', 'INVALID_PASSWORD');
  const { error, data } = await getBookingAccountClient().auth.signInWithPassword({ email: emailInput(email), password });
  if (error || !data.session) throw new BookingApiError('Sign-in failed. Check your email, password and connection.', 'SIGN_IN_FAILED');
}

/** Link a new identity to the existing guest UID so its reservations stay owned. */
export async function requestAccountEmail(email: string): Promise<void> {
  await getBookingAccessToken();
  const { error } = await getBookingAccountClient().auth.updateUser({ email: emailInput(email) });
  if (error) throw new BookingApiError('Could not send the verification email. If this address already has an account, use Sign in instead. Otherwise try again later.', 'EMAIL_LINK_FAILED');
}

export async function verifyAccountEmail(email: string, token: string): Promise<void> {
  if (!/^\d{6,8}$/.test(token.trim())) throw new BookingApiError('Enter the verification code from your email.', 'INVALID_CODE');
  const { error } = await getBookingAccountClient().auth.verifyOtp({ email: emailInput(email), token: token.trim(), type: 'email_change' });
  if (error) throw new BookingApiError('The verification code could not be confirmed. Check the code or request a new email.', 'EMAIL_VERIFY_FAILED');
}

export async function checkAccountEmailVerified(): Promise<BookingAccount> {
  const account = await getBookingAccount();
  if (!account?.emailVerified || account.guest) throw new BookingApiError('Open the verification link in your email first, then return here.', 'EMAIL_NOT_VERIFIED');
  return account;
}

export async function setAccountPassword(password: string): Promise<void> {
  if (password.length < 8 || password.length > 256) throw new BookingApiError('Use a password with at least eight characters.', 'INVALID_PASSWORD');
  const account = await getBookingAccount();
  if (!account?.emailVerified || account.guest) throw new BookingApiError('Verify your email before choosing a password.', 'EMAIL_NOT_VERIFIED');
  const { error } = await getBookingAccountClient().auth.updateUser({ password });
  if (error) throw new BookingApiError('Your password could not be saved. Try a stronger password and check your connection.', 'PASSWORD_UPDATE_FAILED');
}

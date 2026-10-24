export function isPublicSupabaseKey(value) {
  if (typeof value !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString());
    return claims.role === 'anon';
  } catch { return false; }
}

/** Forward intended mobile config; Eventbrite and private database settings stay on Node.
 * The Audimax hackathon path deliberately receives its separate direct-device key.
 */
export function mobileEnvironment(env) {
  const result = { ...env };
  const directoryKey = env.EXPO_PUBLIC_GOINGELECTRIC_API_KEY || env.GOINGELECTRIC_API_KEY || env.ELECTRIC_API_KEY;
  delete result.ECURIOUS_API_KEY;
  delete result.ECURIOUS_COMMANDS_ENABLED;
  delete result.ECURIOUS_LOCK_IDS;
  delete result.GOINGELECTRIC_API_KEY;
  delete result.ELECTRIC_API_KEY;
  for (const name of Object.keys(result)) {
    if (name.startsWith('SUPABASE_') || name.startsWith('BAYREADY_') || name.startsWith('EVENTBRITE_')) delete result[name];
  }
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (supabaseUrl) result.EXPO_PUBLIC_SUPABASE_URL = supabaseUrl.trim();
  const supabaseKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_API_KEY;
  delete result.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete result.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseKey?.trim()) {
    if (!isPublicSupabaseKey(supabaseKey.trim())) {
      throw new Error('Use a Supabase publishable or anon key for the phone. Secret/service-role keys must stay on the server.');
    }
    result.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = supabaseKey.trim();
  }
  if (directoryKey?.trim()) result.EXPO_PUBLIC_GOINGELECTRIC_API_KEY = directoryKey.trim();
  const audimaxKey = env.EXPO_PUBLIC_AUDIMAX_API_KEY || env.AUDIMAX_API_KEY || env.ECURIOUS_API_KEY;
  if (audimaxKey?.trim()) result.EXPO_PUBLIC_AUDIMAX_API_KEY = audimaxKey.trim();
  const audimaxBaseUrl = env.EXPO_PUBLIC_AUDIMAX_BASE_URL || env.AUDIMAX_BASE_URL || env.ECURIOUS_BASE_URL;
  if (audimaxBaseUrl?.trim()) result.EXPO_PUBLIC_AUDIMAX_BASE_URL = audimaxBaseUrl.trim();
  return result;
}

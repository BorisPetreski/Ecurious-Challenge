export function isPublicSupabaseKey(value) {
  if (typeof value !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString());
    return claims.role === 'anon';
  } catch { return false; }
}

/** Directory and Supabase publishable keys go to the phone. Server secrets never do. */
export function mobileEnvironment(env) {
  const result = { ...env };
  const directoryKey = env.EXPO_PUBLIC_GOINGELECTRIC_API_KEY || env.GOINGELECTRIC_API_KEY || env.ELECTRIC_API_KEY;
  delete result.ECURIOUS_API_KEY;
  delete result.ECURIOUS_COMMANDS_ENABLED;
  delete result.ECURIOUS_LOCK_IDS;
  delete result.GOINGELECTRIC_API_KEY;
  delete result.ELECTRIC_API_KEY;
  for (const name of Object.keys(result)) {
    if (name.startsWith('SUPABASE_') || name.startsWith('BAYREADY_')) delete result[name];
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
  return result;
}

/** Directory access runs on the phone. Hardware authentication stays on Node. */
export function mobileEnvironment(env) {
  const result = { ...env };
  const directoryKey = env.EXPO_PUBLIC_GOINGELECTRIC_API_KEY || env.GOINGELECTRIC_API_KEY || env.ELECTRIC_API_KEY;
  delete result.ECURIOUS_API_KEY;
  delete result.GOINGELECTRIC_API_KEY;
  delete result.ELECTRIC_API_KEY;
  if (directoryKey?.trim()) result.EXPO_PUBLIC_GOINGELECTRIC_API_KEY = directoryKey.trim();
  return result;
}

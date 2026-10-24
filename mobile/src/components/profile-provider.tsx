import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { parseDriverProfile, validateProfileInput, type DriverProfile, type ProfileInput } from '@/lib/driver-profile';

const PROFILE_KEY = 'bayready.driver-profile.v1';
const SETUP_KEY = 'bayready.driver-profile.setup-seen.v1';
const webMemory = new Map<string, string>();

interface ProfileContextValue {
  profile: DriverProfile | null;
  loading: boolean;
  error: string | null;
  loadError: string | null;
  setupSeen: boolean;
  saveProfile: (input: ProfileInput) => Promise<boolean>;
  clearProfile: () => Promise<boolean>;
  skipSetup: () => Promise<boolean>;
  reload: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

async function readStored(key: string): Promise<string | null> {
  return Platform.OS === 'web' ? webMemory.get(key) ?? null : SecureStore.getItemAsync(key);
}

async function writeStored(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webMemory.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

async function deleteStored(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webMemory.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export function ProfileProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setupSeen, setSetupSeen] = useState(false);
  const mounted = useRef(false);
  const storageReady = useRef(false);
  const operations = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = operations.current.catch(() => undefined).then(operation);
    operations.current = next;
    return next;
  }, []);

  const reload = useCallback(async () => {
    if (mounted.current) setLoading(true);
    await enqueue(async () => {
      storageReady.current = false;
      try {
        const [storedProfile, storedSeen] = await Promise.all([readStored(PROFILE_KEY), readStored(SETUP_KEY)]);
        let restored: DriverProfile | null = null;
        if (storedProfile !== null) {
          restored = parseDriverProfile(JSON.parse(storedProfile) as unknown);
          if (!restored) throw new Error('Unsupported local profile');
        }
        if (storedSeen !== null && storedSeen !== '1') throw new Error('Unsupported local setup marker');
        storageReady.current = true;
        if (mounted.current) {
          setProfile(restored);
          setSetupSeen(storedSeen === '1' || restored !== null);
          setError(null);
          setLoadError(null);
        }
      } catch {
        // Do not replace or delete data that this app cannot safely read.
        if (mounted.current) {
          const message = 'Your saved profile could not be read. Retry storage before saving changes; the existing profile has been kept.';
          setLoadError(message);
          setError(message);
        }
      } finally {
        if (mounted.current) setLoading(false);
      }
    });
  }, [enqueue]);

  const saveProfile = useCallback(async (input: ProfileInput): Promise<boolean> => {
    const validated = validateProfileInput(input);
    if (!validated.valid) {
      if (mounted.current) setError('Check the highlighted profile fields before saving.');
      return false;
    }
    return enqueue(async () => {
      if (!storageReady.current) {
        if (mounted.current) setError('Retry profile storage before saving. Your existing profile will not be overwritten while it cannot be read.');
        return false;
      }
      const next: DriverProfile = { version: 1, ...validated.value, updatedAt: new Date().toISOString() };
      try {
        await writeStored(PROFILE_KEY, JSON.stringify(next));
        await writeStored(SETUP_KEY, '1');
        if (mounted.current) {
          setProfile(next);
          setSetupSeen(true);
          setError(null);
        }
        return true;
      } catch {
        if (mounted.current) setError('Could not finish saving your profile on this device. Your form entries are still here; retry when storage is available.');
        return false;
      }
    });
  }, [enqueue]);

  const skipSetup = useCallback((): Promise<boolean> => enqueue(async () => {
    try {
      // Skipping changes only the onboarding marker, never an existing profile.
      await writeStored(SETUP_KEY, '1');
      if (mounted.current) {
        setSetupSeen(true);
        if (storageReady.current) setError(null);
      }
      return true;
    } catch {
      if (mounted.current) setError('Could not remember your setup choice on this device. Retry when storage is available.');
      return false;
    }
  }), [enqueue]);

  const clearProfile = useCallback((): Promise<boolean> => enqueue(async () => {
    try {
      // Erasure is explicit even when an old profile cannot be parsed. Serialize
      // with save/reload so a pending storage operation cannot restore it later.
      await deleteStored(PROFILE_KEY);
      if (await readStored(PROFILE_KEY) !== null) throw new Error('Profile deletion unconfirmed');
      storageReady.current = true;
      if (mounted.current) {
        setProfile(null);
        setLoadError(null);
        setError(null);
      }
      return true;
    } catch {
      if (mounted.current) setError('Profile deletion could not be confirmed. Retry before assuming this device’s saved details are removed.');
      return false;
    }
  }), [enqueue]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; };
  }, [reload]);

  return (
    <ProfileContext.Provider value={{ profile, loading, error, loadError, setupSeen, saveProfile, clearProfile, skipSetup, reload }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('Driver profile screens require ProfileProvider.');
  return context;
}

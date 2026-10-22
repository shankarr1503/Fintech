import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Secrets such as the session token. On iOS and Android they live in the Keychain / Keystore.
// The web has no equivalent: there they stay in AsyncStorage (localStorage), which any script on the
// page can read, so the web build relies on the server's short session lifetime and idle timeout.
const SECURE = Platform.OS !== 'web';

export async function getSecret(key: string): Promise<string | null> {
  if (!SECURE) return AsyncStorage.getItem(key);
  try {
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) return value;
  } catch {
    // Keychain unavailable (e.g. locked device during a restore): fall through to the legacy copy.
  }
  // Earlier versions kept it in AsyncStorage: move it into the secure store.
  const legacy = await AsyncStorage.getItem(key).catch(() => null);
  if (legacy !== null && (await setSecret(key, legacy))) await AsyncStorage.removeItem(key).catch(() => {});
  return legacy;
}

/** Returns false if it couldn't be saved; the value then lasts only until the app closes. */
export async function setSecret(key: string, value: string): Promise<boolean> {
  try {
    if (SECURE) await SecureStore.setItemAsync(key, value);
    else await AsyncStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  // Also clears a legacy AsyncStorage copy on native.
  await Promise.all([SECURE ? SecureStore.deleteItemAsync(key).catch(() => {}) : null, AsyncStorage.removeItem(key).catch(() => {})]);
}

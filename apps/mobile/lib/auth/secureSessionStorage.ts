import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Supabase auth storage backed by the iOS Keychain / Android Keystore (expo-secure-store).
 *
 * A Supabase session (JWT with custom claims + refresh token) is larger than SecureStore's ~2 KB
 * per-value guidance, so each value is split into fixed-size chunks (`<key>.0`, `<key>.1`, ... plus a
 * `<key>.n` count written last). No custom encryption is involved: the OS protects each chunk.
 *
 * Migration: sessions written by older builds live in AsyncStorage under the same key. They are moved
 * on first read and removed only after the secure copy reads back identically, so an upgrade never
 * signs anyone out. If the secure store cannot be read or written the legacy copy keeps working and
 * the move is retried next launch. New writes never fall back to plaintext: a failed secure write
 * throws (the session then lives in memory for this run only).
 *
 * Values are never logged. Web (dev only, no Keychain) passes straight through to AsyncStorage.
 */
export const CHUNK_SIZE = 1500;

const OPTIONS: SecureStore.SecureStoreOptions = {
  // Readable for token refresh while the phone is locked after the first unlock, and never restored
  // onto a different device from a backup.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function readSecure(key: string): Promise<string | null> {
  const rawCount = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  if (rawCount === null) return null;
  const count = Number.parseInt(rawCount, 10);
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error("secure-session: corrupt chunk count");
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
    if (part === null) throw new Error("secure-session: missing chunk");
    parts.push(part);
  }
  return parts.join("");
}

async function removeSecure(key: string): Promise<void> {
  const rawCount = await SecureStore.getItemAsync(countKey(key), OPTIONS).catch(() => null);
  const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
  await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
  for (let i = 0; i < (Number.isInteger(count) ? Math.min(count, 64) : 0); i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
  }
}

async function writeSecure(key: string, value: string): Promise<void> {
  const previous = await SecureStore.getItemAsync(countKey(key), OPTIONS).catch(() => null);
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
  if (chunks.length === 0) chunks.push("");
  for (let i = 0; i < chunks.length; i += 1) {
    await SecureStore.setItemAsync(chunkKey(key, i), chunks[i], OPTIONS);
  }
  await SecureStore.setItemAsync(countKey(key), String(chunks.length), OPTIONS);
  // A shorter value than before leaves stale trailing chunks; drop them.
  const oldCount = previous ? Number.parseInt(previous, 10) : 0;
  for (let i = chunks.length; i < (Number.isInteger(oldCount) ? Math.min(oldCount, 64) : 0); i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
  }
}

const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return AsyncStorage.getItem(key);

    let secure: string | null = null;
    let secureReadable = true;
    try {
      secure = await readSecure(key);
    } catch {
      secureReadable = false;
    }
    if (secure !== null) return secure;

    // Nothing (readable) in the secure store: an older build's session may still be in AsyncStorage.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy === null) return null;
    if (secureReadable) {
      try {
        await writeSecure(key, legacy);
        if ((await readSecure(key)) === legacy) await AsyncStorage.removeItem(key);
      } catch {
        // Keep the legacy copy; the move is retried on the next launch.
      }
    }
    return legacy;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return AsyncStorage.setItem(key, value);
    await writeSecure(key, value);
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") return AsyncStorage.removeItem(key);
    await removeSecure(key).catch(() => undefined);
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
};

export default secureSessionStorage;

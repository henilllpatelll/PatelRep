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
const MAX_CHUNKS = 64;

/**
 * Where a stored value lives. The pointer (`<key>.n`) is the single atomic switch:
 *  - legacy layout: "<count>" with chunks `<key>.<i>` (written by the first secure-storage builds);
 *  - current layout: "g<generation>:<count>" with chunks `<key>.g<generation>.<i>`.
 * A write puts the new value under a NEW generation, then flips the pointer, then deletes the old
 * generation. The live value is never overwritten in place, so a failed or interrupted write leaves the
 * previous session readable.
 */
interface Layout {
  generation: string | null;
  count: number;
}

const chunkKey = (key: string, layout: Layout, i: number) =>
  layout.generation === null ? `${key}.${i}` : `${key}.${layout.generation}.${i}`;

function parsePointer(raw: string): Layout {
  const legacy = /^\d+$/.exec(raw);
  const current = /^(g[0-9a-z]+):(\d+)$/.exec(raw);
  const generation = current ? current[1] : null;
  const count = Number.parseInt(current ? current[2] : legacy ? raw : "", 10);
  if (!(legacy || current) || !Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
    throw new Error("secure-session: corrupt chunk count");
  }
  return { generation, count };
}

async function readLayout(key: string): Promise<Layout | null> {
  const raw = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  return raw === null ? null : parsePointer(raw);
}

async function readSecure(key: string): Promise<string | null> {
  const layout = await readLayout(key);
  if (layout === null) return null;
  const parts: string[] = [];
  for (let i = 0; i < layout.count; i += 1) {
    const part = await SecureStore.getItemAsync(chunkKey(key, layout, i), OPTIONS);
    if (part === null) throw new Error("secure-session: missing chunk");
    parts.push(part);
  }
  return parts.join("");
}

async function deleteChunks(key: string, layout: Layout): Promise<void> {
  for (let i = 0; i < layout.count; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, layout, i), OPTIONS).catch(() => undefined);
  }
}

async function removeSecure(key: string): Promise<void> {
  const layout = await readLayout(key).catch(() => null);
  await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
  if (layout) await deleteChunks(key, layout);
}

let generationCounter = 0;
const nextGeneration = () => {
  generationCounter += 1;
  return `g${Date.now().toString(36)}${generationCounter.toString(36)}`;
};

async function writeSecure(key: string, value: string): Promise<void> {
  const previous = await readLayout(key).catch(() => null);
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
  if (chunks.length === 0) chunks.push("");
  if (chunks.length > MAX_CHUNKS) throw new Error("secure-session: value too large");

  const next: Layout = { generation: nextGeneration(), count: chunks.length };
  try {
    for (let i = 0; i < chunks.length; i += 1) {
      await SecureStore.setItemAsync(chunkKey(key, next, i), chunks[i], OPTIONS);
    }
    // Publish: from here the new value is live. Until this succeeds the old value is untouched.
    await SecureStore.setItemAsync(countKey(key), `${next.generation}:${next.count}`, OPTIONS);
  } catch (error) {
    await deleteChunks(key, next); // best effort; the previous value stays the live one
    throw error;
  }
  if (previous) await deleteChunks(key, previous);
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

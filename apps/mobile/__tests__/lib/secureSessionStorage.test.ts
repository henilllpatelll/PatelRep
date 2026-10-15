const mockSecure = new Map<string, string>();
let mockSecureFailWrites = false;
let mockSecureFailReads = false;
const mockLegacy = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(async (key: string) => {
    if (mockSecureFailReads) throw new Error("keystore unavailable");
    return mockSecure.has(key) ? (mockSecure.get(key) as string) : null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockSecureFailWrites) throw new Error("keystore write failed");
    // The real limit is ~2 KB; make exceeding it a hard failure so the test proves chunking.
    if (value.length > 2048) throw new Error("value too large for SecureStore");
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecure.delete(key);
  }),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => (mockLegacy.has(key) ? (mockLegacy.get(key) as string) : null)),
    setItem: jest.fn(async (key: string, value: string) => {
      mockLegacy.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockLegacy.delete(key);
    }),
  },
}));

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import storage, { CHUNK_SIZE } from "@/lib/auth/secureSessionStorage";

const KEY = "sb-test-auth-token";
const bigSession = JSON.stringify({ access_token: "a".repeat(2600), refresh_token: "r".repeat(40), user: { id: "u1", meta: "m".repeat(1500) } });

beforeEach(() => {
  mockSecure.clear();
  mockLegacy.clear();
  mockSecureFailWrites = false;
  mockSecureFailReads = false;
  Platform.OS = "ios";
  jest.clearAllMocks();
});

describe("secureSessionStorage", () => {
  it("stores a session larger than SecureStore's limit in chunks and reads it back identically", async () => {
    expect(bigSession.length).toBeGreaterThan(4000);
    await storage.setItem(KEY, bigSession);

    for (const [, value] of mockSecure) expect(value.length).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(mockSecure.get(`${KEY}.n`)).toBe(String(Math.ceil(bigSession.length / CHUNK_SIZE)));
    expect(await storage.getItem(KEY)).toBe(bigSession);
    // Never written to plaintext storage.
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("drops stale trailing chunks when the value shrinks, and removeItem clears everything", async () => {
    await storage.setItem(KEY, bigSession);
    await storage.setItem(KEY, "short");
    expect(await storage.getItem(KEY)).toBe("short");
    expect([...mockSecure.keys()].filter((k) => k.startsWith(`${KEY}.`)).sort()).toEqual([`${KEY}.0`, `${KEY}.n`]);

    await storage.removeItem(KEY);
    expect(mockSecure.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("migrates a session from an older build without signing the person out", async () => {
    mockLegacy.set(KEY, bigSession);

    expect(await storage.getItem(KEY)).toBe(bigSession);

    // Moved to the secure store and removed from plaintext only after it read back identically.
    expect(mockSecure.get(`${KEY}.n`)).toBeDefined();
    expect(mockLegacy.has(KEY)).toBe(false);
    expect(await storage.getItem(KEY)).toBe(bigSession);
  });

  it("keeps the legacy session working (and retries later) if the secure store cannot be written", async () => {
    mockLegacy.set(KEY, bigSession);
    mockSecureFailWrites = true;

    expect(await storage.getItem(KEY)).toBe(bigSession);
    expect(mockLegacy.get(KEY)).toBe(bigSession);

    mockSecureFailWrites = false;
    expect(await storage.getItem(KEY)).toBe(bigSession);
    expect(mockLegacy.has(KEY)).toBe(false);
  });

  it("does not delete the legacy copy while the secure store is unreadable", async () => {
    mockLegacy.set(KEY, bigSession);
    mockSecureFailReads = true;
    expect(await storage.getItem(KEY)).toBe(bigSession);
    expect(mockLegacy.get(KEY)).toBe(bigSession);
  });

  it("treats a damaged secure copy as absent rather than returning half a session", async () => {
    await storage.setItem(KEY, bigSession);
    mockSecure.delete(`${KEY}.1`);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("refuses to fall back to plaintext when a secure write fails", async () => {
    mockSecureFailWrites = true;
    await expect(storage.setItem(KEY, bigSession)).rejects.toThrow();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(mockLegacy.size).toBe(0);
  });

  it("passes straight through to AsyncStorage on web (no Keychain exists there)", async () => {
    Platform.OS = "web";
    await storage.setItem(KEY, "v");
    expect(mockLegacy.get(KEY)).toBe("v");
    expect(mockSecure.size).toBe(0);
  });

  it("never logs session values", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    mockSecureFailWrites = true;
    await storage.setItem(KEY, bigSession).catch(() => undefined);
    mockSecureFailWrites = false;
    mockLegacy.set(KEY, bigSession);
    await storage.getItem(KEY);
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("aaaaaaaaaa");
      spy.mockRestore();
    }
  });
});

describe("real Supabase session serialization", () => {
  function jwt(payload: Record<string, unknown>) {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.${"s".repeat(43)}`;
  }

  function tokenResponse() {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = jwt({
      sub: "user-1",
      exp,
      hotel_id: "h".repeat(36),
      user_role: "housekeeper",
      app_metadata: { providers: ["email"], notes: "n".repeat(1800) },
    });
    return {
      access_token: access,
      refresh_token: "refresh-token-value",
      expires_in: 3600,
      expires_at: exp,
      token_type: "bearer",
      user: { id: "user-1", aud: "authenticated", email: "a@b.co", app_metadata: { providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    };
  }

  function client() {
    return createClient("http://localhost:1", "anon", {
      auth: { storage, flowType: "pkce", autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
      global: {
        fetch: (async () =>
          new Response(JSON.stringify(tokenResponse()), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
      },
    });
  }

  it("persists a real password session across chunked secure storage and restores it for a new client (app restart)", async () => {
    const first = client();
    const { error } = await first.auth.signInWithPassword({ email: "a@b.co", password: "pw-long-enough" });
    expect(error).toBeNull();

    const stored = [...mockSecure.entries()].filter(([k]) => k.startsWith("sb-") && !k.endsWith(".n"));
    expect(stored.length).toBeGreaterThan(1);
    for (const [, v] of stored) expect(v.length).toBeLessThanOrEqual(CHUNK_SIZE);

    // "Restart": a brand-new client sharing nothing but the persisted storage.
    const second = client();
    const {
      data: { session },
    } = await second.auth.getSession();
    expect(session?.user.id).toBe("user-1");
    expect(session?.refresh_token).toBe("refresh-token-value");
    expect(session?.access_token.length).toBeGreaterThan(2000);
  });

  it("migrates and restores a legacy AsyncStorage session on first launch of the new build", async () => {
    const first = client();
    await first.auth.signInWithPassword({ email: "a@b.co", password: "pw-long-enough" });
    const key = [...mockSecure.keys()].find((k) => k.endsWith("-auth-token.n"))!.replace(/\.n$/, "");
    const serialized = (await storage.getItem(key)) as string;
    await storage.removeItem(key);
    mockLegacy.set(key, serialized);

    const upgraded = client();
    const {
      data: { session },
    } = await upgraded.auth.getSession();
    expect(session?.user.id).toBe("user-1");
    expect(mockLegacy.has(key)).toBe(false);
  });
});

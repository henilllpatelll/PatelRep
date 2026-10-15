const mockSecure = new Map<string, string>();
let mockFailWrite = false;

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(async (k: string) => (mockSecure.has(k) ? (mockSecure.get(k) as string) : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockFailWrite) throw new Error("write failed");
    mockSecure.set(k, v);
  }),
}));

import { runWithoutAppLock, useAppLockStore } from "@/stores/appLockStore";
import { loadAppLockPrefs, LOCK_TIMEOUTS_MS } from "@/lib/security/appLockPrefs";

const store = () => useAppLockStore.getState();
let now = 1_000_000;

beforeEach(() => {
  mockSecure.clear();
  mockFailWrite = false;
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  store().reset();
});
afterEach(() => jest.restoreAllMocks());

async function enable(timeoutMs: (typeof LOCK_TIMEOUTS_MS)[number], userId = "u1") {
  await store().hydrate(userId);
  await store().setEnabled(true);
  await store().setTimeoutMs(timeoutMs);
}

describe("lock policy", () => {
  it("never locks when the feature is off", async () => {
    await store().hydrate("u1");
    store().onBackground();
    now += 24 * 3_600_000;
    store().onForeground();
    store().checkIdle();
    expect(store().locked).toBe(false);
    expect(store().obscured).toBe(false);
  });

  it("locks after being away for at least the chosen time, not before", async () => {
    await enable(300_000);
    store().onBackground();
    now += 299_999;
    store().onForeground();
    expect(store().locked).toBe(false);

    store().onBackground();
    now += 300_000;
    store().onForeground();
    expect(store().locked).toBe(true);
  });

  it("'Immediately' locks on any trip to the background", async () => {
    await enable(0);
    store().onBackground();
    now += 1;
    store().onForeground();
    expect(store().locked).toBe(true);
  });

  it("only covers the screen (no lock) for a brief 'inactive' blip such as the notification shade", async () => {
    await enable(0);
    store().onInactive();
    expect(store().obscured).toBe(true);
    store().onForeground();
    expect(store().obscured).toBe(false);
    expect(store().locked).toBe(false);
  });

  it("covers the app switcher snapshot while backgrounded and uncovers on return", async () => {
    await enable(900_000);
    store().onBackground();
    expect(store().obscured).toBe(true);
    now += 1000;
    store().onForeground();
    expect(store().obscured).toBe(false);
    expect(store().locked).toBe(false);
  });

  it("locks after foreground idling for the chosen time, never for 'Immediately'", async () => {
    await enable(60_000);
    now += 59_000;
    store().checkIdle();
    expect(store().locked).toBe(false);
    store().touch();
    now += 59_000;
    store().checkIdle();
    expect(store().locked).toBe(false);
    now += 2_000;
    store().checkIdle();
    expect(store().locked).toBe(true);

    store().unlock();
    await store().setTimeoutMs(0);
    now += 10 * 3_600_000;
    store().checkIdle();
    expect(store().locked).toBe(false);
  });

  it("ignores touches while locked so activity cannot unlock or extend anything", async () => {
    await enable(60_000);
    store().lock();
    const before = store().lastActivityAt;
    now += 5000;
    store().touch();
    expect(store().lastActivityAt).toBe(before);
    expect(store().locked).toBe(true);
  });

  it("our own system prompts (biometric, picker, camera) do not count as leaving the app", async () => {
    await enable(0);
    await runWithoutAppLock(async () => {
      store().onInactive();
      store().onBackground();
      now += 60_000;
      store().onForeground();
    });
    expect(store().locked).toBe(false);
    expect(store().obscured).toBe(false);
    expect(store().suppressDepth).toBe(0);
  });

  it("restores suppression depth even if the wrapped work throws", async () => {
    await enable(0);
    await expect(runWithoutAppLock(async () => Promise.reject(new Error("picker failed")))).rejects.toThrow("picker failed");
    expect(store().suppressDepth).toBe(0);
  });
});

describe("cold start and persistence", () => {
  it("locks on cold start when the person had enabled the lock, and keeps their choices", async () => {
    await enable(900_000);
    store().reset();

    await store().hydrate("u1");
    expect(store().enabled).toBe(true);
    expect(store().timeoutMs).toBe(900_000);
    expect(store().locked).toBe(true);
  });

  it("does not lock right after a fresh sign-in (they just proved who they are)", async () => {
    await enable(60_000);
    store().reset();
    store().markFreshSignIn();
    await store().hydrate("u1");
    expect(store().locked).toBe(false);
  });

  it("clears a lock a faster hydrate already applied when the sign-in completes", async () => {
    await enable(60_000);
    store().reset();
    await store().hydrate("u1");
    expect(store().locked).toBe(true);
    store().markFreshSignIn();
    expect(store().locked).toBe(false);
  });

  it("keeps each employee's choice separate on a shared phone", async () => {
    await enable(0, "alice");
    store().reset();
    await store().hydrate("bob");
    expect(store().enabled).toBe(false);
    expect(store().locked).toBe(false);
    expect(await loadAppLockPrefs("alice")).toEqual({ enabled: true, timeoutMs: 0 });
  });

  it("does not report the lock as enabled if saving the preference failed", async () => {
    await store().hydrate("u1");
    mockFailWrite = true;
    await expect(store().setEnabled(true)).rejects.toThrow();
    expect(store().enabled).toBe(false);
  });

  it("falls back to safe defaults for corrupt stored preferences", async () => {
    mockSecure.set("patelrep.applock.v1.u1", JSON.stringify({ enabled: "yes", timeoutMs: 42 }));
    expect(await loadAppLockPrefs("u1")).toEqual({ enabled: false, timeoutMs: 60_000 });
    mockSecure.set("patelrep.applock.v1.u1", "not json");
    expect(await loadAppLockPrefs("u1")).toEqual({ enabled: false, timeoutMs: 60_000 });
  });

  it("reset (sign-out) clears in-memory lock state", async () => {
    await enable(0);
    store().lock();
    store().reset();
    expect(store().locked).toBe(false);
    expect(store().enabled).toBe(false);
    expect(store().userId).toBeNull();
  });
});

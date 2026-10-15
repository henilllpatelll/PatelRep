import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deviceLanguage,
  normalizeLanguage,
  parseLocalRecord,
  resolveLanguage,
  userLanguageKey,
} from "@/lib/language/languagePreference";

let mockI18nLanguage = "en";
const mockChangeLanguage = jest.fn(async (next: string) => {
  mockI18nLanguage = next;
});
jest.mock("@/i18n", () => ({
  __esModule: true,
  default: {
    get language() {
      return mockI18nLanguage;
    },
    changeLanguage: (next: string) => mockChangeLanguage(next),
  },
}));

type UpdateResult = { data: { id: string }[] | null; error: { message: string } | null };
let mockUpdateResult: UpdateResult | Promise<UpdateResult> | Error;
const mockUpdate = jest.fn();
const mockEq = jest.fn();
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        mockUpdate(payload);
        return {
          eq: (col: string, id: string) => {
            mockEq(col, id);
            return {
              select: async () => {
                if (mockUpdateResult instanceof Error) throw mockUpdateResult;
                return mockUpdateResult;
              },
            };
          },
        };
      },
    }),
  },
}));

let mockUser: { id: string; language_pref: string } | null = null;
const mockSetUser = jest.fn((u: typeof mockUser) => {
  mockUser = u;
});
jest.mock("@/stores/appStore", () => ({
  useAppStore: { getState: () => ({ user: mockUser, setUser: mockSetUser }) },
}));

import {
  clearActiveLanguageUser,
  hydrateLanguageForUser,
  restoreDeviceLanguage,
  retryPendingLanguageSync,
  selectLanguage,
  useLanguageSyncStore,
} from "@/lib/language/languageSync";

const OK: UpdateResult = { data: [{ id: "a" }], error: null };

async function stored(userId: string) {
  return parseLocalRecord(await AsyncStorage.getItem(userLanguageKey(userId)));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockI18nLanguage = "en";
  mockUser = null;
  mockUpdateResult = OK;
  [mockChangeLanguage, mockUpdate, mockEq, mockSetUser].forEach((m) => m.mockClear());
  clearActiveLanguageUser();
});

describe("language preference rules", () => {
  it("accepts only English and Spanish, with or without a region", () => {
    expect(normalizeLanguage("es")).toBe("es");
    expect(normalizeLanguage("es-MX")).toBe("es");
    expect(normalizeLanguage("EN_us")).toBe("en");
    expect(normalizeLanguage("fr")).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(42)).toBeNull();
  });

  it("reads a corrupted local record as absent", () => {
    expect(parseLocalRecord("{not json")).toBeNull();
    expect(parseLocalRecord(JSON.stringify({ value: "de" }))).toBeNull();
    expect(parseLocalRecord(JSON.stringify({ value: "es", pending: true, updatedAt: 5 }))).toEqual({
      value: "es",
      pending: true,
      updatedAt: 5,
    });
  });

  it("resolves: unconfirmed local choice > account > cached > device > English", () => {
    const cached = { value: "es" as const, pending: false, updatedAt: 1 };
    expect(resolveLanguage({ local: { ...cached, pending: true }, remote: "en", device: "en" })).toBe("es");
    expect(resolveLanguage({ local: cached, remote: "en", device: "es" })).toBe("en");
    expect(resolveLanguage({ local: cached, remote: null, device: "en" })).toBe("es");
    expect(resolveLanguage({ local: null, remote: undefined, device: "es" })).toBe("es");
    expect(resolveLanguage({ local: null, remote: "xx", device: null })).toBe("en");
  });

  it("reads the device language from the runtime locale", () => {
    const spy = jest
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ locale: "es-US" } as Intl.ResolvedDateTimeFormatOptions);
    expect(deviceLanguage()).toBe("es");
    spy.mockRestore();
  });
});

describe("language persistence and sync", () => {
  it("applies the pick immediately, keeps it for that person, and clears pending only after the server confirms", async () => {
    mockUser = { id: "emp-a", language_pref: "en" };
    await selectLanguage("emp-a", "es");

    expect(mockI18nLanguage).toBe("es");
    expect(mockUpdate).toHaveBeenCalledWith({ language_pref: "es" });
    expect(mockEq).toHaveBeenCalledWith("id", "emp-a");
    expect((await stored("emp-a"))?.pending).toBe(false);
    expect(useLanguageSyncStore.getState().syncState).toBe("idle");
    expect(mockSetUser).toHaveBeenCalledWith({ id: "emp-a", language_pref: "es" });
  });

  it("treats a returned Supabase error as a failed save and keeps the choice pending", async () => {
    mockUser = { id: "emp-a", language_pref: "en" };
    mockUpdateResult = { data: null, error: { message: "permission denied" } };
    await selectLanguage("emp-a", "es");

    expect(mockI18nLanguage).toBe("es"); // still usable
    expect((await stored("emp-a"))?.pending).toBe(true);
    expect(useLanguageSyncStore.getState().syncState).toBe("failed");
  });

  it("treats an update that touched no rows as not saved", async () => {
    mockUser = { id: "emp-a", language_pref: "en" };
    mockUpdateResult = { data: [], error: null };
    await selectLanguage("emp-a", "es");
    expect(useLanguageSyncStore.getState().syncState).toBe("failed");
    expect((await stored("emp-a"))?.pending).toBe(true);
  });

  it("treats a network throw as not saved, then confirms on retry", async () => {
    mockUser = { id: "emp-a", language_pref: "en" };
    mockUpdateResult = new Error("Network request failed");
    await selectLanguage("emp-a", "es");
    expect(useLanguageSyncStore.getState().syncState).toBe("failed");

    mockUpdateResult = OK;
    await retryPendingLanguageSync();
    expect((await stored("emp-a"))?.pending).toBe(false);
    expect(useLanguageSyncStore.getState().syncState).toBe("idle");
  });

  it("an older save finishing late cannot clear or overwrite a newer choice", async () => {
    mockUser = { id: "emp-a", language_pref: "en" };
    let release!: (r: UpdateResult) => void;
    mockUpdateResult = new Promise<UpdateResult>((resolve) => {
      release = resolve;
    });
    const first = selectLanguage("emp-a", "es");
    await new Promise((r) => setTimeout(r, 0));

    mockUpdateResult = { data: null, error: { message: "offline" } };
    await new Promise((r) => setTimeout(r, 2)); // make the second choice a later timestamp
    await selectLanguage("emp-a", "en");
    release(OK);
    await first;

    expect(mockI18nLanguage).toBe("en");
    const record = await stored("emp-a");
    expect(record).toMatchObject({ value: "en", pending: true });
    expect(useLanguageSyncStore.getState().syncState).toBe("failed");
  });

  it("restores a pending choice after restart and does not let older server data override it", async () => {
    await AsyncStorage.setItem(
      userLanguageKey("emp-a"),
      JSON.stringify({ value: "es", pending: true, updatedAt: 10 }),
    );
    mockUser = { id: "emp-a", language_pref: "en" };

    const applied = await hydrateLanguageForUser("emp-a", "en");
    expect(applied).toBe("es");
    expect(mockI18nLanguage).toBe("es");
    await new Promise((r) => setTimeout(r, 0));
    expect(mockUpdate).toHaveBeenCalledWith({ language_pref: "es" }); // retried on sign-in
  });

  it("restores the account language at sign-in, then uses the cached one offline", async () => {
    await hydrateLanguageForUser("emp-a", "es");
    expect(mockI18nLanguage).toBe("es");
    expect((await stored("emp-a"))?.value).toBe("es");
    expect(mockUpdate).not.toHaveBeenCalled(); // hydration never writes to the server

    mockI18nLanguage = "en";
    await hydrateLanguageForUser("emp-a", null); // profile unavailable
    expect(mockI18nLanguage).toBe("es");
  });

  it("keeps two employees on one phone separate and never pushes under the wrong account", async () => {
    mockUser = { id: "emp-a", language_pref: "en" };
    mockUpdateResult = { data: null, error: { message: "offline" } };
    await selectLanguage("emp-a", "es"); // A's choice stays pending

    clearActiveLanguageUser(); // A signs out
    mockUser = { id: "emp-b", language_pref: "en" };
    mockUpdate.mockClear();
    const applied = await hydrateLanguageForUser("emp-b", "en");

    expect(applied).toBe("en");
    expect(mockI18nLanguage).toBe("en");
    expect(mockUpdate).not.toHaveBeenCalled(); // nothing of A's is sent as B
    expect((await stored("emp-a"))).toMatchObject({ value: "es", pending: true });
    expect(await stored("emp-b")).toMatchObject({ value: "en", pending: false });

    // A signs back in: A's own choice returns and is retried for A.
    clearActiveLanguageUser();
    mockUser = { id: "emp-a", language_pref: "en" };
    mockUpdateResult = OK;
    expect(await hydrateLanguageForUser("emp-a", "en")).toBe("es");
    await new Promise((r) => setTimeout(r, 0));
    expect(mockEq).toHaveBeenLastCalledWith("id", "emp-a");
  });

  it("a slow profile load for the previous person cannot override the current person", async () => {
    const slow = hydrateLanguageForUser("emp-a", "es");
    const fast = hydrateLanguageForUser("emp-b", "en");
    await Promise.all([slow, fast]);
    expect(mockI18nLanguage).toBe("en");
  });

  it("before sign-in shows the phone's last language, else the device language", async () => {
    await AsyncStorage.setItem("@patelrep/mobile/language-last", "es");
    await restoreDeviceLanguage();
    expect(mockI18nLanguage).toBe("es");
  });

  it("falls back safely when storage is unavailable", async () => {
    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValue(new Error("disk"));
    const applied = await hydrateLanguageForUser("emp-a", "es");
    expect(applied).toBe("es");
    spy.mockRestore();
  });
});

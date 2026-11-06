import fs from "fs";
import path from "path";
import React from "react";
import { Text } from "react-native";
import { act, render } from "@testing-library/react-native";

let mockMode: "light" | "dark" = "light";
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockMode }));
jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/api/client", () => ({
  ApiError: class extends Error {},
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/auth/secureSessionStorage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

import { api } from "@/lib/api/client";
import { darkTheme, lightTheme } from "@/components/shared/tokens";
import { darkThemeV2, lightThemeV2 } from "@/components/shared/tokensV2";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { isDesignV2Enabled, isDesignV2PreviewEnabled, resolveDesignV2Preview } from "@/lib/design/designV2";
import {
  DESIGN_V2_CONTEXT_MAX_AGE_MS,
  DESIGN_V2_FLAG,
  designV2OwnerKey,
  resolveTenantDesignV2,
  useDesignV2Store,
} from "@/lib/design/designV2Store";
import { isV2SurfaceRole } from "@/lib/design/housekeeperV2";
import { refreshDesignV2, refreshDesignV2IfDue, readDesignV2Flag, resetDesignV2SyncForTests } from "@/lib/design/useDesignV2Sync";
import { useDesignV2Active } from "@/lib/design/useDesignV2Active";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile, UserRole } from "@/lib/supabase";

const ROLES: UserRole[] = ["housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm"];
const MOBILE_ROOT = path.resolve(__dirname, "../../..");

const user = (id: string, tenant: string, role: UserRole = "gm"): UserProfile =>
  ({ id, tenant_id: tenant, role, full_name: "Test", language_pref: "en" }) as UserProfile;
const me = (hotelId: string, features: unknown) => ({ hotel: { id: hotelId, enabled_features: features } });
const get = api.get as jest.Mock;

function Probe({ role }: { role?: string }) {
  const active = useDesignV2Active();
  return (
    <DesignV2Scope enabled={isV2SurfaceRole(role ?? "gm")}>
      <ThemeProbe active={active} />
    </DesignV2Scope>
  );
}
function ThemeProbe({ active }: { active: boolean }) {
  const theme = useTheme();
  return <Text testID="probe">{`${active ? "active" : "inactive"}|${theme.primary}`}</Text>;
}
const probe = (r: ReturnType<typeof render>) => String(r.getByTestId("probe").props.children);

beforeEach(() => {
  mockMode = "light";
  get.mockReset();
  (api.post as jest.Mock).mockReset();
  resetDesignV2SyncForTests();
  useDesignV2Store.getState().clear();
  useAppStore.getState().setUser(null);
});

describe("tenant decision (pure)", () => {
  const base = { ownerKey: "A:u1", enabled: true, fetchedAt: 1_000_000 };
  it("default OFF: nothing known", () => {
    expect(resolveTenantDesignV2({ ownerKey: null, enabled: false, fetchedAt: null }, "A:u1", 1_000_001)).toBe(false);
    expect(resolveTenantDesignV2({ ...base, enabled: false }, "A:u1", 1_000_001)).toBe(false);
    expect(resolveTenantDesignV2({ ...base, fetchedAt: null }, "A:u1", 1_000_001)).toBe(false);
  });
  it("ON only for the owner it was read for, and only while fresh", () => {
    expect(resolveTenantDesignV2(base, "A:u1", 1_000_001)).toBe(true);
    expect(resolveTenantDesignV2(base, "B:u1", 1_000_001)).toBe(false);
    expect(resolveTenantDesignV2(base, "A:u2", 1_000_001)).toBe(false);
    expect(resolveTenantDesignV2(base, null, 1_000_001)).toBe(false);
    expect(resolveTenantDesignV2(base, "A:u1", 1_000_000 + DESIGN_V2_CONTEXT_MAX_AGE_MS)).toBe(true);
    expect(resolveTenantDesignV2(base, "A:u1", 1_000_000 + DESIGN_V2_CONTEXT_MAX_AGE_MS + 1)).toBe(false);
    expect(resolveTenantDesignV2(base, "A:u1", 999_999)).toBe(false);
  });
  it("owner key needs both tenant and user", () => {
    expect(designV2OwnerKey({ id: "u", tenant_id: "t" })).toBe("t:u");
    expect(designV2OwnerKey({ id: "u" })).toBeNull();
    expect(designV2OwnerKey(null)).toBeNull();
  });
});

describe("reading the flag (existing /auth/me contract, no second source of truth)", () => {
  it("enabled / disabled / missing flag", async () => {
    expect(await readDesignV2Flag("A", async () => me("A", [DESIGN_V2_FLAG, "hk_ai_assistant"]))).toBe("enabled");
    expect(await readDesignV2Flag("A", async () => me("A", ["hk_ai_assistant"]))).toBe("disabled");
    expect(await readDesignV2Flag("A", async () => me("A", []))).toBe("disabled");
  });
  it("failure, another hotel's record or a malformed body is unknown, never a decision", async () => {
    expect(await readDesignV2Flag("A", async () => Promise.reject(new Error("offline")))).toBe("unknown");
    expect(await readDesignV2Flag("A", async () => me("B", [DESIGN_V2_FLAG]))).toBe("unknown");
    expect(await readDesignV2Flag("A", async () => ({ hotel: null }))).toBe("unknown");
    expect(await readDesignV2Flag("A", async () => me("A", undefined))).toBe("unknown");
    expect(await readDesignV2Flag("A", async () => me("A", "design_v2"))).toBe("unknown");
  });
  it("calls only GET /auth/me: no AI route, no write", async () => {
    get.mockResolvedValue(me("A", [DESIGN_V2_FLAG]));
    useAppStore.getState().setUser(user("u1", "A"));
    await refreshDesignV2();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe("/auth/me");
    expect(api.post).not.toHaveBeenCalled();
    expect(String(get.mock.calls.map((c) => c[0]))).not.toMatch(/\/ai\//);
  });
});

describe("refresh lifecycle", () => {
  it("default OFF before any read, even when signed in", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("flag ON, then OFF after a refresh (rollback), then ON again", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    expect(await refreshDesignV2()).toBe(true);
    expect(isDesignV2Enabled()).toBe(true);
    get.mockResolvedValueOnce(me("A", []));
    expect(await refreshDesignV2()).toBe(true);
    expect(isDesignV2Enabled()).toBe(false);
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    await refreshDesignV2();
    expect(isDesignV2Enabled()).toBe(true);
  });

  it("API failure after ON keeps the last answer only until it ages out", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const readAt = Date.now() - 5 * 60 * 1000;
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    await refreshDesignV2({ now: () => readAt });
    get.mockRejectedValueOnce(new Error("offline"));
    expect(await refreshDesignV2()).toBe(false);
    expect(isDesignV2Enabled(readAt + 5 * 60 * 1000)).toBe(true);
    expect(isDesignV2Enabled(readAt + DESIGN_V2_CONTEXT_MAX_AGE_MS + 1)).toBe(false);
  });

  it("API failure from the start: legacy", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    get.mockRejectedValueOnce(new Error("500"));
    await refreshDesignV2();
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("two hotels with opposite states stay independent (hotel switching)", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    await refreshDesignV2();
    expect(isDesignV2Enabled()).toBe(true);
    // Same person, other hotel: the answer for A is gone at once and B has not been read yet.
    useAppStore.getState().setUser(user("u1", "B"));
    expect(isDesignV2Enabled()).toBe(false);
    get.mockResolvedValueOnce(me("B", []));
    await refreshDesignV2();
    expect(isDesignV2Enabled()).toBe(false);
    useAppStore.getState().setUser(user("u1", "A"));
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("account switching never shows the previous person's design", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    await refreshDesignV2();
    expect(isDesignV2Enabled()).toBe(true);
    useAppStore.getState().setUser(user("u2", "A"));
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("login and logout: sign-out clears at once, signing back in does not resurrect it", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    await refreshDesignV2();
    useAppStore.getState().setUser(null);
    expect(isDesignV2Enabled()).toBe(false);
    expect(useDesignV2Store.getState().ownerKey).toBeNull();
    useAppStore.getState().setUser(user("u1", "A"));
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("effective-role updates for the same person and hotel keep the answer", async () => {
    const base = user("u1", "A");
    useAppStore.getState().setUser(base);
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    await refreshDesignV2();
    useAppStore.getState().setUser({ ...base, effective_role: "housekeeper" });
    expect(isDesignV2Enabled()).toBe(true);
  });

  it("a slow answer for the previous person is discarded", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    let release: (v: unknown) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const pending = refreshDesignV2();
    useAppStore.getState().setUser(user("u2", "B"));
    release(me("A", [DESIGN_V2_FLAG]));
    expect(await pending).toBe(false);
    expect(isDesignV2Enabled()).toBe(false);
  });

  it("foreground/reconnect refresh is single-flight and rate-limit friendly", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    get.mockResolvedValue(me("A", [DESIGN_V2_FLAG]));
    const now = Date.now();
    const first = refreshDesignV2IfDue(120_000, now);
    const second = refreshDesignV2IfDue(120_000, now);
    expect(second).toBe(first);
    await first;
    expect(await refreshDesignV2IfDue(120_000, now + 1000)).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(await refreshDesignV2IfDue(120_000, now + 121_000)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("a signed-out refresh does nothing", async () => {
    expect(await refreshDesignV2()).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("live re-render (nothing assumes the value is fixed for the session)", () => {
  it("re-themes the subtree when the flag turns ON and back OFF, without a remount", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(<Probe />);
    expect(probe(r)).toBe(`inactive|${lightTheme.primary}`);
    act(() => useDesignV2Store.getState().apply({ ownerKey: "A:u1", enabled: true, fetchedAt: Date.now() }));
    expect(probe(r)).toBe(`active|${lightThemeV2.primary}`);
    act(() => useDesignV2Store.getState().apply({ ownerKey: "A:u1", enabled: false, fetchedAt: Date.now() }));
    expect(probe(r)).toBe(`inactive|${lightTheme.primary}`);
  });

  it("drops back to legacy when an offline phone's last read ages out", () => {
    jest.useFakeTimers();
    try {
      useAppStore.getState().setUser(user("u1", "A"));
      const r = render(<Probe />);
      act(() => useDesignV2Store.getState().apply({ ownerKey: "A:u1", enabled: true, fetchedAt: Date.now() }));
      expect(probe(r)).toMatch(/^active/);
      act(() => {
        jest.advanceTimersByTime(DESIGN_V2_CONTEXT_MAX_AGE_MS + 1000);
      });
      expect(probe(r)).toBe(`inactive|${lightTheme.primary}`);
    } finally {
      jest.useRealTimers();
    }
  });

  it("sign-out re-themes to legacy immediately", () => {
    useAppStore.getState().setUser(user("u1", "A"));
    const r = render(<Probe />);
    act(() => useDesignV2Store.getState().apply({ ownerKey: "A:u1", enabled: true, fetchedAt: Date.now() }));
    expect(probe(r)).toMatch(/^active/);
    act(() => useAppStore.getState().setUser(null));
    expect(probe(r)).toMatch(/^inactive/);
  });

  describe.each(ROLES)("role %s", (role) => {
    it.each(["light", "dark"] as const)("flag ON uses V2 tokens, flag OFF the legacy tokens (%s)", (mode) => {
      mockMode = mode;
      useAppStore.getState().setUser(user("u1", "A", role));
      const r = render(<Probe role={role} />);
      expect(probe(r)).toBe(`inactive|${(mode === "dark" ? darkTheme : lightTheme).primary}`);
      act(() => useDesignV2Store.getState().apply({ ownerKey: "A:u1", enabled: true, fetchedAt: Date.now() }));
      expect(probe(r)).toBe(`active|${(mode === "dark" ? darkThemeV2 : lightThemeV2).primary}`);
      act(() => useDesignV2Store.getState().apply({ ownerKey: "A:u1", enabled: false, fetchedAt: Date.now() }));
      expect(probe(r)).toBe(`inactive|${(mode === "dark" ? darkTheme : lightTheme).primary}`);
    });
  });
});

describe("development preview isolation and production Expo/OTA safety", () => {
  it("the preview needs the flag and the Metro dev server or an explicit non-production environment", () => {
    expect(resolveDesignV2Preview("true", "development")).toBe(true);
    expect(resolveDesignV2Preview("true", "staging")).toBe(true);
    expect(resolveDesignV2Preview("true", "test")).toBe(true);
    expect(resolveDesignV2Preview("true", "production")).toBe(false);
    expect(resolveDesignV2Preview("true", undefined, true)).toBe(true);
    expect(resolveDesignV2Preview("false", "development", true)).toBe(false);
  });

  it("an OTA bundle exported with the preview flag and no environment cannot enable V2 for installed apps", () => {
    // A hand-run `eas update` does not get the build profile's env: flag set, EXPO_PUBLIC_APP_ENV unset, __DEV__ false.
    expect(resolveDesignV2Preview("true", undefined, false)).toBe(false);
    expect(resolveDesignV2Preview("true", "", false)).toBe(false);
  });

  it("no preview flag in this test run, so the tenant path is the only way V2 can turn on", () => {
    expect(isDesignV2PreviewEnabled()).toBe(false);
  });

  it("the tenant flag never turns on the preview-only route", async () => {
    useAppStore.getState().setUser(user("u1", "A"));
    get.mockResolvedValueOnce(me("A", [DESIGN_V2_FLAG]));
    await refreshDesignV2();
    expect(isDesignV2Enabled()).toBe(true);
    expect(isDesignV2PreviewEnabled()).toBe(false);
  });

  it("EAS profiles: production declares itself production, none sets the preview flag", () => {
    const eas = JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, "eas.json"), "utf8"));
    expect(eas.build.production.env.EXPO_PUBLIC_APP_ENV).toBe("production");
    for (const profile of Object.values(eas.build) as Array<{ env?: Record<string, string> }>) {
      expect(profile.env ?? {}).not.toHaveProperty("EXPO_PUBLIC_DESIGN_V2_PREVIEW");
    }
  });

  it("no CI or release workflow sets the preview flag", () => {
    const dir = path.resolve(MOBILE_ROOT, "../../.github/workflows");
    for (const file of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, file), "utf8")).not.toMatch(/DESIGN_V2_PREVIEW/);
    }
  });
});

describe("wiring contracts (source)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(MOBILE_ROOT, rel), "utf8");
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(MOBILE_ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" ? [] : walk(rel);
      return /\.(ts|tsx)$/.test(e.name) ? [rel.replace(/\\/g, "/")] : [];
    });

  it("only the decision module and the live hook call isDesignV2Enabled() directly", () => {
    const offenders = ["app", "components", "lib", "stores"]
      .flatMap(walk)
      .filter((f) => /\bisDesignV2Enabled\(/.test(read(f)))
      .sort();
    expect(offenders).toEqual(
      [
        "lib/design/designV2.ts",
        "lib/design/useDesignV2Active.ts",
      ].sort(),
    );
  });

  it("the signed-in layout subscribes reactively and keeps the answer fresh", () => {
    const layout = read("app/(app)/_layout.tsx");
    expect(layout).toMatch(/useDesignV2Active\(\)/);
    expect(layout).toMatch(/useDesignV2Sync\(\)/);
    expect(layout).not.toMatch(/\bisDesignV2Enabled\(/);
  });

  it("sign-out and person/hotel changes clear the answer synchronously in the app store", () => {
    expect(read("stores/appStore.ts")).toMatch(/if \(changed \|\| !user\) useDesignV2Store\.getState\(\)\.clear\(\)/);
  });

  it("the flag grants nothing: no API client, route guard or permission module reads it", () => {
    for (const rel of ["lib/api/client.ts", "lib/auth/roles.ts", "lib/engineering/roles.ts"].filter((f) => fs.existsSync(path.join(MOBILE_ROOT, f)))) {
      expect(read(rel)).not.toMatch(/design_v2|designV2|DesignV2/);
    }
  });
});

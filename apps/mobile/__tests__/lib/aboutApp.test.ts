import fs from "fs";
import path from "path";
import { Linking } from "react-native";
import { getAppInfo, resetAppInfoCache, resolveAppInfo, shortUpdateId } from "@/lib/app/appInfo";
import { openExternalUrl, parseExternalUrl, readLegalLinks } from "@/lib/app/externalLinks";
import { RELEASE_NOTES, findReleaseNotes, formatReleaseDate, hasContent, localized, type ReleaseNote } from "@/lib/app/releaseNotes";
import { loadLicenses } from "@/lib/app/licenses";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

const root = path.resolve(__dirname, "../..");

describe("resolveAppInfo", () => {
  it("prefers the installed binary over the app config", () => {
    expect(resolveAppInfo({ nativeVersion: "2.1.0", nativeBuild: "45", configVersion: "1.0.0", configBuild: 1 })).toMatchObject({
      version: "2.1.0",
      build: "45",
    });
  });

  it("falls back to the config only when there is no native value, and never invents one", () => {
    expect(resolveAppInfo({ nativeVersion: null, configVersion: "1.0.0", configBuild: 7 })).toMatchObject({ version: "1.0.0", build: "7" });
    expect(resolveAppInfo({})).toEqual({ name: "PatelRep", version: null, build: null, updateId: null });
    expect(resolveAppInfo({ nativeVersion: "  ", nativeBuild: "" })).toMatchObject({ version: null, build: null });
  });

  it("reports an update id only for a downloaded OTA update, never for the embedded launch", () => {
    const base = { updatesEnabled: true, updateId: "0a1b2c3d-1111-2222-3333-444455556666" };
    expect(resolveAppInfo({ ...base, isEmbeddedLaunch: false }).updateId).toBe(base.updateId);
    expect(resolveAppInfo({ ...base, isEmbeddedLaunch: true }).updateId).toBeNull();
    expect(resolveAppInfo({ ...base, isEmbeddedLaunch: null }).updateId).toBeNull();
    expect(resolveAppInfo({ ...base, updatesEnabled: false, isEmbeddedLaunch: false }).updateId).toBeNull();
  });

  it("shortens the update id and keeps the version separate from it", () => {
    expect(shortUpdateId("0a1b2c3d-1111-2222-3333-444455556666")).toBe("0a1b2c3d");
    const info = resolveAppInfo({ nativeVersion: "1.0.0", updatesEnabled: true, isEmbeddedLaunch: false, updateId: "abcdef12-0000" });
    expect(info.version).toBe("1.0.0");
    expect(info.updateId).not.toBe(info.version);
  });

  it("does not throw when the native modules are unavailable", () => {
    resetAppInfoCache();
    expect(() => getAppInfo()).not.toThrow();
    // Memoised: one answer for the whole session, so every screen agrees.
    expect(getAppInfo()).toBe(getAppInfo());
  });
});

describe("one version source", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "__tests__", ".expo"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("is the only code that reads the version or build from the app config", () => {
    const offenders = [...sources(path.join(root, "app")), ...sources(path.join(root, "components")), ...sources(path.join(root, "lib"))]
      .filter((file) => path.relative(root, file).replace(/\\/g, "/") !== "lib/app/appInfo.ts")
      .filter((file) => /expoConfig\??\.(version|ios|android)|nativeApplicationVersion|nativeBuildVersion/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});

describe("parseExternalUrl", () => {
  it("accepts plain https addresses", () => {
    expect(parseExternalUrl("https://example.com/privacy")).toBe("https://example.com/privacy");
    expect(parseExternalUrl("  https://example.com  ")).toBe("https://example.com/");
  });

  it.each([
    ["http (not secure)", "http://example.com"],
    ["custom app scheme", "patelrep://profile/security"],
    ["javascript", "javascript:alert(1)"],
    ["tel", "tel:5551234"],
    ["file", "file:///etc/passwd"],
    ["credentials in the address", "https://user:pass@example.com"],
    ["no real host", "https://localhost"],
    ["not an address", "example.com/privacy"],
    ["empty", ""],
    ["too long", `https://example.com/${"a".repeat(3000)}`],
  ])("rejects %s", (_name, value) => {
    expect(parseExternalUrl(value)).toBeNull();
  });

  it("rejects values that are not text", () => {
    for (const value of [null, undefined, 42, {}, ["https://example.com"]]) expect(parseExternalUrl(value)).toBeNull();
  });
});

describe("openExternalUrl", () => {
  // Linking.openURL is already a jest.fn in the RN preset, so calls carry over unless cleared.
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("opens a valid address while online", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await expect(openExternalUrl("https://example.com/terms", true)).resolves.toBe("opened");
    expect(open).toHaveBeenCalledWith("https://example.com/terms");
  });

  it("never opens an invalid address, and says so", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await expect(openExternalUrl("patelrep://profile/security", true)).resolves.toBe("invalid");
    await expect(openExternalUrl(null, true)).resolves.toBe("invalid");
    expect(open).not.toHaveBeenCalled();
  });

  it("does not try the network page while offline", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await expect(openExternalUrl("https://example.com", false)).resolves.toBe("offline");
    expect(open).not.toHaveBeenCalled();
  });

  it("reports a failure to open instead of pretending it worked", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
    await expect(openExternalUrl("https://example.com", true)).resolves.toBe("failed");
  });
});

describe("readLegalLinks", () => {
  it("has no destinations until real ones are configured", () => {
    expect(readLegalLinks(undefined)).toEqual({ privacyPolicyUrl: null, termsOfServiceUrl: null });
    expect(readLegalLinks({})).toEqual({ privacyPolicyUrl: null, termsOfServiceUrl: null });
    const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
    expect(readLegalLinks(config.expo.extra)).toEqual({ privacyPolicyUrl: null, termsOfServiceUrl: null });
  });

  it("uses configured https addresses and drops invalid ones", () => {
    expect(readLegalLinks({ legal: { privacyPolicyUrl: "https://example.com/privacy", termsOfServiceUrl: "http://example.com/terms" } })).toEqual({
      privacyPolicyUrl: "https://example.com/privacy",
      termsOfServiceUrl: null,
    });
  });
});

describe("release notes", () => {
  const note: ReleaseNote = {
    version: "1.2.0",
    date: "2026-11-02",
    features: [{ en: "Report a problem from Settings", es: "Reporta un problema desde Ajustes" }],
    fixes: [{ en: "Photos upload again", es: "Las fotos se suben de nuevo" }],
  };

  it("finds notes only for the exact installed version", () => {
    expect(findReleaseNotes("1.2.0", [note])).toBe(note);
    expect(findReleaseNotes("1.2.1", [note])).toBeNull();
    expect(findReleaseNotes(null, [note])).toBeNull();
  });

  it("treats an entry with no lines as no release notes", () => {
    expect(hasContent({ version: "1.2.0", features: [], fixes: [] })).toBe(false);
    expect(findReleaseNotes("1.2.0", [{ version: "1.2.0", improvements: [] }])).toBeNull();
  });

  it("shows text in the person's language, falling back to English", () => {
    expect(localized(note.features![0], "es")).toBe("Reporta un problema desde Ajustes");
    expect(localized(note.features![0], "en")).toBe("Report a problem from Settings");
    expect(localized({ en: "Only English", es: "" }, "es")).toBe("Only English");
  });

  it("formats real dates and rejects made-up ones", () => {
    expect(formatReleaseDate("2026-11-02", "en")).toMatch(/November 2, 2026/);
    expect(formatReleaseDate("2026-11-02", "es")).toMatch(/noviembre/i);
    expect(formatReleaseDate("2026-13-45", "en")).toBeNull();
    expect(formatReleaseDate("2026-02-30", "en")).toBeNull();
    expect(formatReleaseDate("yesterday", "en")).toBeNull();
    expect(formatReleaseDate(undefined, "en")).toBeNull();
  });

  it("keeps every bundled entry honest: real version, real date, both languages, no repeats", () => {
    const seen = new Set<string>();
    for (const entry of RELEASE_NOTES) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(seen.has(entry.version)).toBe(false);
      seen.add(entry.version);
      if (entry.date) expect(formatReleaseDate(entry.date, "en")).not.toBeNull();
      expect(hasContent(entry)).toBe(true);
      for (const line of [...(entry.features ?? []), ...(entry.improvements ?? []), ...(entry.fixes ?? [])]) {
        expect(line.en.trim()).not.toBe("");
        expect(line.es.trim()).not.toBe("");
        // Employee-facing wording: no commit hashes or conventional-commit prefixes.
        expect(line.en).not.toMatch(/\b[0-9a-f]{7,40}\b|^(feat|fix|chore)(\(|:)/i);
      }
    }
  });
});

describe("open-source license notices", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packages = loadLicenses();

  it("lists every package PatelRep ships directly, and nothing it does not", () => {
    expect(packages.map((p) => p.name).sort()).toEqual(Object.keys(pkg.dependencies).sort());
  });

  it("names a version and a license for every package, with the real text where the package ships one", () => {
    for (const entry of packages) {
      expect(entry.version).toMatch(/^\d/);
      expect(entry.license).toBeTruthy();
      if (entry.text) expect(entry.text.length).toBeGreaterThan(200);
    }
    expect(packages.filter((p) => !p.text).map((p) => p.name)).toEqual(["expo-router", "expo-updates"]);
  });

  it("carries the font license for the bundled typefaces", () => {
    const fonts = packages.filter((p) => p.name.startsWith("@expo-google-fonts/"));
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(font.text).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  it("does not expose private source, local paths or credentials", () => {
    const raw = JSON.stringify(packages);
    expect(raw).not.toMatch(/C:\\\\Users|\/Users\/|eyJhbGci|service_role|sk_(test|live)_/);
  });
});

describe("About locale parity", () => {
  const flatten = (node: unknown, prefix = ""): string[] =>
    node && typeof node === "object"
      ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key))
      : [prefix];

  it("English and Spanish carry exactly the same About keys, all filled in", () => {
    expect(flatten(es.about).sort()).toEqual(flatten(en.about).sort());
    for (const lang of [en, es]) for (const key of flatten(lang.about)) expect(key).toBeTruthy();
  });

  it("has no leftover placeholder strings", () => {
    expect(JSON.stringify(en)).not.toMatch(/coming in an upcoming update|isn't set up yet/);
    expect((en.settings as Record<string, unknown>).notConfigured).toBeUndefined();
    expect((es.settings as Record<string, unknown>).notConfigured).toBeUndefined();
  });
});

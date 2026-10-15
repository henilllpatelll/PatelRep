import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { HIDDEN_APP_ROUTES } from "@/lib/navigation/roleTabs";
import { SETTINGS_MAX_FONT_SCALE } from "@/lib/settings/a11y";

const root = path.resolve(__dirname, "../..");
const rel = (f: string) => path.relative(root, f).replace(/\\/g, "/");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const settingsFiles = [
  ...walk(path.join(root, "app/(app)/profile")),
  ...walk(path.join(root, "components/settings")),
  ...walk(path.join(root, "components/security")),
];
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("Settings accessibility conventions", () => {
  it("scales text from one shared setting, not per-file copies", () => {
    const offenders = settingsFiles.filter((f) => /const MAX_FONT_SCALE\s*=\s*[\d.]+/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
    expect(SETTINGS_MAX_FONT_SCALE).toBeGreaterThanOrEqual(1.6);
  });

  it("never switches font scaling off", () => {
    const offenders = settingsFiles.filter((f) => /allowFontScaling=\{?false|maxFontSizeMultiplier=\{?1\}?[^.\d]/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("keeps touch targets at the platform minimum: no 44-high controls, no small buttons", () => {
    const offenders = settingsFiles
      .filter((f) => !/Lock(Screen)?\.tsx$/.test(f))
      .filter((f) => /size="sm"|(?:min)?[hH]eight:\s*44\b|width:\s*44,\s*height:\s*44/.test(read(f)))
      // The device card icon tile is decorative, not a control.
      .filter((f) => rel(f) !== "app/(app)/profile/devices.tsx")
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("subscribes to the app store with selectors, so a Settings screen is not re-rendered by unrelated state", () => {
    const offenders = settingsFiles.filter((f) => /useAppStore\(\)/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
    expect(read(path.join(root, "lib/settings/useSettingsIdentity.ts"))).not.toMatch(/useAppStore\(\)/);
  });

  it("uses theme tokens only: no hard-coded colours in Settings screens or sheets", () => {
    const offenders = settingsFiles.filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("lets headings and labels wrap instead of clipping: only single-line elements are names that have a full view elsewhere", () => {
    const offenders = settingsFiles
      .filter((f) => /numberOfLines=\{1\}/.test(read(f)))
      // The home identity card allows two lines; no other Settings element may be cut to one.
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("Settings navigation integrity", () => {
  const routeLiterals = new Set<string>();
  for (const f of [...settingsFiles, path.join(root, "lib/support/faq.ts")]) {
    for (const match of read(f).matchAll(/["'`](\/\(app\)\/profile\/[a-z-]+)["'`]/g)) routeLiterals.add(match[1]);
  }

  it("finds the Settings routes the code navigates to", () => {
    expect(routeLiterals.size).toBeGreaterThanOrEqual(10);
  });

  it.each([...routeLiterals])("%s is a real screen registered as a hidden app route", (route) => {
    const name = route.replace("/(app)/", "");
    expect(fs.existsSync(path.join(root, "app/(app)", `${name}.tsx`))).toBe(true);
    expect(HIDDEN_APP_ROUTES).toContain(name);
  });

  it("registers every screen file under profile/ (no orphan screens), apart from the Settings home", () => {
    const files = fs.readdirSync(path.join(root, "app/(app)/profile")).filter((f) => f.endsWith(".tsx") && f !== "index.tsx");
    for (const file of files) expect(HIDDEN_APP_ROUTES).toContain(`profile/${file.replace(".tsx", "")}`);
    for (const route of HIDDEN_APP_ROUTES.filter((r) => r.startsWith("profile/") && r !== "profile/index")) {
      expect(fs.existsSync(path.join(root, "app/(app)", `${route}.tsx`))).toBe(true);
    }
  });
});

describe("Settings locale parity", () => {
  const flatten = (node: unknown, prefix = ""): string[] =>
    node && typeof node === "object"
      ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key))
      : [prefix];
  const value = (tree: unknown, key: string) => key.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], tree);

  it.each(["settings", "security", "help", "about", "profile"])("English and Spanish carry the same %s keys", (ns) => {
    expect(flatten((es as Record<string, unknown>)[ns]).sort()).toEqual(flatten((en as Record<string, unknown>)[ns]).sort());
  });

  it("has no empty strings and no English left in Spanish where the two differ in kind", () => {
    for (const ns of ["settings", "security", "help", "about", "profile"]) {
      for (const key of flatten((es as Record<string, unknown>)[ns], ns)) {
        const text = value(es, key);
        expect(typeof text).toBe("string");
        expect((text as string).trim()).not.toBe("");
      }
    }
  });

  it("keeps every interpolation placeholder identical across languages", () => {
    const names = (s: unknown) => (String(s).match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
    for (const ns of ["settings", "security", "help", "about", "profile"]) {
      for (const key of flatten((en as Record<string, unknown>)[ns], ns)) {
        expect([key, names(value(es, key))]).toEqual([key, names(value(en, key))]);
      }
    }
  });
});

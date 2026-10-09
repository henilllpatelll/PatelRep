import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import i18next from "i18next";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

/**
 * Room Detail strings live under rooms.work (plus a few reused rooms.detail /
 * rooms.dash keys). Both languages must carry exactly the same keys, and every
 * key the code asks for must exist — otherwise a housekeeper sees a raw key.
 */

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );
}

function has(tree: Tree, path: string): boolean {
  let node: string | Tree | undefined = tree;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = node[part];
  }
  return node !== undefined;
}

/** The app runs i18next in v3 mode: a counted key is <key> plus <key>_plural. */
function resolves(tree: Tree, path: string): boolean {
  return has(tree, path);
}

const ROOT = resolve(__dirname, "../..");
const SOURCE_DIRS = ["app/(app)/my-rooms", "components/housekeeping", "lib/housekeeping"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const enRooms = (en as unknown as { rooms: Tree }).rooms;
const esRooms = (es as unknown as { rooms: Tree }).rooms;

describe("rooms.work translations", () => {
  it("English and Spanish have exactly the same keys", () => {
    const enKeys = leaves(enRooms.work as Tree).sort();
    const esKeys = leaves(esRooms.work as Tree).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("has no empty strings", () => {
    for (const tree of [enRooms.work, esRooms.work]) {
      for (const key of leaves(tree as Tree)) {
        const value = key.split(".").reduce<string | Tree>((node, part) => (node as Tree)[part], tree as Tree);
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps interpolation placeholders identical between languages", () => {
    const placeholders = (text: string) => (text.match(/{{\s*\w+\s*}}/g) ?? []).map((p) => p.replace(/\s/g, "")).sort();
    for (const key of leaves(enRooms.work as Tree)) {
      const read = (tree: Tree) => key.split(".").reduce<string | Tree>((node, part) => (node as Tree)[part], tree) as string;
      expect({ key, placeholders: placeholders(read(esRooms.work as Tree)) }).toEqual({
        key,
        placeholders: placeholders(read(enRooms.work as Tree)),
      });
    }
  });

  it("defines every rooms.work key that the code references literally", () => {
    const missing: string[] = [];
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/["'`](rooms\.work\.[A-Za-z0-9_.]+?)["'`]/g)) {
          const key = match[1].replace(/^rooms\./, "");
          if (!resolves(enRooms, key) || !resolves(esRooms, key)) missing.push(`${file.replace(ROOT, "")}: rooms.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("defines every action and disabled-reason key the state resolver can emit", () => {
    const text = readFileSync(join(ROOT, "lib/housekeeping/roomDetailState.ts"), "utf8");
    const missing: string[] = [];
    for (const match of text.matchAll(/\$\{(A|D)\}\.([A-Za-z]+)/g)) {
      const key = `work.${match[1] === "A" ? "actions" : "disabled"}.${match[2]}`;
      if (!resolves(enRooms, key) || !resolves(esRooms, key)) missing.push(`rooms.${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("defines the dynamic entry-check, attention and linen-status keys", () => {
    const dynamic = [
      ...["checkoutConfirmed", "checkoutNotConfirmed", "dndActive", "guestMayBeInside", "noDnd", "reviewInstructions", "serviceDeclined", "vacant"].map((k) => `work.checks.${k}`),
      ...["checkoutUnverified", "guestInside", "accessProblem"].flatMap((k) => [`work.attention.${k}.title`, `work.attention.${k}.body`]),
      ...["saved", "pending", "failed"].map((k) => `work.linen.status.${k}`),
    ];
    for (const key of dynamic) {
      expect({ key, en: resolves(enRooms, key), es: resolves(esRooms, key) }).toEqual({ key, en: true, es: true });
    }
  });

  it("keeps the session-completion copy honest: pending means the server has not confirmed", () => {
    const session = (en as unknown as { rooms: { detail: { session: Record<string, string> } } }).rooms.detail.session;
    expect(session.completingBody).toMatch(/not yet been confirmed/i);
    expect(session.completingUnsure).toMatch(/nothing is lost/i);
  });
});

/**
 * The tests above only read the JSON. This one asks a real i18next instance, set up
 * exactly like i18n/index.ts, for every key — so a key that exists in the file but is
 * never resolved at runtime (the plural-suffix trap) shows up as the raw key.
 */
describe("rooms.work through the app's real i18next configuration", () => {
  const PARAMS = { count: 2, done: 1, total: 3, minutes: 5, room: "224", number: "224", time: "9:00 AM", out: 2, in: 2, section: "Bedroom", n: 1, text: "Knock" };

  function instance(lng: "en" | "es") {
    const i18n = i18next.createInstance();
    void i18n.init({
      resources: { en: { translation: en }, es: { translation: es } },
      lng,
      fallbackLng: false,
      compatibilityJSON: "v3",
      interpolation: { escapeValue: false },
      initImmediate: false,
    });
    return i18n;
  }

  const baseKeys = Array.from(new Set(leaves(enRooms.work as Tree).map((key) => `rooms.work.${key.replace(/_plural$/, "")}`)));

  it.each(["en", "es"] as const)("%s: every rooms.work key resolves to text, never to the raw key", (lng) => {
    const i18n = instance(lng);
    const unresolved = baseKeys.filter((key) => {
      const text = i18n.t(key, PARAMS) as string;
      return text === key || /{{/.test(text);
    });
    expect(unresolved).toEqual([]);
  });

  it.each(["en", "es"] as const)("%s: counted strings switch between singular and plural", (lng) => {
    const i18n = instance(lng);
    for (const key of ["rooms.work.reclean.count", "rooms.work.complete.open", "rooms.work.offline.pending"]) {
      const one = i18n.t(key, { count: 1 }) as string;
      const many = i18n.t(key, { count: 3 }) as string;
      expect(one).not.toBe(key);
      expect(many).not.toBe(key);
      expect(one).not.toBe(many);
      expect(one).toContain("1");
      expect(many).toContain("3");
    }
  });

  it("the session-completion copy used by the banner resolves", () => {
    const i18n = instance("en");
    for (const key of ["rooms.detail.session.completingTitle", "rooms.detail.session.completingBody", "rooms.detail.session.completingUnsure"]) {
      expect(i18n.t(key)).not.toBe(key);
    }
  });
});


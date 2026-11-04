import { getEngineeringMoreSections } from "@/lib/engineering/moreMenu";

const items = (role: string) => getEngineeringMoreSections(role).flatMap((s) => s.items);

describe("getEngineeringMoreSections", () => {
  it("keeps Rooms, Notifications, Profile, Settings and Sign out reachable", () => {
    const targets = items("engineer").map((i) => i.href ?? i.action);
    expect(targets).toEqual(
      expect.arrayContaining(["/(app)/room-status", "/(app)/notifications", "/(app)/profile/personal", "/(app)/profile", "signOut"]),
    );
  });

  it("offers nothing to non-engineering roles", () => {
    for (const role of ["housekeeper", "housekeeping_supervisor", "front_desk", "gm", null, undefined]) {
      expect(getEngineeringMoreSections(role)).toEqual([]);
    }
  });

  it("shows the Management section (Team Overview) to the chief engineer only", () => {
    expect(getEngineeringMoreSections("engineer").map((s) => s.key)).toEqual(["operations", "account"]);
    const chief = getEngineeringMoreSections("chief_engineer");
    expect(chief.map((s) => s.key)).toEqual(["operations", "account", "management"]);
    expect(chief[2].items.map((i) => i.href)).toEqual(["/(app)/team"]);
  });

  it("offers Sync Status to every engineering role", () => {
    for (const role of ["engineer", "chief_engineer"]) expect(items(role).some((i) => i.href === "/(app)/engineering-sync")).toBe(true);
  });

  it("every row is a real route or the sign-out action, never a placeholder", () => {
    for (const item of items("chief_engineer")) expect(Boolean(item.href) !== Boolean(item.action)).toBe(true);
  });
});

/* ── Phase 1: V2 navigation contract ─────────────────────────────────────── */
import fs from "fs";
import path from "path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import {
  MORE_ACTIONS,
  MORE_CATALOG,
  MORE_GROUP_ORDER,
  getEngineeringMoreGroups,
  isMoreItemAvailable,
} from "@/lib/engineering/moreMenu";
import { ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";

const APP_DIR = path.join(__dirname, "../../../app/(app)");
const lookup = (tree: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), tree);
const groupItems = (role: string) => getEngineeringMoreGroups(role).flatMap((g) => g.items);
const keys = (role: string) => groupItems(role).map((i) => i.key);

/** Resolve an Expo Router href like /(app)/profile/personal to the screen file that serves it. */
function routeFile(href: string): string | null {
  const rel = href.replace(/^\/\(app\)\/?/, "");
  const candidates = [path.join(APP_DIR, `${rel}.tsx`), path.join(APP_DIR, rel, "index.tsx")];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

describe("V2 groups: regular engineer", () => {
  it("shows identity, tools, notifications & sync and support, never management", () => {
    expect(getEngineeringMoreGroups("engineer").map((g) => g.key)).toEqual(["identity", "tools", "alerts", "support"]);
    expect(keys("engineer")).not.toContain("team");
  });

  it("covers every shared destination the redesign names", () => {
    expect(keys("engineer")).toEqual(
      expect.arrayContaining([
        "profile", "settings", "security", "signOut",
        "rooms", "sop", "schedule",
        "notifications", "notificationSettings", "sync",
        "help", "faq", "report", "myReports", "diagnostics", "contactSupervisor",
      ]),
    );
  });
});

describe("V2 groups: chief engineer", () => {
  it("gets everything an engineer gets, plus a Management group holding only Team Overview", () => {
    const chief = getEngineeringMoreGroups("chief_engineer");
    expect(chief.map((g) => g.key)).toEqual([...MORE_GROUP_ORDER]);
    expect(keys("chief_engineer")).toEqual(expect.arrayContaining(keys("engineer")));
    expect(chief[chief.length - 1].items.map((i) => i.href)).toEqual(["/(app)/team"]);
  });
});

describe("V2 contract integrity", () => {
  it("offers nothing to any other role or an unknown role, in either view", () => {
    for (const role of ["housekeeper", "inspector", "housekeeping_supervisor", "front_desk", "gm", "", null, undefined]) {
      expect(getEngineeringMoreGroups(role)).toEqual([]);
      expect(getEngineeringMoreSections(role)).toEqual([]);
      for (const entry of MORE_CATALOG) expect(isMoreItemAvailable(role, entry.key)).toBe(false);
    }
  });

  it("refuses the management entry at press time for an engineer, allows it for the chief", () => {
    expect(isMoreItemAvailable("engineer", "team")).toBe(false);
    expect(isMoreItemAvailable("chief_engineer", "team")).toBe(true);
    expect(isMoreItemAvailable("engineer", "sync")).toBe(true);
  });

  it("every row is exactly one of a real route or a known action, with unique keys", () => {
    const seen = new Set<string>();
    for (const entry of MORE_CATALOG) {
      expect(seen.has(entry.key)).toBe(false);
      seen.add(entry.key);
      expect(Boolean(entry.href) !== Boolean(entry.action)).toBe(true);
      if (entry.action) expect(MORE_ACTIONS).toContain(entry.action);
    }
  });

  it("every href is a real Expo Router screen file that the (app) layout registers", () => {
    const registered = new Set<string>([...HIDDEN_APP_ROUTES, ...ALL_ROLE_TAB_ROUTES]);
    for (const entry of MORE_CATALOG) {
      if (!entry.href) continue;
      const file = routeFile(entry.href);
      expect({ href: entry.href, found: file !== null }).toEqual({ href: entry.href, found: true });
      const rel = path.relative(APP_DIR, file as string).split(path.sep).join("/").replace(/\.tsx$/, "");
      expect({ href: entry.href, registered: registered.has(rel) }).toEqual({ href: entry.href, registered: true });
    }
  });

  it("has no two rows that open the same destination", () => {
    const hrefs = MORE_CATALOG.map((e) => e.href).filter(Boolean);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("marks exactly one Sync Center entry point and keeps Sign out destructive", () => {
    expect(MORE_CATALOG.filter((e) => e.syncEntry).map((e) => e.href)).toEqual(["/(app)/engineering-sync"]);
    expect(MORE_CATALOG.filter((e) => e.destructive).map((e) => e.key)).toEqual(["signOut"]);
  });

  it("keeps today's three-section layout and row order exactly as rendered before this phase", () => {
    const shape = (role: string) => getEngineeringMoreSections(role).map((s) => [s.key, s.items.map((i) => i.key)]);
    expect(shape("engineer")).toEqual([
      ["operations", ["rooms", "notifications", "notificationSettings", "sync"]],
      ["account", ["profile", "settings", "help", "signOut"]],
    ]);
    expect(shape("chief_engineer")).toEqual([...shape("engineer"), ["management", ["team"]]]);
  });

  it("has English and Spanish copy for every title and label", () => {
    const labelKeys = [
      ...MORE_CATALOG.map((e) => e.labelKey),
      ...getEngineeringMoreGroups("chief_engineer").map((g) => g.titleKey),
      ...getEngineeringMoreSections("chief_engineer").map((s) => s.titleKey),
    ];
    for (const key of labelKeys) {
      for (const [name, tree] of [["en", en], ["es", es]] as const) {
        expect({ locale: name, key, text: typeof lookup(tree, key) }).toEqual({ locale: name, key, text: "string" });
      }
    }
  });
});

describe("role and tab protection", () => {
  it("leaves the five engineering bottom tabs untouched for both roles", () => {
    for (const role of ["engineer", "chief_engineer"] as const) {
      expect(getTabsForRole(role).map((t) => t.key)).toEqual(["home", "work", "pm", "assets", "more"]);
    }
  });

  it("does not change any other role's tabs", () => {
    expect(getTabsForRole("housekeeper").map((t) => t.key)).toEqual(["home", "rooms", "tasks", "me"]);
    expect(getTabsForRole("gm").map((t) => t.key)).toEqual(["home", "alerts", "staff", "me"]);
    expect(getTabsForRole("front_desk").some((t) => t.key === "more")).toBe(false);
  });
});

/* ── Phase 2: hub layout ─────────────────────────────────────────────────── */
import { MORE_HUB_ORDER, getEngineeringMoreHub } from "@/lib/engineering/moreMenu";

const hubKeys = (role: string) => Object.fromEntries(MORE_HUB_ORDER.map((slot) => [slot, getEngineeringMoreHub(role)[slot].map((i) => i.key)]));

describe("Phase 2 hub", () => {
  it("lays out header, identity, tools, account and sign out for an engineer (no management)", () => {
    expect(hubKeys("engineer")).toEqual({
      header: ["settings", "notifications"],
      identity: ["profile", "sync"],
      management: [],
      tools: ["rooms", "sop", "schedule"],
      account: ["settings", "help"],
      signOut: ["signOut"],
    });
  });

  it("adds only Team Overview, under management, for a chief engineer", () => {
    expect({ ...hubKeys("chief_engineer"), management: [] }).toEqual(hubKeys("engineer"));
    expect(hubKeys("chief_engineer").management).toEqual(["team"]);
  });

  it("is empty for every other role", () => {
    for (const role of ["housekeeper", "gm", null, undefined]) {
      for (const slot of MORE_HUB_ORDER) expect(getEngineeringMoreHub(role)[slot]).toEqual([]);
    }
  });

  it("gives every list row a subtitle with English and Spanish copy", () => {
    const hub = getEngineeringMoreHub("chief_engineer");
    for (const item of [...hub.management, ...hub.tools, ...hub.account]) {
      expect(item.subtitleKey).toBeTruthy();
      for (const tree of [en, es]) expect(typeof lookup(tree, item.subtitleKey as string)).toBe("string");
    }
    for (const key of ["engineeringMore.accountSupport", "engineeringMore.viewProfile", "engineeringMore.syncStatus", "engineeringMore.roleLine.engineer", "engineeringMore.roleLine.chief_engineer", "engineeringMore.notificationsA11y", "engineeringMore.settingsA11y"]) {
      for (const tree of [en, es]) expect({ key, t: typeof lookup(tree, key) }).toEqual({ key, t: "string" });
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { makeTranslator } from "../helpers/i18n";

type Tree = { [key: string]: string | Tree };

const flatten = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
const smart = (lang: unknown) => (lang as { assignments: { v2: { smart: Tree } } }).assignments.v2.smart;
const dig = (tree: Tree, path: string): string | undefined => path.split(".").reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree) as string | undefined;

const enKeys = new Set(flatten(smart(en)));
const esKeys = new Set(flatten(smart(es)));
const root = resolve(__dirname, "../..");
const sources = [
  "app/(app)/assignments/index.tsx",
  "lib/housekeeping/smartBalanceText.ts",
  "lib/housekeeping/useSmartBalance.ts",
  ...readdirSync(resolve(root, "components/supervisor/assignments"))
    .filter((file) => file.startsWith("SmartBalance"))
    .map((file) => `components/supervisor/assignments/${file}`),
  "components/supervisor/assignments/BulkActionFooter.tsx",
];

describe("Smart Balance strings", () => {
  it("English and Spanish carry exactly the same keys", () => {
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it("every literal key the code asks for exists in both languages", () => {
    const missing: string[] = [];
    for (const file of sources) {
      const code = readFileSync(resolve(root, file), "utf8");
      for (const match of code.matchAll(/["'`](assignments\.v2\.smart\.[A-Za-z0-9_.]+)["'`]/g)) {
        const key = match[1].replace(/^assignments\.v2\.smart\./, "");
        for (const [name, keys] of [["en", enKeys], ["es", esKeys]] as const) {
          if (!keys.has(key) && !keys.has(`${key}_plural`)) missing.push(`${file}: ${match[1]} (${name})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each([
    ["setup.blocked", ["board_unavailable", "not_live", "offline", "staff_unavailable", "attendance_unavailable", "no_rooms", "selection_empty", "no_staff"]],
    ["setup.failed", ["offline", "day_changed", "permission", "invalid", "unavailable", "unverified"]],
    ["setup.scope", ["unassigned", "all_unstarted", "selected"]],
    ["preview.stale.reasons", ["day", "scope", "board_unavailable", "attendance_unverified", "settings_changed", "rooms_changed", "staff_changed"]],
    ["preview.assumptions", ["unknown_estimate_surrogate", "capacity_unknown", "credits_incomplete"]],
    ["preview.paused", ["offline", "not_live"]],
    ["detail.refusal", ["unknown_room", "protected", "not_a_receiver", "same_person", "limit", "not_addable", "already_planned"]],
    ["exceptions.room.soft", ["dnd", "service_declined", "return_later", "occupancy_discrepancy"]],
    ["exceptions.room.server", ["not_found", "not_assignable", "room_blocked", "owner_changed"]],
    ["exceptions.staff", ["on_break", "shift_ended", "not_on_shift", "attendance_unknown", "no_capacity", "not_eligible"]],
    ["exceptions.leftOut", ["insufficient_capacity", "no_eligible_staff", "solver_no_solution", "taken_out"]],
    ["why.urgent", ["guest_waiting", "reclean_requested", "rush", "arrival_passed", "arrival_today", "vip", "high_risk"]],
    ["detail.status", ["protected", "retained", "moving_out"]],
    ["detail.stage", ["completed", "in_progress", "not_started"]],
    ["preview.status", ["fallback", "no_safe_plan", "no_safe_planBody", "nothing_to_plan", "no_staff", "empty"]],
  ])("every %s variant is worded in both languages", (group, names) => {
    for (const name of names) {
      expect(dig(smart(en), `${group}.${name}`)).toBeTruthy();
      expect(dig(smart(es), `${group}.${name}`)).toBeTruthy();
    }
  });

  it("every placeholder a sentence uses is one the code supplies (no raw {{x}} left over)", () => {
    for (const lang of ["en", "es"] as const) {
      const t = makeTranslator(lang);
      const samples: [string, Record<string, unknown>][] = [
        ["assignments.v2.smart.preview.summary.planned", { count: 3 }],
        ["assignments.v2.smart.preview.notes.partial", { planned: 6, eligible: 8 }],
        ["assignments.v2.smart.preview.stale.reasons.rooms_changed", { rooms: "101, 102" }],
        ["assignments.v2.smart.preview.stale.reasons.staff_changed", { names: "Ana" }],
        ["assignments.v2.smart.why.lowestWorkload", { minutes: 45 }],
        ["assignments.v2.smart.detail.status.moving_out", { name: "Ben" }],
        ["assignments.v2.smart.exceptions.room.now_assigned", { name: "Ben" }],
      ];
      for (const [key, values] of samples) {
        const text = t(key, values);
        expect(text).not.toBe(key);
        expect(text).not.toMatch(/\{\{/);
      }
    }
  });

  it("resolves plurals the way the app's i18next does, in both languages", () => {
    for (const lang of ["en", "es"] as const) {
      const t = makeTranslator(lang);
      expect(t("assignments.v2.smart.preview.summary.planned", { count: 1 })).toContain("1");
      expect(t("assignments.v2.smart.preview.summary.planned", { count: 4 })).toContain("4");
      expect(t("assignments.v2.smart.preview.summary.planned", { count: 1 })).not.toBe(t("assignments.v2.smart.preview.summary.planned", { count: 4 }).replace("4", "1"));
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { makeTranslator } from "../helpers/i18n";

type Tree = { [key: string]: string | Tree };

const flatten = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
const midshift = (lang: unknown) => (lang as { assignments: { v2: { midshift: Tree } } }).assignments.v2.midshift;
const dig = (tree: Tree, path: string): string | undefined => path.split(".").reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree) as string | undefined;
const v2 = (lang: unknown) => (lang as { assignments: { v2: Tree } }).assignments.v2;

const enKeys = new Set(flatten(midshift(en)));
const esKeys = new Set(flatten(midshift(es)));
const root = resolve(__dirname, "../..");
const sources = [
  "app/(app)/assignments/index.tsx",
  "lib/housekeeping/assignmentMidshift.ts",
  "lib/housekeeping/assignmentMidshiftText.ts",
  "lib/housekeeping/useMidshiftRecovery.ts",
  "components/supervisor/assignments/StaffDetailSheet.tsx",
  "components/supervisor/assignments/BulkReviewStep.tsx",
  ...readdirSync(resolve(root, "components/supervisor/assignments"))
    .filter((file) => file.startsWith("Midshift"))
    .map((file) => `components/supervisor/assignments/${file}`),
];

describe("midshift strings", () => {
  it("English and Spanish carry exactly the same keys", () => {
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it("every literal key the code asks for exists in both languages", () => {
    const missing: string[] = [];
    for (const file of sources) {
      const code = readFileSync(resolve(root, file), "utf8");
      for (const match of code.matchAll(/["'`](assignments\.v2\.midshift\.[A-Za-z0-9_.]+)["'`]/g)) {
        const key = match[1].replace(/^assignments\.v2\.midshift\./, "");
        for (const [name, keys] of [["en", enKeys], ["es", esKeys]] as const) {
          if (!keys.has(key) && !keys.has(`${key}_plural`)) missing.push(`${file}: ${match[1]} (${name})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each([
    ["reason", ["left_early", "unavailable", "workload_help", "urgent_coverage", "supervisor_adjustment"]],
    ["block", ["dnd", "service_declined", "return_later", "occupancy_discrepancy"]],
    ["protected", ["in_progress", "awaiting_inspection", "guest_ready", "held", "unavailable", "unknown"]],
    ["attention", ["shift_ended", "not_clocked_in", "overloaded"]],
    ["unavailable", ["board_unavailable", "nothing_assigned", "all_held", "nothing_unstarted"]],
    ["blocked", ["stale", "nothing_selected", "no_destination", "nothing_placeable"]],
    ["paused", ["offline", "not_live"]],
    ["steps", ["select", "destination", "review"]],
    ["changed.room", ["reassigned", "started", "completed", "held", "gone", "other"]],
    ["leftOut", ["insufficient_capacity", "no_eligible_staff"]],
    ["destination.mode", ["team", "teamHint", "person", "personHint"]],
    ["counts", ["completed", "inProgress"]],
  ])("every %s variant is worded in both languages", (group, names) => {
    for (const name of names) {
      expect(dig(midshift(en), `${group}.${name}`)).toBeTruthy();
      expect(dig(midshift(es), `${group}.${name}`)).toBeTruthy();
    }
  });

  it("the shared review keys the new states use exist in both languages", () => {
    for (const lang of [en, es]) {
      const reasons = dig(v2(lang), "bulk.review.exclusionReason");
      expect(reasons).toBeTruthy();
      for (const reason of ["insufficient_capacity", "no_eligible_staff", "room_missing", "room_blocked", "employee_unknown", "needs_acknowledgement"]) {
        expect(dig(v2(lang), `bulk.review.exclusionReason.${reason}`)).toBeTruthy();
      }
      expect(dig(v2(lang), "team.note.shiftEndedMixed")).toBeTruthy();
      expect(dig(v2(lang), "team.note.notClockedInMixed")).toBeTruthy();
    }
  });

  it("every placeholder a sentence uses is one the code supplies (no raw {{x}} left over)", () => {
    for (const lang of ["en", "es"] as const) {
      const t = makeTranslator(lang);
      const samples: [string, Record<string, unknown>][] = [
        ["assignments.v2.midshift.title", { name: "Ana" }],
        ["assignments.v2.midshift.subtitle", { count: 9 }],
        ["assignments.v2.midshift.stepOf", { step: 1, total: 3 }],
        ["assignments.v2.midshift.drawer.movable", { count: 6, value: "170 min" }],
        ["assignments.v2.midshift.drawer.staying", { count: 3, name: "Ana", detail: "2 completed" }],
        ["assignments.v2.midshift.drawer.held", { count: 2 }],
        ["assignments.v2.midshift.attention.shift_ended", { name: "Ana" }],
        ["assignments.v2.midshift.unavailable.nothing_assigned", { name: "Ana" }],
        ["assignments.v2.midshift.select.stats", { completed: 2, inProgress: 1, notStarted: 6 }],
        ["assignments.v2.midshift.select.summary", { count: 6, value: "170 min" }],
        ["assignments.v2.midshift.select.protectedHeading", { name: "Ana" }],
        ["assignments.v2.midshift.protected.held", { blocks: "DND" }],
        ["assignments.v2.midshift.destination.movingLine", { count: 6, value: "170 min" }],
        ["assignments.v2.midshift.destination.teamMembers", { names: "Ben, Cara" }],
        ["assignments.v2.midshift.destination.keepAssigned", { name: "Ana" }],
        ["assignments.v2.midshift.destination.keepNote", { name: "Ana", attendance: "Shift ended" }],
        ["assignments.v2.midshift.destination.shiftLeft", { minutes: 90 }],
        ["assignments.v2.midshift.review.before", { value: "95 min" }],
        ["assignments.v2.midshift.review.moving", { count: 6 }],
        ["assignments.v2.midshift.review.staysWith", { count: 3, name: "Ana" }],
        ["assignments.v2.midshift.review.reasonLine", { reason: "Left early" }],
        ["assignments.v2.midshift.review.leftOutLine", { room: "301", reason: "x" }],
        ["assignments.v2.midshift.review.moveTitle", { room: "301" }],
        ["assignments.v2.midshift.changed.room.started", { room: "301" }],
        ["assignments.v2.midshift.changed.destination", { name: "Ben", from: "On shift", to: "On break" }],
        ["assignments.v2.midshift.conflict.body", { count: 3 }],
        ["assignments.v2.midshift.note.title", { count: 6, names: "Ana" }],
        ["assignments.v2.midshift.note.reason", { reason: "Left early" }],
        ["assignments.v2.midshift.added", { count: 6 }],
        ["assignments.v2.midshift.tooMany", { max: 150 }],
        ["assignments.v2.team.note.shiftEndedMixed", { unstarted: 8, inProgress: 1 }],
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
      for (const key of ["assignments.v2.midshift.drawer.movable", "assignments.v2.midshift.review.moving", "assignments.v2.midshift.subtitle"]) {
        const one = t(key, { count: 1, value: "x" });
        const many = t(key, { count: 4, value: "x" });
        expect(one).toContain("1");
        expect(many).toContain("4");
        expect(one).not.toBe(many.replace("4", "1"));
      }
    }
  });

  it("never uses a gendered pronoun for a person in English", () => {
    const sentences = [...enKeys].map((key) => dig(midshift(en), key) ?? "");
    for (const sentence of sentences) expect(sentence).not.toMatch(/\b(he|she|his|hers?|him)\b/i);
  });
});

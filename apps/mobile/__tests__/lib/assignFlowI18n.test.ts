import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { ACK_ORDER } from "@/lib/housekeeping/assignmentPicker";

type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
const dig = (tree: Tree, path: string): string | undefined => path.split(".").reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree) as string | undefined;

const assign = (lang: unknown) => (lang as { assignments: { v2: { assign: Tree } } }).assignments.v2.assign;

describe("single-room assignment strings", () => {
  it("English and Spanish carry exactly the same keys", () => {
    const enKeys = new Set(flatten(assign(en)));
    const esKeys = new Set(flatten(assign(es)));
    expect([...enKeys].filter((key) => !esKeys.has(key))).toEqual([]);
    expect([...esKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it.each([
    ["attendance", ["on_shift", "on_break", "shift_ended", "scheduled_not_clocked_in", "not_clocked_in", "unknown"]],
    ["review.stage", ["to_clean", "in_progress", "awaiting_inspection", "guest_ready", "unavailable", "unknown"]],
    ["conflict.reason", ["assignee_changed", "not_assignable", "acknowledgement_changed", "room_missing", "employee_unavailable"]],
    ["conflict.stage", ["to_clean", "in_progress", "awaiting_inspection", "guest_ready", "unavailable", "unknown"]],
    ["candidate.reason", ["most_capacity", "least_remaining_time", "same_floor", "same_building"]],
    ["candidate.proximity", ["same_floor", "same_building"]],
    ["picker.empty", ["no_staff", "no_on_shift", "no_match"]],
    ["error", ["offline", "permission", "conflict", "employee_ineligible", "room_unavailable", "save_failed", "session", "unknown_outcome", "paused", "blocked", "not_ready", "still_unknown", "acks_missing"]],
    ["warning", ["overCapacity", "overShift", "fullDay"]],
  ])("every %s variant is worded in both languages", (group, keys) => {
    for (const key of keys) {
      expect(dig(assign(en), `${group}.${key}`)).toBeTruthy();
      expect(dig(assign(es), `${group}.${key}`)).toBeTruthy();
    }
  });

  it("every acknowledgement the review can ask for has its own sentence in both languages", () => {
    for (const ack of ACK_ORDER) {
      expect(dig(assign(en), `ack.${ack}`)).toBeTruthy();
      expect(dig(assign(es), `ack.${ack}`)).toBeTruthy();
    }
  });

  it("the plural of 'estimates missing' exists in both languages", () => {
    expect(dig(assign(en), "load.estimatesMissing_plural")).toBeTruthy();
    expect(dig(assign(es), "load.estimatesMissing_plural")).toBeTruthy();
  });

  it("no sentence is left untranslated", () => {
    const sentences = flatten(assign(en)).filter((key) => (dig(assign(en), key) ?? "").split(" ").length > 3);
    expect(sentences.filter((key) => dig(assign(en), key) === dig(assign(es), key))).toEqual([]);
  });
});

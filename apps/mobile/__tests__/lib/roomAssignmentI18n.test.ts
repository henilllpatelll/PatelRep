import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out[`${prefix}${key}`] = value;
    else Object.assign(out, leaves(value, `${prefix}${key}.`));
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
const enAssign = leaves((en as unknown as { roomBoard: { assign: Tree } }).roomBoard.assign);
const esAssign = leaves((es as unknown as { roomBoard: { assign: Tree } }).roomBoard.assign);

describe("room assignment strings (English / Spanish)", () => {
  it("carry exactly the same keys", () => {
    expect(Object.keys(esAssign).sort()).toEqual(Object.keys(enAssign).sort());
  });

  it("use the same interpolation values in both languages", () => {
    for (const key of Object.keys(enAssign)) expect([key, placeholders(esAssign[key])]).toEqual([key, placeholders(enAssign[key])]);
  });

  it("have no empty strings, and Spanish is really translated", () => {
    for (const [key, value] of Object.entries(esAssign)) {
      expect(value.trim()).not.toBe("");
      // Everything user-facing differs from English except the pure-number format.
      if (key !== "review.minutes") expect([key, value]).not.toEqual([key, enAssign[key]]);
    }
  });

  it("cover every availability state, failure kind and block the controller can show", () => {
    const needed = [
      ...["on_shift", "on_break", "ended", "not_clocked_in", "unknown"].map((k) => `availability.${k}`),
      ...[
        "offline", "permission", "conflict", "employee_ineligible", "room_unavailable", "save_failed", "session", "unknown_outcome",
        "revalidate_failed", "paused", "scope_changed", "room_missing", "not_assignable", "assignee_changed", "already_assigned",
        "in_progress", "awaiting_inspection", "guest_ready", "unavailable", "unknown_status", "nothing_to_remove",
      ].map((k) => `error.${k}`),
      ...["no_staff", "no_on_shift", "no_match"].map((k) => `picker.empty.${k}`),
      "success.assign", "success.reassign", "success.remove", "success.floor",
    ];
    for (const key of needed) {
      expect(enAssign[key]).toBeTruthy();
      expect(esAssign[key]).toBeTruthy();
    }
  });
});

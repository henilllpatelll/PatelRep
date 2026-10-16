import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import type { SupervisorAttentionItem, SupervisorAttentionKind } from "@/lib/housekeeping/supervisorAttention";
import type { StaffPulseMember, TeamPulse } from "@/lib/housekeeping/supervisorTeam";
import { describeAttention, describeFreshness, freshnessLabel, selectTeamPreview } from "@/lib/housekeeping/supervisorTodayView";
import { isSupervisorSafePath } from "@/lib/navigation/supervisorRoutes";

type Dict = { [key: string]: string | Dict };

function lookup(root: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = root;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function leafKeys(node: Dict, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  );
}

const t = (key: string, options?: Record<string, unknown>) => `${key}${options ? JSON.stringify(options) : ""}`;

describe("supervisorToday translations", () => {
  const enNs = (en as unknown as Dict).supervisorToday as Dict;
  const esNs = (es as unknown as Dict).supervisorToday as Dict;

  it("has the same keys in English and Spanish, apart from Spanish-only plural forms", () => {
    const english = new Set(leafKeys(enNs));
    const spanish = new Set(leafKeys(esNs));
    expect([...english].filter((key) => !spanish.has(key))).toEqual([]);
    expect([...spanish].filter((key) => !english.has(key))).toEqual([]);
  });

  it("never leaves a value empty or untranslated-looking", () => {
    for (const key of leafKeys(esNs)) expect(lookup(esNs, key)?.trim()).toBeTruthy();
  });

  it("keeps plural pairs complete (key + key_plural)", () => {
    for (const ns of [enNs, esNs]) {
      for (const key of leafKeys(ns).filter((k) => k.endsWith("_plural"))) {
        expect(lookup(ns, key.replace(/_plural$/, ""))).toBeTruthy();
      }
    }
  });
});

function item(kind: SupervisorAttentionKind, params: SupervisorAttentionItem["explain"]["params"] = {}, screen: "rooms" | "team" | "inspect" | "tasks" = "rooms"): SupervisorAttentionItem {
  return {
    id: `x:${kind}`,
    kind,
    severity: "high",
    subject: { type: "queue", id: kind },
    records: [],
    explain: { key: "ignored", params },
    source: { names: ["board"], status: "available", fetchedAt: 1 },
    target: { screen },
    action: "review_rooms",
    occurredAt: null,
  };
}

describe("describeAttention", () => {
  const ctx = { zone: "America/Chicago", language: "en", someone: "A housekeeper" };
  const cases: Array<[SupervisorAttentionKind, SupervisorAttentionItem["explain"]["params"]]> = [
    ["arrival_at_risk", { room: "308", arrivalAt: "2026-10-16T19:00:00Z" }],
    ["readiness_risk", { room: "308" }],
    ["task_blocker", { task: "Restock", reason: "missing_supplies" }],
    ["shift_ended_with_open_rooms", { name: "Ana", count: 2 }],
    ["workload_over_assigned", { name: "Ana" }],
    ["unassigned_rooms", { count: 2 }],
    ["awaiting_inspection", { count: 5 }],
    ["access_restricted", { count: 1 }],
  ];

  it.each(cases)("%s resolves to real English and Spanish copy and a supervisor-safe route", (kind, params) => {
    const row = describeAttention(item(kind, params, kind === "task_blocker" ? "tasks" : "rooms"), ctx)!;
    expect(row).not.toBeNull();
    for (const root of [en, es] as unknown as Dict[]) {
      expect(lookup(root, row.title.key)).toBeTruthy();
      expect(lookup(root, row.subtitle.key)).toBeTruthy();
    }
    expect(isSupervisorSafePath(row.pathname)).toBe(true);
  });

  it("uses the recorded arrival time in hotel time, and never invents one", () => {
    const withTime = describeAttention(item("arrival_at_risk", { room: "1", arrivalAt: "2026-10-16T19:00:00Z" }), ctx)!;
    expect(withTime.subtitle).toEqual({ key: "supervisorToday.attention.arrivalAt", params: { time: "2:00 PM" } });
    const withoutTime = describeAttention(item("arrival_at_risk", { room: "1" }), ctx)!;
    expect(withoutTime.subtitle.key).toBe("supervisorToday.attention.arrivalNotReady");
  });

  it("falls back to a neutral name rather than an empty or dash name", () => {
    const row = describeAttention(item("workload_over_assigned", { name: null }), ctx)!;
    expect(row.title.params.name).toBe("A housekeeper");
  });

  it("returns null for a kind Today has no wording for (no blank rows)", () => {
    expect(describeAttention(item("message"), ctx)).toBeNull();
  });
});

describe("describeFreshness / freshnessLabel", () => {
  const NOW = Date.parse("2026-10-16T17:00:00Z");
  const label = (state: Parameters<typeof describeFreshness>[0]) => freshnessLabel(describeFreshness(state, NOW), t, "America/Chicago", "en");

  it("says nothing it cannot substantiate", () => {
    expect(label({ status: "failed", failure: { kind: "error", status: 500 } })).toBeNull();
  });

  it("distinguishes just-now, minutes, offline, failed-refresh and age", () => {
    expect(label({ status: "available", data: [], fetchedAt: NOW - 20_000 })).toContain("justNow");
    expect(label({ status: "available", data: [], fetchedAt: NOW - 4 * 60_000 })).toContain('"count":4');
    expect(label({ status: "empty", fetchedAt: NOW })).toContain("justNow");
    const stale = (reason: "offline" | "age" | "refresh_failed") =>
      label({ status: "stale", data: [], fetchedAt: Date.parse("2026-10-16T15:24:00Z"), reason, failure: null });
    expect(stale("offline")).toContain("freshness.offline");
    expect(stale("offline")).toContain("10:24 AM");
    expect(stale("refresh_failed")).toContain("freshness.refreshFailed");
    expect(stale("age")).toContain("freshness.age");
  });
});

describe("selectTeamPreview", () => {
  const load = (total: number, done: number) => ({ housekeeperId: "", name: "", rooms: [], total, done, inProgress: 0, minutesLeft: 0, overAssigned: false });
  const member = (userId: string, over: Partial<StaffPulseMember> = {}): StaffPulseMember => ({
    userId,
    name: userId,
    role: "housekeeper",
    availability: "unknown",
    load: load(8, 2),
    concern: null,
    ...over,
  });
  const pulse = (members: StaffPulseMember[]): TeamPulse => ({
    roster: { status: "unknown", fetchedAt: null },
    onShift: null,
    onBreak: null,
    members,
    workloads: [],
  });

  it("puts people with proven concerns first, then the most rooms left, capped at three", () => {
    const preview = selectTeamPreview(
      pulse([
        member("a", { load: load(8, 7) }),
        member("b", { load: load(8, 1) }),
        member("c", { load: load(8, 4), concern: "over_assigned" }),
        member("d", { load: load(8, 0) }),
      ]),
    );
    expect(preview.rows.map((row) => row.userId)).toEqual(["c", "d", "b"]);
    expect(preview.hiddenCount).toBe(1);
  });

  it("counts housekeepers with no rooms separately, and is unknown without a staff list", () => {
    const withStaff = selectTeamPreview(pulse([member("a"), member("idle", { load: null }), member("boss", { load: null, role: "housekeeping_supervisor" })]));
    expect(withStaff.rows.map((row) => row.userId)).toEqual(["a"]);
    expect(withStaff.withoutRooms).toBe(1);
    expect(selectTeamPreview(pulse([member("a", { role: null })])).withoutRooms).toBeNull();
  });

  it("is empty — not a fabricated row — when nobody has rooms", () => {
    expect(selectTeamPreview(pulse([member("a", { load: null })])).rows).toEqual([]);
  });
});

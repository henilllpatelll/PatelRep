import { readFileSync } from "fs";
import { join, resolve } from "path";
import { ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";
import { FRONT_DESK_MORE_ITEMS, isFrontDeskMoreChild } from "@/lib/frontDesk/moreMenu";
import { isFrontDeskGmV2Role, isV2SurfaceRole } from "@/lib/design/housekeeperV2";
import {
  allowedTransitions,
  formatCount,
  normalizeGuestRequest,
  normalizeGuestRequests,
  pickNextRequest,
  stageOf,
  summarizeGuestRequests,
} from "@/lib/frontDesk/guestRequests";
import { isOccupiedBoardRow, readyPercent, summarizeRoomReadiness } from "@/lib/frontDesk/roomReadiness";
import { adaptRiskAlerts, countByTier } from "@/lib/gm/riskAlerts";
import { describeAlert } from "@/lib/gm/alertText";
import { homeStatus } from "@/lib/management/homeStatus";
import { makeTranslator, localeHasKey } from "../helpers/i18n";

/* Design System V2 Phase 6: Front Desk and General Manager. Pure contracts: navigation, the V2 gate, the real guest
   request and risk alert shapes, honest counting. */

describe("V2 surface gate", () => {
  it("adds Front Desk and GM without touching any other role", () => {
    expect(isFrontDeskGmV2Role("front_desk")).toBe(true);
    expect(isFrontDeskGmV2Role("gm")).toBe(true);
    expect(isFrontDeskGmV2Role("housekeeper")).toBe(false);
    for (const role of ["housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm"]) {
      expect(isV2SurfaceRole(role)).toBe(true);
    }
    expect(isV2SurfaceRole("unknown")).toBe(false);
    expect(isV2SurfaceRole(null)).toBe(false);
  });
});

describe("Front Desk navigation", () => {
  const keys = (v2: boolean) => getTabsForRole("front_desk", { v2 }).map((t) => t.key);

  it("keeps the legacy six tabs exactly when V2 is off", () => {
    expect(keys(false)).toEqual(["home", "requests", "room-status", "logbook", "lost", "me"]);
    expect(getTabsForRole("front_desk")).toBe(getTabsForRole("front_desk", { v2: false }));
  });

  it("has five tabs under V2: Home, Requests, Rooms, Logbook, More", () => {
    expect(keys(true)).toEqual(["home", "requests", "room-status", "logbook", "more"]);
    expect(getTabsForRole("front_desk", { v2: true }).map((t) => t.titleKey)).toEqual(["tabs.home", "tabs.guestRequests", "tabs.roomStatus", "tabs.logbook", "tabs.more"]);
  });

  it("keeps every original Front Desk destination reachable (same route files, same URLs)", () => {
    const legacy = getTabsForRole("front_desk").map((t) => t.name);
    const v2Tabs = new Set(getTabsForRole("front_desk", { v2: true }).map((t) => t.name));
    const moreRoutes = new Set(FRONT_DESK_MORE_ITEMS.map((i) => i.href.replace("/(app)/", "")));
    for (const name of legacy) {
      const route = name.replace("/index", "");
      // Either still a tab, or a More row that opens the very same route.
      expect(v2Tabs.has(name) || moreRoutes.has(route)).toBe(true);
    }
    // The two that left the bar are still registered routes (hidden tabs), never removed.
    expect(ALL_ROLE_TAB_ROUTES).toEqual(expect.arrayContaining(["lost-found/index", "profile/index", "more/index"]));
    expect(HIDDEN_APP_ROUTES).not.toContain("more/index");
    expect(moreRoutes.has("lost-found")).toBe(true);
    expect(moreRoutes.has("profile")).toBe(true);
  });

  it("does not change GM or any other role's tabs, whatever the flag says", () => {
    for (const role of ["gm", "housekeeper", "inspector", "engineer", "chief_engineer", "housekeeping_supervisor"] as const) {
      expect(getTabsForRole(role, { v2: true })).toBe(getTabsForRole(role));
    }
    expect(getTabsForRole("gm").map((t) => t.key)).toEqual(["home", "alerts", "staff", "me"]);
  });

  it("More rows only point at routes that exist, and the More tab stays selected on them", () => {
    const registered = new Set([...ALL_ROLE_TAB_ROUTES, ...HIDDEN_APP_ROUTES]);
    for (const item of FRONT_DESK_MORE_ITEMS) {
      const route = item.href.replace("/(app)/", "");
      const exists = [...registered].some((r) => r === route || r === `${route}/index`);
      expect(exists).toBe(true);
      expect(isFrontDeskMoreChild(item.href.replace("/(app)", ""))).toBe(true);
    }
    expect(isFrontDeskMoreChild("/guest-requests")).toBe(false);
    expect(isFrontDeskMoreChild("/room-status/abc")).toBe(false);
    expect(isFrontDeskMoreChild("/profile/language")).toBe(true);
    expect(isFrontDeskMoreChild("/lost-found")).toBe(true);
    expect(isFrontDeskMoreChild(null)).toBe(false);
  });
});

describe("guest requests: the real API contract", () => {
  const real = {
    id: "g1",
    title: "Extra towels",
    description: "Two more bath towels",
    status: "dispatched",
    priority: "urgent",
    category: "housekeeping",
    created_at: "2026-11-05T15:00:00Z",
    due_at: "2026-11-05T19:00:00Z",
    rooms: { room_number: "214" },
    work_orders: [],
  };

  it("reads the table row shape", () => {
    const v = normalizeGuestRequest(real);
    expect(v).toMatchObject({ id: "g1", title: "Extra towels", roomNumber: "214", stage: "inProgress", urgent: true, linkedWorkOrder: false, assignedToName: null });
  });

  it("still reads the legacy flat shape (fixtures, older payloads)", () => {
    const v = normalizeGuestRequest({ id: "g2", room_number: "9", request_type: "Towels", status: "escalated", priority: "emergency", assigned_to_name: "Sam" });
    expect(v).toMatchObject({ roomNumber: "9", title: "Towels", stage: "inProgress", urgent: true, assignedToName: "Sam" });
  });

  it("maps all nine real statuses and never guesses an unknown one", () => {
    const stages = ["open", "acknowledged", "dispatched", "arrived", "guest_contacted", "resolved", "verified", "reopened", "cancelled"].map(stageOf);
    expect(stages).toEqual(["open", "inProgress", "inProgress", "inProgress", "inProgress", "resolved", "resolved", "open", "cancelled"]);
    expect(stageOf("something-new")).toBe("unknown");
    expect(stageOf(null)).toBe("unknown");
  });

  it("drops junk rows instead of throwing", () => {
    expect(normalizeGuestRequests(null)).toEqual([]);
    expect(normalizeGuestRequests({})).toEqual([]);
    expect(normalizeGuestRequests([null, 3, {}, { id: "ok" }]).map((r) => r.id)).toEqual(["ok"]);
  });

  it("counts honestly: a full page is a lower bound, and resolved-today uses the hotel's day", () => {
    const rows = normalizeGuestRequests([
      { id: "a", status: "open", priority: "urgent", created_at: "2026-11-05T10:00:00Z" },
      { id: "b", status: "open", created_at: "2026-11-05T09:00:00Z" },
      { id: "c", status: "arrived", created_at: "2026-11-05T08:00:00Z" },
      // 04:30 UTC on the 6th is 22:30 on the 5th in Chicago: today for the hotel, tomorrow for UTC.
      { id: "d", status: "resolved", resolved_at: "2026-11-06T04:30:00Z" },
      { id: "e", status: "resolved", resolved_at: "2026-11-04T12:00:00Z" },
      { id: "f", status: "cancelled" },
    ]);
    const now = new Date("2026-11-06T05:00:00Z"); // 23:00 on Nov 5 in Chicago
    const s = summarizeGuestRequests(rows, { pageSize: 100, now, timeZone: "America/Chicago" });
    expect(s).toMatchObject({ open: 2, inProgress: 1, urgentActive: 1, resolvedToday: 1, loaded: 6, partial: false });
    expect(formatCount(s.open, s.partial)).toBe("2");
    const full = summarizeGuestRequests(rows, { pageSize: 6, now, timeZone: "America/Chicago" });
    expect(full.partial).toBe(true);
    expect(formatCount(full.open, full.partial)).toBe("2+");
  });

  it("picks urgent first, then the longest-waiting open request", () => {
    const rows = normalizeGuestRequests([
      { id: "old-open", status: "open", created_at: "2026-11-05T01:00:00Z" },
      { id: "new-urgent", status: "open", priority: "urgent", created_at: "2026-11-05T09:00:00Z" },
      { id: "progress", status: "arrived", created_at: "2026-11-05T00:00:00Z" },
    ]);
    expect(pickNextRequest(rows)?.id).toBe("new-urgent");
    expect(pickNextRequest(rows.filter((r) => !r.urgent))?.id).toBe("old-open");
    expect(pickNextRequest(normalizeGuestRequests([{ id: "x", status: "resolved" }]))).toBeNull();
  });

  it("offers only the lifecycle steps the server allows, and cancel only to management", () => {
    expect(allowedTransitions("open", "front_desk")).toEqual(["acknowledged"]);
    expect(allowedTransitions("open", "gm")).toEqual(["acknowledged", "cancelled"]);
    expect(allowedTransitions("dispatched", "front_desk")).toEqual(["arrived", "resolved"]);
    expect(allowedTransitions("resolved", "front_desk")).toEqual(["verified", "reopened"]);
    expect(allowedTransitions("cancelled", "gm")).toEqual([]);
    expect(allowedTransitions("not-a-status", "gm")).toEqual([]);
    expect(allowedTransitions("open", null)).toEqual(["acknowledged"]);
  });
});

describe("room readiness", () => {
  const rows = [
    { status: "INSPECTED", fo_status: "VAC" },
    { status: "INSPECTED", fo_status: "OCC" },
    { status: "CLEAN", fo_status: "VAC" },
    { status: "DIRTY", fo_status: "OCC" },
    { status: "IN_PROGRESS", fo_status: "VAC" },
    { status: "PICKUP", fo_status: null },
    { status: "OCCUPIED", fo_status: null },
    { status: "OOO", fo_status: "VAC" },
    { status: "MYSTERY", fo_status: null },
  ];

  it("keeps condition, occupancy and availability separate", () => {
    const r = summarizeRoomReadiness(rows);
    expect(r).toMatchObject({ total: 9, inspected: 2, clean: 1, dirty: 1, inProgress: 1, pickup: 1, outOfOrder: 1, other: 1 });
    // Occupied by front-office status OR a stay-driven status; an occupied room is not folded into "dirty".
    expect(r.occupied).toBe(4);
    expect(r.vacant).toBe(5);
    expect(r.occupied + r.vacant).toBe(r.total);
    expect(isOccupiedBoardRow({ status: "OCCUPIED" })).toBe(true);
  });

  it("counts an out-of-order room as unavailable, not as clean or dirty", () => {
    const r = summarizeRoomReadiness([{ status: "OOO", fo_status: "VAC" }]);
    expect(r).toMatchObject({ outOfOrder: 1, dirty: 0, clean: 0, inspected: 0 });
  });

  it("reports an empty board as null, never 0%", () => {
    expect(readyPercent(summarizeRoomReadiness([]))).toBeNull();
    expect(readyPercent(summarizeRoomReadiness(rows))).toBe(22);
  });
});

describe("risk alerts: the real API contract", () => {
  const real = {
    housekeeping_risks: [{ room_id: "r1", risk_level: "HIGH", rooms: { room_number: "305" }, minutes_to_checkin: 40, risk_factors: ["late checkout", "short staffed"] }],
    sla_breaches: [{ work_order_number: 88, title: "AC not cooling", due_at: "2026-11-05T14:00:00Z" }],
    maintenance_risks: [{ id: "a1", name: "Chiller 2", failure_risk_score: 82 }],
    low_stock_parts: [{ id: "p1", name: "Filter 20x20", on_hand: 2, minimum_stock: 6 }],
    pending_guest_issues: [{ id: "g1", title: "Noise", description: "Loud hallway", rooms: { room_number: "110" } }],
    recurring_issues: [{ key: "k", asset_name: "Ice machine", wo_count: 3, window_days: 30 }],
  };

  it("adapts the object of lists into tiered items without inventing a severity", () => {
    const { items, cappedKinds } = adaptRiskAlerts(real);
    expect(items.map((i) => i.kind)).toEqual(["sla_breach", "room_risk", "asset_risk", "low_stock", "guest_issue", "recurring"]);
    expect(items.every((i) => i.severity === null)).toBe(true);
    expect(items.filter((i) => i.tier === "attention").map((i) => i.kind)).toEqual(["sla_breach", "room_risk"]);
    expect(countByTier(items)).toEqual({ attention: 2, watch: 4 });
    expect(cappedKinds).toEqual([]);
  });

  it("links only to destinations that exist", () => {
    const { items } = adaptRiskAlerts(real);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toEqual(["/(app)/work-orders", "/(app)/room-status", "/(app)/assets/a1", null, "/(app)/guest-requests/g1", null]);
  });

  it("flags the lists the server caps when they are full", () => {
    const assets = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, failure_risk_score: 70 + i }));
    const issues = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, title: `G${i}` }));
    expect(adaptRiskAlerts({ maintenance_risks: assets, pending_guest_issues: issues }).cappedKinds).toEqual(["asset_risk", "guest_issue"]);
  });

  it("still accepts the older array shape, keeping its severity", () => {
    const { items } = adaptRiskAlerts([{ id: "x", severity: "critical", title: "T", description: "D", asset_name: "Elevator" }, { id: "y", severity: "low", title: "U", description: "E" }]);
    expect(items.map((i) => [i.kind, i.tier, i.severity])).toEqual([["legacy", "attention", "critical"], ["legacy", "watch", "low"]]);
  });

  it("returns nothing for junk instead of throwing", () => {
    for (const bad of [null, undefined, 4, "x", {}]) expect(adaptRiskAlerts(bad).items).toEqual([]);
  });

  it("describes each kind through translated templates", () => {
    const t = makeTranslator("en");
    const stamp = (iso: string | null) => (iso ? "2:00 PM" : null);
    const byKind = Object.fromEntries(adaptRiskAlerts(real).items.map((i) => [i.kind, describeAlert(i, t, stamp)]));
    expect(byKind.sla_breach).toEqual({ title: "AC not cooling", detail: "Work order 88 · Due 2:00 PM" });
    expect(byKind.room_risk.title).toBe("Room 305");
    expect(byKind.room_risk.detail).toContain("Check-in in 40 min");
    expect(byKind.asset_risk.detail).toBe("82% failure risk");
    expect(byKind.low_stock.detail).toBe("2 on hand, minimum 6");
    expect(byKind.recurring).toEqual({ title: "Ice machine", detail: "3 work orders in 30 days" });
  });
});

describe("home status line", () => {
  const ok = { status: "ready" as const, stale: false, fetchedAt: 1000 };
  it("is honest about every state", () => {
    expect(homeStatus(true, [ok, ok]).kind).toBe("live");
    expect(homeStatus(true, [{ status: "loading", stale: false, fetchedAt: null }]).kind).toBe("loading");
    expect(homeStatus(true, [ok, { status: "error", stale: false, fetchedAt: null }]).kind).toBe("partial");
    expect(homeStatus(true, [{ status: "error", stale: false, fetchedAt: null }]).kind).toBe("failed");
    expect(homeStatus(true, [{ ...ok, stale: true }, ok]).kind).toBe("stale");
    expect(homeStatus(false, [ok]).kind).toBe("offline");
    expect(homeStatus(false, [{ status: "idle", stale: false, fetchedAt: null }]).kind).toBe("offlineEmpty");
  });
  it("reports the oldest successful fetch", () => {
    expect(homeStatus(true, [{ ...ok, fetchedAt: 5000 }, { ...ok, fetchedAt: 2000 }]).updatedAt).toBe(2000);
  });
});

describe("Phase 6 copy and styling hygiene", () => {
  const V2_FILES = [
    "components/home/FrontDeskHome.tsx",
    "components/home/GMHome.tsx",
    "components/management/HomeParts.tsx",
    "components/management/ManagementHeader.tsx",
    "components/frontDesk/FrontDeskMore.tsx",
    "components/frontDesk/GuestRequestsV2.tsx",
    "components/gm/AlertsV2.tsx",
    "components/gm/StaffV2.tsx",
    "app/(app)/guest-requests/[requestId].tsx",
  ];
  const root = resolve(__dirname, "../..");

  it("new V2 surfaces use no shouting labels, monospace or hard-coded status colours", () => {
    for (const rel of V2_FILES) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src).not.toMatch(/textTransform:\s*"uppercase"/);
      expect(src).not.toMatch(/toUpperCase\(\)/);
      expect(src).not.toMatch(/monoFont|displayFont|serifFont/);
      expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });

  it("every new string exists in English and Spanish", () => {
    const keys = [
      "managementHome.status.live", "managementHome.notice.partial", "frontDeskHome.requests.partial", "frontDeskHome.rooms.separate",
      "gmHome.overview.title", "gmHome.attention.none", "frontDeskMore.signOut", "guestRequestsV2.detail.action.cancelled",
      "guestRequestsV2.status.guest_contacted", "alertsV2.kinds.sla_breach", "alertsV2.error.body", "staffV2.note",
      "lostFound.logSubmit", "lostFound.ago.hours", "roomStatusV2.updated", "logbook.loadFailed",
    ];
    for (const key of keys) {
      expect(localeHasKey("en", key)).toBe(true);
      expect(localeHasKey("es", key)).toBe(true);
    }
  });

  it("English and Spanish carry the same keys under every Phase 6 namespace", () => {
    const en = JSON.parse(readFileSync(join(root, "i18n/locales/en.json"), "utf8"));
    const es = JSON.parse(readFileSync(join(root, "i18n/locales/es.json"), "utf8"));
    const flat = (o: unknown, prefix = ""): string[] =>
      o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
    for (const ns of ["managementHome", "frontDeskHome", "gmHome", "frontDeskMore", "guestRequestsV2", "alertsV2", "staffV2", "roomStatusV2"]) {
      expect(flat(es[ns]).sort()).toEqual(flat(en[ns]).sort());
    }
    expect(flat(es.lostFound).sort()).toEqual(flat(en.lostFound).sort());
  });

});

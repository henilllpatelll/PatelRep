import { normalizeBoardRecords, attachLateCheckouts, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import type { BoardRoomView, BoardStaffMember, MutationGate } from "@/lib/housekeeping/roomBoardState";
import { buildRoomDetail, formatMoment, MAX_DETAIL_FLAGS, type RoomDetailContext } from "@/lib/housekeeping/roomDetailView";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { makeTranslator, type Language } from "../helpers/i18n";
import { NOW, ZONE, rawRoom } from "../helpers/roomBoardFixtures";

/* The Room Detail drawer's rules, with the REAL English and Spanish strings (a missing key would surface as a raw
   "roomBoard.…" string and fail the "no raw keys" check). NOW is 12:00 noon on 2026-10-16 in Chicago. */

const ALLOWED: MutationGate = { allowed: true, blockedBy: null };

function ctx(overrides: Partial<RoomDetailContext> = {}, language: Language = "en"): RoomDetailContext {
  return {
    now: NOW,
    timeZone: ZONE,
    language,
    gate: ALLOWED,
    verifiedClock: "11:59 AM",
    live: true,
    rosterTrust: "verified",
    staff: [],
    staffNamesKnown: true,
    lateCheckoutsKnown: true,
    t: makeTranslator(language),
    ...overrides,
  };
}

function viewOf(
  raw: BoardRoomRaw,
  options: { assignee?: BoardRoomView["assignee"]; late?: Parameters<typeof attachLateCheckouts>[1] } = {},
): BoardRoomView {
  const [base] = normalizeBoardRecords([raw]).rooms;
  const [room] = attachLateCheckouts([base], options.late ?? null) as [BoardRoom];
  return { room, assignee: options.assignee ?? null };
}

const MARIA = { userId: "hk-1", name: "Maria Santos", availability: "on_shift" as const };
const member = (overrides: Partial<BoardStaffMember> = {}): BoardStaffMember => ({
  userId: "hk-1", name: "Maria Santos", role: "housekeeper", availability: "on_shift", assignedRooms: 8, openRooms: 5, ...overrides,
});
const assigned = { assigned_to: "hk-1", assignment_id: "as-1", assignment_date: "2026-10-16" } as const;
const row = (detail: ReturnType<typeof buildRoomDetail>, key: string) => detail.statusRows.find((r) => r.key === key);

describe("room identity", () => {
  it("shows the room, its type and a location made only of what the backend sent", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("201", "DIRTY")), ctx());
    expect(detail.roomNumber).toBe("201");
    expect(detail.roomType).toBe("K");
    expect(detail.location).toBe("Floor 2 · Building A");
  });

  it("keeps alphanumeric room identifiers exactly as sent", () => {
    expect(buildRoomDetail(viewOf(rawRoom("PH-12A", "DIRTY")), ctx()).roomNumber).toBe("PH-12A");
  });

  it("omits a missing room type and says the floor is unknown instead of showing floor 0", () => {
    const raw = rawRoom("77", "DIRTY", { rooms: { id: "room-77", room_number: "77", floor: null, building: null } });
    const detail = buildRoomDetail(viewOf(raw), ctx());
    expect(detail.roomType).toBeNull();
    expect(detail.location).toBe("Floor not set");
  });
});

describe("status and occupancy", () => {
  it.each([
    ["DIRTY", "Dirty"],
    ["OCCUPIED", "Occupied"],
    ["PICKUP", "Pickup"],
    ["IN_PROGRESS", "In progress"],
    ["CLEAN", "To inspect"],
    ["INSPECTED", "Ready"],
    ["OOO", "Out of order"],
    ["OUT_OF_ORDER", "Out of order"],
    ["OUT_OF_SERVICE", "Out of service"],
  ])("labels %s as %s and keeps the raw status for the protected colours", (status, label) => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", status)), ctx());
    expect(detail.statusLabel).toBe(label);
    expect(detail.rawStatus).toBe(status);
  });

  it("CLEAN means submitted and awaiting inspection — never guest ready", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "CLEAN", { inspection_required: true })), ctx());
    expect(row(detail, "housekeeping")?.value).toBe("Submitted — awaiting inspection");
    expect(row(detail, "inspection")?.value).toBe("Required — not yet inspected");
  });

  it("INSPECTED is the guest-ready state, with the inspection time when recorded", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "INSPECTED", { last_inspected_at: "2026-10-16T15:30:00Z" })), ctx());
    expect(row(detail, "housekeeping")?.value).toBe("Inspected — guest ready");
    expect(row(detail, "inspection")?.value).toBe("Inspected Today, 10:30 AM");
  });

  it("keeps out-of-order and out-of-service distinguishable", () => {
    const ooo = buildRoomDetail(viewOf(rawRoom("101", "OUT_OF_ORDER")), ctx());
    const oos = buildRoomDetail(viewOf(rawRoom("101", "OUT_OF_SERVICE")), ctx());
    expect(row(ooo, "housekeeping")?.value).toBe("Out of order");
    expect(row(oos, "housekeeping")?.value).toBe("Out of service");
    expect(ooo.statusLabel).not.toBe(oos.statusLabel);
  });

  it("an unrecognised status is shown as not recognised and offers no action", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "MYSTERY")), ctx());
    expect(detail.statusLabel).toBe("Unknown");
    expect(row(detail, "housekeeping")?.value).toBe("Status not recognized");
    expect(detail.primary).toBeNull();
    expect(detail.menu).toEqual([]);
  });

  it("front-office occupancy is its own row, separate from the housekeeping status, with an honest unknown", () => {
    expect(row(buildRoomDetail(viewOf(rawRoom("101", "OCCUPIED", { fo_status: "OCC" })), ctx()), "occupancy")?.value).toBe("Occupied");
    expect(row(buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { fo_status: "VAC" })), ctx()), "occupancy")?.value).toBe("Vacant");
    const unknown = row(buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { fo_status: null })), ctx()), "occupancy");
    expect(unknown).toMatchObject({ value: "Unknown", muted: true });
  });

  it("flags a front-desk / housekeeping disagreement instead of picking a side", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { occupancy_discrepancy: true })), ctx());
    expect(row(detail, "discrepancy")?.value).toBe("Front desk and housekeeping disagree");
  });
});

describe("timing", () => {
  it("formats checkout and the next arrival in the hotel's zone, not the phone's", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { checkout_time: "2026-10-16T16:00:00Z", checkin_time: "2026-10-16T19:00:00Z" })), ctx());
    expect(row(detail, "checkout")?.value).toBe("Today, 11:00 AM");
    expect(row(detail, "arrival")?.value).toBe("Today, 2:00 PM");
  });

  it("names the day when a time is not today", () => {
    expect(formatMoment("2026-10-17T19:00:00Z", ctx())).toBe("Oct 17, 2:00 PM");
  });

  it("never invents a time: missing checkout and arrival read 'Not available'", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx());
    expect(row(detail, "checkout")).toMatchObject({ value: "Not available", muted: true });
    expect(row(detail, "arrival")).toMatchObject({ value: "Not available", muted: true });
    expect(formatMoment("not-a-date", ctx())).toBeNull();
  });

  it("shows the actual checkout when recorded", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { actual_checkout_at: "2026-10-16T15:15:00Z" })), ctx());
    expect(row(detail, "actualCheckout")?.value).toBe("Today, 10:15 AM");
  });

  it("a pending late checkout is never shown as approved; an approved one is", () => {
    const pending = buildRoomDetail(viewOf(rawRoom("101", "OCCUPIED"), { late: [{ id: "l1", room_id: "room-101", status: "pending", requested_time: "2026-10-16T19:00:00Z" }] }), ctx());
    expect(row(pending, "late")?.value).toBe("Pending approval · Today, 2:00 PM");
    expect(pending.flags.map((f) => f.label)).toContain("Late checkout requested");
    expect(pending.flags.map((f) => f.label)).not.toContain("Late checkout");

    const approved = buildRoomDetail(viewOf(rawRoom("101", "OCCUPIED"), { late: [{ id: "l1", room_id: "room-101", status: "approved", requested_time: null }] }), ctx());
    expect(row(approved, "late")?.value).toBe("Approved");
    expect(approved.flags.map((f) => f.label)).toContain("Late checkout");
  });

  it("says late checkout status is unavailable when that source could not be verified (not 'none')", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "OCCUPIED")), ctx({ lateCheckoutsKnown: false }));
    expect(row(detail, "late")).toMatchObject({ value: "Status unavailable", muted: true });
    expect(row(buildRoomDetail(viewOf(rawRoom("101", "OCCUPIED")), ctx({ lateCheckoutsKnown: true })), "late")).toBeUndefined();
  });

  it("an arrival later today is a header flag", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { checkin_time: "2026-10-16T19:00:00Z" })), ctx());
    expect(detail.flags.map((f) => f.label)).toContain("Arrival 2:00 PM");
  });
});

describe("flags", () => {
  it("is capped so the header is not a wall of badges, most important first", () => {
    const raw = rawRoom("101", "DIRTY", {
      vip_flag: true, dnd_flag: true, do_not_service: true, reclean_requested_at: "2026-10-16T15:00:00Z",
      priority: 2, clean_type: "DEP", clean_type_label: "Departure", prediction: { risk_level: "HIGH" },
    });
    const flags = buildRoomDetail(viewOf(raw), ctx()).flags;
    expect(flags).toHaveLength(MAX_DETAIL_FLAGS);
    expect(flags.map((f) => f.key)).toEqual(["vip", "dnd", "declined", "reclean"]);
  });

  it("marks departure cleans, and other clean types by the backend's own label", () => {
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { clean_type: "DEP", clean_type_label: "Departure" })), ctx()).flags[0].label).toBe("Departure");
    expect(buildRoomDetail(viewOf(rawRoom("101", "PICKUP", { clean_type: "FULL", clean_type_label: "Stayover" })), ctx()).flags[0].label).toBe("Stayover");
  });

  it("only an elevated stored priority is 'High priority' (the schema default is not)", () => {
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { priority: 5 })), ctx()).flags).toEqual([]);
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { priority: 2 })), ctx()).flags.map((f) => f.key)).toEqual(["priority"]);
  });

  it("a room with nothing notable has no flags", () => {
    expect(buildRoomDetail(viewOf(rawRoom("101", "INSPECTED")), ctx()).flags).toEqual([]);
  });
});

describe("assignment", () => {
  it("assigned and named: shows the person, their workload and verified shift status", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", assigned), { assignee: MARIA }), ctx({ staff: [member()] }));
    expect(detail.assignment).toEqual({
      kind: "named", name: "Maria Santos", headline: "Maria Santos", workload: "8 rooms assigned today", shift: "On shift",
    });
    expect(detail.accessibilityLabel).toBe("Room 101, Dirty, assigned to Maria Santos");
  });

  it("unassigned says Unassigned", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx());
    expect(detail.assignment).toMatchObject({ kind: "none", headline: "Unassigned", workload: null, shift: null });
  });

  it("an assigned room whose name is unavailable is still ASSIGNED — never shown as unassigned", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", assigned), { assignee: { userId: "hk-1", name: null, availability: "unknown" } }), ctx({ staffNamesKnown: false }));
    expect(detail.assignment).toMatchObject({ kind: "unnamed", name: null, headline: "Assigned · Name unavailable", workload: null });
    expect(detail.assignment.headline).not.toBe("Unassigned");
    expect(detail.accessibilityLabel).toContain("assigned, name unavailable");
  });

  it("shift availability is separate from assignment and honest when the roster is unverified", () => {
    const view = viewOf(rawRoom("101", "DIRTY", assigned), { assignee: { ...MARIA, availability: "unknown" } });
    expect(buildRoomDetail(view, ctx({ staff: [member()] })).assignment.shift).toBe("Shift status unavailable");
    const ended = viewOf(rawRoom("101", "DIRTY", assigned), { assignee: { ...MARIA, availability: "ended" } });
    expect(buildRoomDetail(ended, ctx({ staff: [member()] })).assignment.shift).toBe("Shift ended");
    const absent = viewOf(rawRoom("101", "DIRTY", assigned), { assignee: { ...MARIA, availability: "not_clocked_in" } });
    expect(buildRoomDetail(absent, ctx({ staff: [member()] })).assignment.shift).toBe("Not clocked in today");
  });

  it("a one-room workload reads singular", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", assigned), { assignee: MARIA }), ctx({ staff: [member({ assignedRooms: 1 })] }));
    expect(detail.assignment.workload).toBe("1 room assigned today");
  });

  it("an out-of-service room with nobody on it is not 'unassigned work'", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "OOO")), ctx());
    expect(detail.assignment.kind).toBe("not_applicable");
    expect(detail.primary).toBeNull();
  });
});

describe("cleaning activity", () => {
  const session = {
    last_session_id: "s1", last_clean_minutes: 31, last_clean_base_minutes: 30, last_clean_checklist_done: 12,
    last_clean_checklist_total: 12, last_clean_photo_count: 3, last_clean_ended_at: "2026-10-16T15:42:00Z",
  };

  it("a completed session shows time, duration, baseline, checklist and the photo COUNT (not loaded photos)", () => {
    const { cleaning } = buildRoomDetail(viewOf(rawRoom("101", "CLEAN", session)), ctx());
    expect(cleaning.kind).toBe("completed");
    const values = Object.fromEntries(cleaning.rows.map((r) => [r.key, r.value]));
    expect(values).toEqual({
      completed: "Today, 10:42 AM",
      duration: "31 min · baseline 30 min",
      checklist: "12 / 12",
      photos: "3 recorded",
    });
  });

  it("never names a cleaner — the session summary has no identity and today's assignment is not evidence", () => {
    const view = viewOf(rawRoom("101", "CLEAN", { ...session, ...assigned }), { assignee: MARIA });
    const { cleaning } = buildRoomDetail(view, ctx({ staff: [member()] }));
    expect(JSON.stringify(cleaning)).not.toContain("Maria");
  });

  it("missing duration and checklist are labelled, not zero", () => {
    const { cleaning } = buildRoomDetail(viewOf(rawRoom("101", "CLEAN", { last_session_id: "s1", last_clean_ended_at: null })), ctx());
    const by = Object.fromEntries(cleaning.rows.map((r) => [r.key, r]));
    expect(by.duration).toMatchObject({ value: "Not available", muted: true });
    expect(by.checklist).toMatchObject({ value: "Not recorded", muted: true });
    expect(by.completed).toMatchObject({ value: "Not available", muted: true });
    expect(by.photos.value).toBe("0 recorded");
  });

  it("no session: live board says none today; a stale board says so and does not claim 'none'", () => {
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx()).cleaning).toEqual({ kind: "none", message: "No completed cleaning session today.", rows: [] });
    const stale = buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx({ live: false, verifiedClock: "11:10 AM" })).cleaning;
    expect(stale.message).toBe("No completed cleaning session as of 11:10 AM. This board is not live.");
  });

  it("in progress without a completed session does not invent progress", () => {
    const { cleaning } = buildRoomDetail(viewOf(rawRoom("101", "IN_PROGRESS")), ctx());
    expect(cleaning.kind).toBe("in_progress");
    expect(cleaning.rows).toEqual([]);
  });
});

describe("notes, work order and service exceptions", () => {
  it("shows the latest note verbatim, with its time only when the board has one", () => {
    const long = "Guest requested extra towels and a crib; ".repeat(8).trim();
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { latest_note: long, latest_note_at: "2026-10-16T14:00:00Z" })), ctx());
    expect(detail.note).toEqual({ text: long, at: "Today, 9:00 AM" });
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { latest_note: "x" })), ctx()).note).toEqual({ text: "x", at: null });
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx()).note).toBeNull();
  });

  it("an open work order shows title, status, priority and number — and nothing it was not given", () => {
    const wo = { open_work_order_id: "wo-1", open_work_order_number: "WO-1042", open_work_order_title: "Bathroom faucet leaking", open_work_order_status: "in_progress", open_work_order_priority: "high" };
    expect(buildRoomDetail(viewOf(rawRoom("101", "OOO", wo)), ctx()).workOrder).toEqual({
      title: "Bathroom faucet leaking", number: "WO-1042", status: "In progress", priority: "High",
    });
    expect(buildRoomDetail(viewOf(rawRoom("101", "OOO", { open_work_order_id: "wo-2" })), ctx()).workOrder).toEqual({
      title: "Maintenance issue", number: null, status: null, priority: null,
    });
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx()).workOrder).toBeNull();
  });

  it("DND and declined service are separate exceptions, and DND offers the (confirmed) wellness check", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "OCCUPIED", { dnd_flag: true, do_not_service: true, service_declined_reason: "Guest request", service_declined_note: "Back at 3" })), ctx());
    expect(detail.exceptions.map((e) => e.key)).toEqual(["dnd", "declined"]);
    expect(detail.exceptions[0].body).toContain("wellness check");
    expect(detail.exceptions[1].body).toBe("Guest request — Back at 3");
    expect(detail.wellnessCheck).toBe(true);
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx()).wellnessCheck).toBe(false);
  });

  it("a HIGH readiness risk is labelled a forecast; a missing prediction adds nothing", () => {
    const risky = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { prediction: { risk_level: "HIGH", predicted_ready_at: "2026-10-16T20:00:00Z" } })), ctx());
    expect(risky.exceptions[0].body).toBe("Forecast ready around Today, 3:00 PM. It is a forecast, not a fact.");
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { prediction: null })), ctx()).exceptions).toEqual([]);
  });
});

describe("actions", () => {
  it("to-clean + unassigned: primary Assign; assigned: primary Reassign with Remove in More actions", () => {
    const unassigned = buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx());
    expect(unassigned.primary).toMatchObject({ key: "assign", label: "Assign room", disabled: false });
    expect(unassigned.menu).toEqual([]);

    const mine = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", assigned), { assignee: MARIA }), ctx());
    expect(mine.primary?.key).toBe("reassign");
    expect(mine.menu.map((a) => a.key)).toEqual(["remove"]);
    expect(mine.menu[0].destructive).toBe(true);
  });

  it("awaiting inspection: primary Inspect, never a status change", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "CLEAN")), ctx());
    expect(detail.primary).toMatchObject({ key: "inspect", disabled: false });
    expect(detail.menu).toEqual([]);
  });

  it("in progress: no primary, reassign and remove live in More actions", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("104", "IN_PROGRESS", assigned), { assignee: MARIA }), ctx());
    expect(detail.primary).toBeNull();
    expect(detail.menu.map((a) => a.key)).toEqual(["reassign", "remove"]);
  });

  it("inspected and out-of-service rooms offer no status-changing primary action", () => {
    expect(buildRoomDetail(viewOf(rawRoom("106", "INSPECTED")), ctx()).primary).toBeNull();
    expect(buildRoomDetail(viewOf(rawRoom("107", "OOO", { open_work_order_id: "wo-1" })), ctx()).primary).toBeNull();
  });

  it("a mirror-only assignment can still be removed (through its room)", () => {
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: null }), { assignee: MARIA }), ctx());
    expect(detail.menu.map((a) => a.key)).toContain("remove");
  });

  it("offers nothing that does not exist yet: no history, note, or work-order actions", () => {
    const wo = { open_work_order_id: "wo-1", open_work_order_title: "Faucet" };
    const detail = buildRoomDetail(viewOf(rawRoom("101", "DIRTY", { ...assigned, ...wo }), { assignee: MARIA }), ctx());
    for (const a of [detail.primary, ...detail.menu]) expect(["assign", "reassign", "remove", "inspect"]).toContain(a?.key);
  });

  it.each([
    ["offline", { allowed: false, blockedBy: "offline" }, "You're offline. Changes are paused until you reconnect."],
    ["stale", { allowed: false, blockedBy: "stale" }, "This board is not live (last verified 11:59 AM). Changes are paused."],
    ["unavailable", { allowed: false, blockedBy: "unavailable" }, "The board could not be verified. Changes are paused."],
    ["previous day", { allowed: false, blockedBy: "previous_day" }, "This board is from a previous day. Changes are paused."],
  ] as const)("a %s board pauses every change but still allows reading and inspecting", (_name, gate, message) => {
    const view = viewOf(rawRoom("101", "DIRTY", assigned), { assignee: MARIA });
    const detail = buildRoomDetail(view, ctx({ gate: gate as MutationGate }));
    expect(detail.paused).toBe(message);
    expect(detail.primary?.disabled).toBe(true);
    expect(detail.menu.every((a) => a.disabled)).toBe(true);
    expect(buildRoomDetail(viewOf(rawRoom("102", "CLEAN")), ctx({ gate: gate as MutationGate })).primary?.disabled).toBe(false);
  });

  it("a live board has no paused message", () => {
    expect(buildRoomDetail(viewOf(rawRoom("101", "DIRTY")), ctx()).paused).toBeNull();
  });
});

describe("localisation", () => {
  const busy = rawRoom("201", "CLEAN", {
    vip_flag: true, dnd_flag: true, ...assigned, inspection_required: true, checkout_time: "2026-10-16T16:00:00Z",
    latest_note: "Toallas extra", latest_note_at: "2026-10-16T14:00:00Z", prediction: { risk_level: "HIGH" },
    open_work_order_id: "wo-1", open_work_order_status: "on_hold", open_work_order_priority: "urgent",
    last_session_id: "s1", last_clean_minutes: 31, last_clean_checklist_done: 3, last_clean_checklist_total: 4, last_clean_photo_count: 2, last_clean_ended_at: "2026-10-16T15:42:00Z",
  });
  const late = [{ id: "l1", room_id: "room-201", status: "pending", requested_time: "2026-10-16T19:00:00Z" }];

  it.each(["en", "es"] as const)("renders every string for the whole detail in %s without a raw key", (language) => {
    const view = viewOf(busy, { assignee: MARIA, late });
    const detail = buildRoomDetail(view, ctx({ staff: [member()], gate: { allowed: false, blockedBy: "stale" } }, language));
    const text = JSON.stringify(detail);
    expect(text).not.toMatch(/roomBoard\.|workOrders\.|\{\{/);
  });

  it("Spanish reads Spanish and Spanish times use the hotel zone", () => {
    const view = viewOf(rawRoom("201", "DIRTY", { checkout_time: "2026-10-16T16:00:00Z" }));
    const detail = buildRoomDetail(view, ctx({}, "es"));
    expect(row(detail, "checkout")?.value).toBe("Hoy, 11:00 a.m.");
    expect(detail.primary?.label).toBe("Asignar habitación");
    expect(detail.assignment.headline).toBe("Sin asignar");
  });
});

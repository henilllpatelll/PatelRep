import {
  ADD_TASK_LIMITS,
  ADD_TASK_PRIORITIES,
  ADD_TASK_TYPES,
  dueFromIso,
  emptyDraft,
  hasMeaningfulContent,
  newRequestId,
  resolveDue,
  toCreateInput,
  validateDraft,
  type TaskDraft,
} from "@/lib/tasks/addTask/draft";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-13T17:00:00Z"); // 12:00 noon in Chicago (CDT, UTC-5)

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return { ...emptyDraft("housekeeper"), title: "Deliver two extra pillows", ...overrides };
}

describe("Add Task draft — enums match the backend", () => {
  it("offers only task types and priorities the API accepts", () => {
    // POST /tasks task_type: housekeeping | engineering | guest_request | lost_found | general
    // POST /tasks priority:  urgent | normal | low
    expect([...ADD_TASK_TYPES].sort()).toEqual(["engineering", "general", "guest_request", "housekeeping"]);
    expect([...ADD_TASK_PRIORITIES].sort()).toEqual(["low", "normal", "urgent"]);
  });

  it("limits mirror the API field maximums", () => {
    expect(ADD_TASK_LIMITS).toEqual({ request: 2000, title: 120, description: 2000, place: 255 });
  });
});

describe("Add Task draft — due times in the hotel's calendar", () => {
  it("reads today's time on the hotel clock", () => {
    const result = resolveDue({ mode: "set", day: "today", time: "2:00 PM", iso: null }, ZONE, NOW);
    expect(result).toEqual({ ok: true, iso: "2026-10-13T19:00:00.000Z" });
  });

  it("reads tomorrow's time on the hotel clock", () => {
    const result = resolveDue({ mode: "set", day: "tomorrow", time: "9:00 AM", iso: null }, ZONE, NOW);
    expect(result).toEqual({ ok: true, iso: "2026-10-14T14:00:00.000Z" });
  });

  it("uses the hotel's date, not UTC's, around midnight", () => {
    // 10 PM on Oct 13 in Chicago is already Oct 14 in UTC.
    const lateNow = new Date("2026-10-14T03:00:00Z");
    const result = resolveDue({ mode: "set", day: "today", time: "11:30 PM", iso: null }, ZONE, lateNow);
    expect(result).toEqual({ ok: true, iso: "2026-10-14T04:30:00.000Z" });
    expect(dueFromIso("2026-10-14T14:00:00Z", ZONE, lateNow)).toMatchObject({ mode: "set", day: "tomorrow", time: "9:00 AM" });
  });

  it("follows the daylight-saving change (tomorrow is Nov 1, CST = UTC-6)", () => {
    const beforeFallBack = new Date("2026-10-31T20:00:00Z"); // 3 PM CDT
    const result = resolveDue({ mode: "set", day: "tomorrow", time: "1:30 PM", iso: null }, ZONE, beforeFallBack);
    expect(result).toEqual({ ok: true, iso: "2026-11-01T19:30:00.000Z" });
  });

  it("a different hotel zone gives a different instant for the same words", () => {
    const result = resolveDue({ mode: "set", day: "today", time: "2:00 PM", iso: null }, "America/Los_Angeles", NOW);
    expect(result).toEqual({ ok: true, iso: "2026-10-13T21:00:00.000Z" });
  });

  it("refuses a time that has passed instead of rolling it to tomorrow", () => {
    expect(resolveDue({ mode: "set", day: "today", time: "9:00 AM", iso: null }, ZONE, NOW)).toEqual({ ok: false, reason: "past" });
  });

  it("refuses text that is not a time", () => {
    expect(resolveDue({ mode: "set", day: "today", time: "soon", iso: null }, ZONE, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(resolveDue({ mode: "set", day: "today", time: "", iso: null }, ZONE, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("an ambiguous suggestion stays unresolved until corrected or removed", () => {
    expect(resolveDue({ mode: "unresolved" }, ZONE, NOW)).toEqual({ ok: false, reason: "unresolved" });
    expect(resolveDue({ mode: "none" }, ZONE, NOW)).toEqual({ ok: true, iso: null });
  });

  it("keeps a later date the AI understood, and checks it is still in the future", () => {
    const later = dueFromIso("2026-10-20T15:00:00Z", ZONE, NOW);
    expect(later).toMatchObject({ mode: "set", day: "other", iso: "2026-10-20T15:00:00Z" });
    expect(resolveDue(later, ZONE, NOW)).toEqual({ ok: true, iso: "2026-10-20T15:00:00.000Z" });
    expect(resolveDue(later, ZONE, new Date("2026-10-21T00:00:00Z"))).toEqual({ ok: false, reason: "past" });
  });

  it("round-trips an AI time into the editor", () => {
    expect(dueFromIso("2026-10-13T19:00:00Z", ZONE, NOW)).toEqual({
      mode: "set",
      day: "today",
      time: "2:00 PM",
      iso: "2026-10-13T19:00:00Z",
    });
  });
});

describe("Add Task draft — validation", () => {
  it("accepts a complete housekeeping draft", () => {
    const result = validateDraft(draft(), ZONE, NOW);
    expect(result).toEqual({ errors: {}, valid: true, dueIso: null });
  });

  it("requires a title and enforces the title and description limits", () => {
    expect(validateDraft(draft({ title: "   " }), ZONE, NOW).errors.title).toBe("required");
    expect(validateDraft(draft({ title: "x".repeat(121) }), ZONE, NOW).errors.title).toBe("tooLong");
    expect(validateDraft(draft({ title: "x".repeat(120) }), ZONE, NOW).errors.title).toBeUndefined();
    expect(validateDraft(draft({ description: "y".repeat(2001) }), ZONE, NOW).errors.description).toBe("tooLong");
  });

  it("an unsupported category from the AI leaves the type unset until chosen", () => {
    expect(validateDraft(draft({ type: null }), ZONE, NOW).errors.type).toBe("required");
  });

  it("an AI-suggested Urgent priority needs confirming", () => {
    const suggested = draft({ priority: "urgent", priorityConfirmed: false });
    expect(validateDraft(suggested, ZONE, NOW).errors.priority).toBe("confirm");
    expect(validateDraft({ ...suggested, priorityConfirmed: true }, ZONE, NOW).errors.priority).toBeUndefined();
  });

  it("a room the AI could not verify blocks saving; a real room or a place does not", () => {
    expect(validateDraft(draft({ location: { kind: "unverified", text: "999" } }), ZONE, NOW).errors.location).toBe("unverified");
    expect(validateDraft(draft({ location: { kind: "room", roomId: "r1", roomNumber: "318" } }), ZONE, NOW).valid).toBe(true);
    expect(validateDraft(draft({ location: { kind: "place", text: "Pool deck" } }), ZONE, NOW).valid).toBe(true);
  });

  it("a location-only task is valid where no room is needed", () => {
    expect(validateDraft(draft({ type: "general", location: { kind: "place", text: "Lobby" } }), ZONE, NOW).valid).toBe(true);
    expect(validateDraft(draft({ type: "housekeeping", location: { kind: "none" } }), ZONE, NOW).valid).toBe(true);
  });

  it("an empty or oversize place is rejected", () => {
    expect(validateDraft(draft({ location: { kind: "place", text: "  " } }), ZONE, NOW).errors.location).toBe("placeRequired");
    expect(validateDraft(draft({ location: { kind: "place", text: "p".repeat(256) } }), ZONE, NOW).errors.location).toBe("placeTooLong");
  });

  it("a guest request needs a verified room, not just a place", () => {
    const guest = draft({ type: "guest_request" });
    expect(validateDraft(guest, ZONE, NOW).errors.location).toBe("roomRequired");
    expect(validateDraft({ ...guest, location: { kind: "place", text: "Lobby" } }, ZONE, NOW).errors.location).toBe("roomRequired");
    expect(validateDraft({ ...guest, location: { kind: "room", roomId: "r1", roomNumber: "318" } }, ZONE, NOW).valid).toBe(true);
  });

  it("surfaces an ambiguous or past due time as a due error", () => {
    expect(validateDraft(draft({ due: { mode: "unresolved" } }), ZONE, NOW).errors.due).toBe("unresolved");
    expect(validateDraft(draft({ due: { mode: "set", day: "today", time: "8:00 AM", iso: null } }), ZONE, NOW).errors.due).toBe("past");
  });
});

describe("Add Task draft — one request payload for both paths", () => {
  const room = { kind: "room", roomId: "11111111-1111-4111-8111-111111111111", roomNumber: "318" } as const;

  it("builds exactly the fields POST /tasks takes", () => {
    const d = draft({ description: "  Two firm pillows ", location: room, due: { mode: "set", day: "today", time: "2:00 PM", iso: null }, aiSuggested: true });
    const input = toCreateInput(d, validateDraft(d, ZONE, NOW), "user-1");

    expect(input).toEqual({
      title: "Deliver two extra pillows",
      description: "Two firm pillows",
      task_type: "housekeeping",
      priority: "normal",
      room_id: room.roomId,
      due_at: "2026-10-13T19:00:00.000Z",
      assigned_to: "user-1",
      client_request_id: d.requestId,
      ai_suggested: true,
    });
  });

  it("never sends a department, a free-text room, or a room and a place together", () => {
    const withPlace = draft({ location: { kind: "place", text: " Pool deck " } });
    const place = toCreateInput(withPlace, validateDraft(withPlace, ZONE, NOW), "user-1");
    expect(place).toMatchObject({ location_text: "Pool deck" });
    expect(place).not.toHaveProperty("room_id");
    expect(place).not.toHaveProperty("department_id");

    const withRoom = draft({ location: room });
    expect(toCreateInput(withRoom, validateDraft(withRoom, ZONE, NOW), "user-1")).not.toHaveProperty("location_text");
  });

  it("only ever names the signed-in person as assignee, and only when asked", () => {
    const mine = draft({ assignToMe: true });
    expect(toCreateInput(mine, validateDraft(mine, ZONE, NOW), "user-1")?.assigned_to).toBe("user-1");
    const pool = draft({ assignToMe: false });
    expect(toCreateInput(pool, validateDraft(pool, ZONE, NOW), "user-1")).not.toHaveProperty("assigned_to");
    expect(toCreateInput(mine, validateDraft(mine, ZONE, NOW), null)).not.toHaveProperty("assigned_to");
  });

  it("a manual draft is not labelled AI-suggested", () => {
    const manual = draft();
    expect(toCreateInput(manual, validateDraft(manual, ZONE, NOW), "u")).not.toHaveProperty("ai_suggested");
  });

  it("returns nothing for an invalid draft", () => {
    const bad = draft({ title: "" });
    expect(toCreateInput(bad, validateDraft(bad, ZONE, NOW), "u")).toBeNull();
  });

  it("each new draft has its own well-formed idempotency key", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(emptyDraft().requestId).not.toBe(emptyDraft().requestId);
  });
});

describe("Add Task draft — defaults and discard detection", () => {
  it("starts empty with role-appropriate defaults", () => {
    expect(emptyDraft("housekeeper")).toMatchObject({ type: "housekeeping", priority: "normal", assignToMe: true, aiSuggested: false });
    expect(emptyDraft("engineer").type).toBe("engineering");
    expect(hasMeaningfulContent(emptyDraft("housekeeper"))).toBe(false);
  });

  it("anything typed or chosen counts as unsaved work", () => {
    expect(hasMeaningfulContent(draft({ title: "", requestText: "pillows" }))).toBe(true);
    expect(hasMeaningfulContent(draft({ title: "" , location: { kind: "place", text: "Lobby" } }))).toBe(true);
    expect(hasMeaningfulContent({ ...emptyDraft("housekeeper"), due: { mode: "unresolved" } })).toBe(true);
    expect(hasMeaningfulContent({ ...emptyDraft("housekeeper"), requestText: "   " })).toBe(false);
  });
});

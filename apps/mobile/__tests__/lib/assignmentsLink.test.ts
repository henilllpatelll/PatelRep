import { assignmentsParams, linkNamesRecord, parseAssignmentsParams, resolveAssignmentsLink, safeLinkId } from "@/lib/navigation/assignmentsLink";
import { assignmentsHref, supervisorHref } from "@/lib/navigation/supervisorRoutes";
import { primaryFor } from "@/lib/housekeeping/supervisorAttentionCenter";
import type { SupervisorAttentionItem } from "@/lib/housekeeping/supervisorAttention";

describe("Assignments deep-link params", () => {
  it("round-trips every supported intent", () => {
    for (const intent of [
      { tab: "team" as const },
      { filter: "unassigned" as const },
      { filter: "urgent" as const },
      { roomId: "room-1" },
      { staffId: "hk-1" },
    ]) {
      const link = parseAssignmentsParams(assignmentsParams(intent));
      expect(link).not.toBeNull();
    }
    expect(parseAssignmentsParams(assignmentsParams({ filter: "unassigned" }))).toEqual({ tab: "rooms", filter: "unassigned", roomId: null, staffId: null });
    expect(parseAssignmentsParams(assignmentsParams({ filter: "urgent" }))).toEqual({ tab: "rooms", filter: "urgent", roomId: null, staffId: null });
    expect(parseAssignmentsParams(assignmentsParams({ tab: "team" }))).toEqual({ tab: "team", filter: null, roomId: null, staffId: null });
    expect(parseAssignmentsParams(assignmentsParams({ staffId: "hk-1" }))).toEqual({ tab: "team", filter: null, roomId: null, staffId: "hk-1" });
    expect(parseAssignmentsParams(assignmentsParams({ roomId: "room-101" }))).toEqual({ tab: "rooms", filter: null, roomId: "room-101", staffId: null });
  });

  it("asks for nothing when nothing usable is given", () => {
    expect(parseAssignmentsParams({})).toBeNull();
    expect(parseAssignmentsParams(null)).toBeNull();
    expect(parseAssignmentsParams({ tab: "bogus", filter: "everything" })).toBeNull();
    expect(assignmentsParams({})).toEqual({});
    expect(assignmentsHref({})).toEqual({ pathname: "/(app)/assignments" });
  });

  it("refuses malformed ids instead of looking them up", () => {
    for (const bad of ["", "  ", "a b", "../x", "x;drop", "a".repeat(65), "<script>", 42, {}, undefined, null]) {
      expect(safeLinkId(bad)).toBeNull();
    }
    expect(parseAssignmentsParams({ roomId: "../etc", staffId: "x y" })).toBeNull();
    expect(safeLinkId(["room-1", "other"])).toBe("room-1");
    expect(safeLinkId(" room-1 ")).toBe("room-1");
  });

  it("a record wins over a filter, a person implies Team, a filter is Rooms-only", () => {
    expect(parseAssignmentsParams({ roomId: "r1", staffId: "s1", filter: "urgent", tab: "team" })).toEqual({ tab: "rooms", filter: null, roomId: "r1", staffId: null });
    expect(parseAssignmentsParams({ staffId: "s1", tab: "rooms", filter: "urgent" })).toEqual({ tab: "team", filter: null, roomId: null, staffId: "s1" });
    expect(parseAssignmentsParams({ tab: "team", filter: "unassigned" })).toEqual({ tab: "team", filter: null, roomId: null, staffId: null });
    expect(linkNamesRecord(parseAssignmentsParams({ staffId: "s1" })!)).toBe(true);
    expect(linkNamesRecord(parseAssignmentsParams({ filter: "urgent" })!)).toBe(false);
  });

  it("resolves a record only against the hotel's own verified ids", () => {
    const rooms = new Set(["room-101"]);
    const staff = new Set(["hk-1"]);
    expect(resolveAssignmentsLink(parseAssignmentsParams({ roomId: "room-101" })!, rooms, staff)).toEqual({ room: "found", staff: null });
    expect(resolveAssignmentsLink(parseAssignmentsParams({ roomId: "other-hotel-room" })!, rooms, staff)).toEqual({ room: "missing", staff: null });
    expect(resolveAssignmentsLink(parseAssignmentsParams({ staffId: "hk-1" })!, rooms, staff)).toEqual({ room: null, staff: "found" });
    expect(resolveAssignmentsLink(parseAssignmentsParams({ staffId: "stranger" })!, rooms, staff)).toEqual({ room: null, staff: "missing" });
  });
});

describe("supervisor targets into Assignments", () => {
  it("emits typed params for the Today actions", () => {
    expect(supervisorHref({ screen: "team", assignments: { tab: "rooms", filter: "unassigned" } })).toEqual({
      pathname: "/(app)/assignments",
      params: { tab: "rooms", filter: "unassigned" },
    });
    expect(supervisorHref({ screen: "team", assignments: { filter: "urgent" } }).params).toEqual({ tab: "rooms", filter: "urgent" });
    expect(supervisorHref({ screen: "team", assignments: { tab: "team" } }).params).toEqual({ tab: "team" });
    expect(supervisorHref({ screen: "team", record: { type: "room", id: "room-1" } }).params).toEqual({ roomId: "room-1" });
    expect(supervisorHref({ screen: "team" })).toEqual({ pathname: "/(app)/assignments" });
  });

  function item(extra: Partial<SupervisorAttentionItem>): SupervisorAttentionItem {
    return {
      id: "x",
      kind: "unassigned_rooms",
      severity: "normal",
      subject: { type: "queue", id: "unassigned_rooms" },
      records: [],
      explain: { key: "k", params: {} },
      source: { sources: [], state: "verified", fetchedAt: 1 } as never,
      target: { screen: "team" },
      action: "assign_rooms",
      occurredAt: null,
      ...extra,
    } as SupervisorAttentionItem;
  }

  it("the Attention Center keeps the unassigned queue and the person it already knows", () => {
    expect(
      primaryFor(item({ target: { screen: "team", assignments: { tab: "rooms", filter: "unassigned" } } })).href,
    ).toEqual({ pathname: "/(app)/assignments", params: { tab: "rooms", filter: "unassigned" } });
    expect(
      primaryFor(item({ kind: "workload_over_assigned", action: "assign_rooms", target: { screen: "team", record: { type: "staff", id: "hk-1" } } })).href,
    ).toEqual({ pathname: "/(app)/assignments", params: { staffId: "hk-1" } });
    expect(
      primaryFor(item({ kind: "shift_ended_with_open_rooms", action: "open_team", target: { screen: "team", record: { type: "staff", id: "hk-2" } } })).href.params,
    ).toEqual({ staffId: "hk-2" });
  });
});

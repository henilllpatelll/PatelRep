/** Round-trips the dashboard's fields through the offline room cache. */
type Row = Record<string, unknown>;

const mockStore = new Map<string, Row>();
const mockRuns: Array<{ sql: string; params: unknown[] }> = [];

const mockDb = {
  runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
    mockRuns.push({ sql, params });
    if (/^DELETE FROM rooms$/.test(sql.trim())) {
      mockStore.clear();
      return;
    }
    const prune = /^DELETE FROM rooms WHERE assignment_date = \?(?: AND id NOT IN \(([^)]*)\))?$/.exec(sql.trim());
    if (prune) {
      const [date, ...keep] = params as string[];
      for (const [id, row] of [...mockStore]) {
        if (row.assignment_date === date && (prune[1] === undefined || !keep.includes(id))) mockStore.delete(id);
      }
      return;
    }
    const insert = /INSERT OR REPLACE INTO rooms \(([^)]+)\)\s+VALUES \(([^)]+)\)/.exec(sql);
    if (insert) {
      const columns = insert[1].split(",").map((c) => c.trim());
      const placeholders = insert[2].split(",").length;
      if (columns.length !== placeholders || columns.length !== params.length) {
        throw new Error(`column/placeholder/value mismatch: ${columns.length}/${placeholders}/${params.length}`);
      }
      mockStore.set(String(params[0]), Object.fromEntries(columns.map((c, i) => [c, params[i]])));
    }
  }),
  execAsync: jest.fn(async () => undefined),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
  getAllAsync: jest.fn(async (_sql: string, params: unknown[] = []) =>
    [...mockStore.values()].filter((row) => row.assignment_date === params[0]),
  ),
};

jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));

import { clearRoomsCache, getRoomsByDate, upsertRooms } from "@/lib/offline/db";

beforeEach(() => {
  mockStore.clear();
  mockRuns.length = 0;
});

describe("offline rooms cache", () => {
  it("keeps ordering, rush, access and reclean context across an offline restart", async () => {
    await upsertRooms([
      {
        id: "r1",
        room_number: "224",
        floor: 2,
        status: "DIRTY",
        dnd_flag: true,
        vip_flag: false,
        do_not_service: true,
        assignment_date: "2026-10-08",
        building: "East",
        sequence_order: 3,
        priority: 1,
        priority_reason: "vip",
        priority_needed_by: "2026-10-08T19:00:00Z",
        dnd_retry_at: "2026-10-08T18:30:00Z",
        dnd_attempt_count: 2,
        service_declined_reason: "Sleeping",
        reclean_requested_at: "2026-10-08T13:00:00Z",
        reclean_corrections: ["Dust vents", "Mirror"],
        rooms: { room_types: { name: "King", code: "K", base_clean_minutes: 35 } },
      },
    ]);

    const [cached] = (await getRoomsByDate("2026-10-08")) as Array<Record<string, unknown>>;
    expect(cached).toMatchObject({
      id: "r1",
      building: "East",
      sequence_order: 3,
      priority: 1,
      priority_needed_by: "2026-10-08T19:00:00Z",
      dnd_flag: true,
      do_not_service: true,
      dnd_retry_at: "2026-10-08T18:30:00Z",
      dnd_attempt_count: 2,
      reclean_corrections: ["Dust vents", "Mirror"],
      rooms: { room_types: { base_clean_minutes: 35 } },
    });
  });

  it("stores missing optional data as null and returns real booleans / no corrections", async () => {
    await upsertRooms([{ id: "r2", room_number: "101", floor: 1, status: "CLEAN", assignment_date: "2026-10-08" }]);
    const [cached] = (await getRoomsByDate("2026-10-08")) as Array<Record<string, unknown>>;
    expect(cached).toMatchObject({
      building: null,
      sequence_order: null,
      priority: null,
      dnd_flag: false,
      vip_flag: false,
      do_not_service: false,
      reclean_corrections: null,
      rooms: null,
    });
  });

  it("survives a corrupt corrections value instead of throwing", async () => {
    await upsertRooms([{ id: "r3", room_number: "102", floor: 1, status: "DIRTY", assignment_date: "2026-10-08" }]);
    mockStore.get("r3")!.reclean_corrections = "{not json";
    const [cached] = (await getRoomsByDate("2026-10-08")) as Array<Record<string, unknown>>;
    expect(cached.reclean_corrections).toBeNull();
  });

  it("persists priority, DND attempt history, decline and structured reclean details across an offline restart", async () => {
    const details = {
      inspection_id: "i1",
      inspected_at: "2026-10-08T14:00:00Z",
      overall_result: "failed",
      notes: "Needs another pass",
      items: [{ id: "ti-1", label: "Mirror", note: "Streaks" }],
    };
    await upsertRooms([
      {
        id: "r9",
        room_number: "314",
        floor: 3,
        status: "PICKUP",
        assignment_date: "2026-10-08",
        dnd_flag: true,
        dnd_started_at: "2026-10-08T15:00:00Z",
        dnd_last_attempt_at: "2026-10-08T16:25:00Z",
        dnd_attempt_count: 2,
        dnd_retry_at: "2026-10-08T18:30:00Z",
        priority: 1,
        priority_reason: "vip",
        priority_needed_by: "2026-10-08T18:00:00Z",
        priority_note: "Owner arriving",
        do_not_service: true,
        service_declined_reason: "privacy_request",
        service_declined_note: "Baby asleep",
        service_declined_at: "2026-10-08T15:30:00Z",
        reclean_requested_at: "2026-10-08T13:00:00Z",
        reclean_details: details,
      },
    ]);
    const [cached] = (await getRoomsByDate("2026-10-08")) as Array<Record<string, unknown>>;
    expect(cached).toMatchObject({
      dnd_flag: true,
      dnd_attempt_count: 2,
      dnd_last_attempt_at: "2026-10-08T16:25:00Z",
      dnd_retry_at: "2026-10-08T18:30:00Z",
      priority: 1,
      priority_reason: "vip",
      priority_note: "Owner arriving",
      service_declined_reason: "privacy_request",
      service_declined_note: "Baby asleep",
      reclean_details: details,
    });
  });

  it("drops cached rooms that are no longer assigned when the full list for the date is replaced", async () => {
    const room = (id: string, date = "2026-10-08") => ({ id, room_number: id, floor: 1, status: "DIRTY", assignment_date: date });
    await upsertRooms([room("a"), room("b"), room("c"), room("other-day", "2026-10-07")]);
    await upsertRooms([room("a"), room("c")], { replaceDate: "2026-10-08" });
    const ids = ((await getRoomsByDate("2026-10-08")) as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual(["a", "c"]);
    expect(((await getRoomsByDate("2026-10-07")) as unknown[]).length).toBe(1);

    await upsertRooms([], { replaceDate: "2026-10-08" });
    expect(((await getRoomsByDate("2026-10-08")) as unknown[]).length).toBe(0);
  });

  it("can be wiped when a different user signs in", async () => {
    await upsertRooms([{ id: "a", room_number: "1", floor: 1, status: "DIRTY", assignment_date: "2026-10-08" }]);
    await clearRoomsCache();
    expect(((await getRoomsByDate("2026-10-08")) as unknown[]).length).toBe(0);
  });
});

import type { Room } from "@/stores/appStore";

const mockApiPost = jest.fn();
const mockCreateWorkOrder = jest.fn();

jest.mock("@/lib/api/client", () => ({
  api: { post: (...args: unknown[]) => mockApiPost(...args) },
}));
jest.mock("@/lib/api/workOrders", () => ({
  createWorkOrder: (...args: unknown[]) => mockCreateWorkOrder(...args),
}));

import {
  buildBlockerNote,
  getBlockersForRoom,
  runBlockerSideEffect,
} from "@/lib/housekeeping/roomBlockers";

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    room_number: "214",
    floor: 2,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    ...overrides,
  } as Room;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApiPost.mockResolvedValue({});
  mockCreateWorkOrder.mockResolvedValue(undefined);
});

describe("getBlockersForRoom", () => {
  it("gives occupied rooms guest-related blockers incl. timed late checkout", () => {
    const keys = getBlockersForRoom(room({ status: "OCCUPIED" })).map((b) => b.key);
    expect(keys).toEqual(["guest_inside", "dnd_on_door", "cant_enter", "late_checkout"]);
  });

  it("treats not-checked-out OCC departures as guest context", () => {
    const keys = getBlockersForRoom(room({ status: "DIRTY", fo_status: "OCC", actual_checkout_at: null })).map((b) => b.key);
    expect(keys).toContain("guest_inside");
    expect(keys).not.toContain("deep_clean");
  });

  it("gives pickup rooms declined service, timed come-back-later, and guest inside", () => {
    const keys = getBlockersForRoom(room({ status: "PICKUP" })).map((b) => b.key);
    expect(keys).toEqual(["declined_service", "come_back_later", "guest_inside"]);
  });

  it("gives vacant dirty rooms room-condition flags, never guest blockers", () => {
    const keys = getBlockersForRoom(room({ status: "DIRTY", fo_status: "VAC" })).map((b) => b.key);
    expect(keys).toEqual(["deep_clean", "pet_room", "need_ozone", "smoke_smell"]);
  });

  it("hides blockers on finished or out-of-service rooms", () => {
    expect(getBlockersForRoom(room({ status: "CLEAN" }))).toEqual([]);
    expect(getBlockersForRoom(room({ status: "INSPECTED" }))).toEqual([]);
    expect(getBlockersForRoom(room({ status: "OUT_OF_SERVICE" }))).toEqual([]);
  });
});

describe("runBlockerSideEffect", () => {
  it("deep clean and pet room create a low-priority deep vacuum work order", async () => {
    const vacant = room({ status: "DIRTY", fo_status: "VAC" });
    const [deepClean, petRoom] = getBlockersForRoom(vacant);

    await runBlockerSideEffect(vacant, deepClean);
    await runBlockerSideEffect(vacant, petRoom);

    expect(mockCreateWorkOrder).toHaveBeenCalledTimes(2);
    expect(mockCreateWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        room_id: "room-1",
        title: "Deep vacuum and change filter — Room 214",
        priority: "low",
        category: "general",
      }),
    );
  });

  it("ozone and smoke smell create a housekeeping delegation task", async () => {
    const vacant = room({ status: "DIRTY", fo_status: "VAC" });
    const ozone = getBlockersForRoom(vacant).find((b) => b.key === "need_ozone")!;

    await runBlockerSideEffect(vacant, ozone);

    expect(mockApiPost).toHaveBeenCalledWith(
      "/tasks",
      expect.objectContaining({
        title: "Ozone treatment — Room 214",
        task_type: "housekeeping",
        room_id: "room-1",
      }),
    );
  });

  it("late checkout creates a front-desk confirmation task with the guest's time", async () => {
    const occupied = room({ status: "OCCUPIED" });
    const late = getBlockersForRoom(occupied).find((b) => b.key === "late_checkout")!;

    await runBlockerSideEffect(occupied, late, "1:30 PM");

    expect(mockApiPost).toHaveBeenCalledWith(
      "/tasks",
      expect.objectContaining({
        title: "Confirm late checkout — Room 214 (guest says 1:30 PM)",
        task_type: "general",
      }),
    );
    expect(buildBlockerNote(late, "1:30 PM")).toBe("BLOCKER: Late checkout — guest says 1:30 PM");
  });
});

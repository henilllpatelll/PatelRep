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
  formatBlockerTimeInput,
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

  it("gives pickup rooms clock-time presets for come-back-later", () => {
    const pickupBlockers = getBlockersForRoom(room({ status: "PICKUP" }));
    const keys = pickupBlockers.map((b) => b.key);
    const comeBackLater = pickupBlockers.find((b) => b.key === "come_back_later");

    expect(keys).toEqual(["declined_service", "come_back_later", "guest_inside", "dnd_sign"]);
    expect(comeBackLater?.timePresets).toEqual(["11:00 AM", "12:00 PM", "1:00 PM"]);
  });

  it("gives vacant dirty rooms room-condition flags, never guest blockers", () => {
    const keys = getBlockersForRoom(room({ status: "DIRTY", fo_status: "VAC" })).map((b) => b.key);
    expect(keys).toEqual(["pet_room", "smoke_smell"]);
  });

  it("hides blockers on finished or out-of-service rooms", () => {
    expect(getBlockersForRoom(room({ status: "CLEAN" }))).toEqual([]);
    expect(getBlockersForRoom(room({ status: "INSPECTED" }))).toEqual([]);
    expect(getBlockersForRoom(room({ status: "OUT_OF_SERVICE" }))).toEqual([]);
  });
});

describe("runBlockerSideEffect", () => {
  it("pet room creates a low-priority deep vacuum work order", async () => {
    const vacant = room({ status: "DIRTY", fo_status: "VAC" });
    const petRoom = getBlockersForRoom(vacant).find((b) => b.key === "pet_room")!;

    await runBlockerSideEffect(vacant, petRoom);

    expect(mockCreateWorkOrder).toHaveBeenCalledTimes(1);
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
    const ozone = getBlockersForRoom(vacant).find((b) => b.key === "smoke_smell")!;

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

describe("formatBlockerTimeInput", () => {
  it("formats typed come-back-later times with AM/PM for morning and afternoon", () => {
    expect(formatBlockerTimeInput("11")).toBe("11:00 AM");
    expect(formatBlockerTimeInput("11:15")).toBe("11:15 AM");
    expect(formatBlockerTimeInput("12")).toBe("12:00 PM");
    expect(formatBlockerTimeInput("1")).toBe("1:00 PM");
    expect(formatBlockerTimeInput("1:30")).toBe("1:30 PM");
    expect(formatBlockerTimeInput("13:45")).toBe("1:45 PM");
  });

  it("keeps already formatted AM/PM input tidy", () => {
    expect(formatBlockerTimeInput("11 am")).toBe("11:00 AM");
    expect(formatBlockerTimeInput("1:05pm")).toBe("1:05 PM");
  });
});

jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: { get: jest.fn(), post: jest.fn() } };
});

import { api, ApiError } from "@/lib/api/client";
import {
  SUPPLY_CATALOG,
  SUPPLY_MAX_QTY,
  SUPPLY_NOTE_MAX,
  buildSupplyTask,
  clampQty,
  parseSupplyDescription,
  submitSupplyRequest,
  totalRequested,
  validateSupply,
} from "@/lib/housekeeping/supplyRequest";

const mockPost = api.post as jest.Mock;
const mockGet = api.get as jest.Mock;
const input = { roomId: "room-1", roomNumber: "218", quantities: { towels: 3, amenities: 2 }, note: "", requestId: "req-1" };

beforeEach(() => jest.clearAllMocks());

describe("quantities", () => {
  it("clamps to 0..max and whole numbers, never negative or NaN", () => {
    expect(clampQty(-4)).toBe(0);
    expect(clampQty(2.9)).toBe(2);
    expect(clampQty(SUPPLY_MAX_QTY + 50)).toBe(SUPPLY_MAX_QTY);
    expect(clampQty(Number.NaN)).toBe(0);
  });

  it("totals only catalog items", () => {
    expect(totalRequested({ towels: 3, toiletries: 1, mystery: 99 })).toBe(4);
  });
});

describe("validation", () => {
  it("needs at least one item or a free-text request", () => {
    expect(validateSupply({}, "")).toEqual({ ok: false, code: "empty" });
    expect(validateSupply({ towels: 0 }, "   ")).toEqual({ ok: false, code: "empty" });
    expect(validateSupply({ towels: 1 }, "")).toEqual({ ok: true });
    expect(validateSupply({}, "extra cot")).toEqual({ ok: true });
  });

  it("bounds the note", () => {
    expect(validateSupply({ towels: 1 }, "x".repeat(SUPPLY_NOTE_MAX + 1))).toEqual({ ok: false, code: "noteTooLong" });
  });
});

describe("task payload", () => {
  it("stays a normal housekeeping task on the room, with a readable summary", () => {
    const task = buildSupplyTask(input);
    expect(task).toMatchObject({ title: "Supply request — Room 218", task_type: "housekeeping", priority: "normal", room_id: "room-1" });
    expect(task.description).toContain("Room 218 needs: 3 × Bath towels, 2 × Amenities kit.");
  });

  it("adds one machine-readable line that round-trips, with only requested items", () => {
    const task = buildSupplyTask({ ...input, note: "Extra cot please" });
    const parsed = parseSupplyDescription(task.description);
    expect(parsed).toEqual({ request_id: "req-1", items: { towels: 3, amenities: 2 }, note: "Extra cot please" });
    expect(task.description).toContain("Note: Extra cot please");
  });

  it("supports a free-text-only request", () => {
    const task = buildSupplyTask({ ...input, quantities: {}, note: "Folding cot" });
    expect(parseSupplyDescription(task.description)).toEqual({ request_id: "req-1", items: {}, note: "Folding cot" });
    expect(task.description).toContain("Room 218 supply request.");
  });

  it("clamps out-of-range quantities before they are stored", () => {
    const task = buildSupplyTask({ ...input, quantities: { towels: 500, trash_bags: -2 } });
    expect(parseSupplyDescription(task.description)?.items).toEqual({ towels: SUPPLY_MAX_QTY });
  });

  it("uses the app's own catalog, with no stock or ETA text", () => {
    expect(SUPPLY_CATALOG.map((item) => item.key)).toEqual(["towels", "pillowcases", "toiletries", "trash_bags", "amenities"]);
    expect(buildSupplyTask(input).description).not.toMatch(/stock|eta|deliver/i);
  });

  it("ignores descriptions that are not supply requests", () => {
    expect(parseSupplyDescription("Ozone treatment")).toBeNull();
    expect(parseSupplyDescription(null)).toBeNull();
    expect(parseSupplyDescription("[supply-request v1] {not json")).toBeNull();
  });
});

describe("submit", () => {
  it("creates one task", async () => {
    mockPost.mockResolvedValue({ data: {} });
    expect(await submitSupplyRequest(input, false)).toEqual({ outcome: "created" });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("a rejected request is a definite failure, not an ambiguous one", async () => {
    mockPost.mockRejectedValue(new ApiError("nope", 422));
    expect(await submitSupplyRequest(input, false)).toMatchObject({ outcome: "failed", ambiguous: false });
  });

  it("a lost answer is flagged ambiguous so the next try checks first", async () => {
    mockPost.mockRejectedValue(new Error("Request timed out. Please try again."));
    expect(await submitSupplyRequest(input, false)).toMatchObject({ outcome: "failed", ambiguous: true });
    mockPost.mockRejectedValue(new ApiError("bad gateway", 502));
    expect(await submitSupplyRequest(input, false)).toMatchObject({ outcome: "failed", ambiguous: true });
  });

  it("does not create a duplicate task when the earlier attempt actually landed", async () => {
    const earlier = buildSupplyTask(input);
    mockGet.mockResolvedValue({ data: [{ description: earlier.description }] });
    expect(await submitSupplyRequest(input, true)).toEqual({ outcome: "already_sent" });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining("room_id=room-1"));
  });

  it("creates the task when the earlier attempt did not land", async () => {
    mockGet.mockResolvedValue({ data: [{ description: "Room 218 needs: 1 × Trash bags." }] });
    mockPost.mockResolvedValue({ data: {} });
    expect(await submitSupplyRequest(input, true)).toEqual({ outcome: "created" });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("a different request id is a different request", async () => {
    const earlier = buildSupplyTask({ ...input, requestId: "req-0" });
    mockGet.mockResolvedValue({ data: [{ description: earlier.description }] });
    mockPost.mockResolvedValue({ data: {} });
    expect(await submitSupplyRequest(input, true)).toEqual({ outcome: "created" });
  });
});

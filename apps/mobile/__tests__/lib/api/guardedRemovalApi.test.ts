const mockPost = jest.fn();
const mockDelete = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: (...a: unknown[]) => mockPost(...a), delete: (...a: unknown[]) => mockDelete(...a) } }));

import { removeAssignmentGuarded, saveAssignments } from "@/lib/api/housekeepingSupervisor";

beforeEach(() => jest.clearAllMocks());

describe("removeAssignmentGuarded", () => {
  it("posts the date, the room and the owner the supervisor saw to the guarded endpoint", async () => {
    mockPost.mockResolvedValue({ data: { success: true } });
    await removeAssignmentGuarded("2026-10-22", "room-1", "hk-1");
    expect(mockPost).toHaveBeenCalledWith("/housekeeping/assignments/remove", { date: "2026-10-22", room_id: "room-1", expected_assigned_to: "hk-1" });
  });

  it("never uses the unconditional id-based DELETE", async () => {
    mockPost.mockResolvedValue({});
    await removeAssignmentGuarded("2026-10-22", "room-1", "hk-1");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("lets a refusal propagate so the caller can never report success", async () => {
    mockPost.mockRejectedValue(Object.assign(new Error("changed"), { status: 409, code: "assignment_changed" }));
    await expect(removeAssignmentGuarded("2026-10-22", "room-1", "hk-1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("saveAssignments", () => {
  it("passes the expected owner and the acknowledged soft blocks through untouched", async () => {
    mockPost.mockResolvedValue({});
    await saveAssignments("2026-10-22", [{ room_id: "r", housekeeper_id: "h", expected_assigned_to: "x", acknowledged_blocks: ["dnd"] }]);
    expect(mockPost).toHaveBeenCalledWith("/housekeeping/assignments", {
      date: "2026-10-22",
      shift_id: null,
      assignments: [{ room_id: "r", housekeeper_id: "h", expected_assigned_to: "x", acknowledged_blocks: ["dnd"] }],
      is_ai_suggested: false,
    });
  });
});

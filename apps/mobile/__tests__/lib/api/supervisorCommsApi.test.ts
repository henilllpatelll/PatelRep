const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) } }));

import { createShiftNote, fetchHotelDepartments, sendDirectMessage, sendTeamBroadcast } from "@/lib/api/housekeepingSupervisor";

beforeEach(() => jest.clearAllMocks());

describe("supervisor communication endpoints", () => {
  it("files a shift note through POST /logbook/entries with a real department — not the legacy /logbook", async () => {
    mockPost.mockResolvedValue({ data: { id: "e1" } });
    await createShiftNote("dept-hk", "  Room 308 needs inspection ");
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/logbook/entries", {
      department_id: "dept-hk",
      content: "Room 308 needs inspection",
      category: "general",
      status: "informational",
      priority: "normal",
    });
  });

  it("reads departments from the caller's own hotel", async () => {
    mockGet.mockResolvedValue({ data: [{ id: "d1", name: "Housekeeping", code: "HK" }] });
    await expect(fetchHotelDepartments("hotel-1")).resolves.toEqual([{ id: "d1", name: "Housekeeping", code: "HK" }]);
    expect(mockGet).toHaveBeenCalledWith("/hotels/hotel-1/departments");
  });

  it("refuses a malformed department answer instead of treating it as empty", async () => {
    mockGet.mockResolvedValue({ nope: true });
    await expect(fetchHotelDepartments("hotel-1")).rejects.toThrow(/Malformed/);
  });

  it("broadcasts through /notifications/broadcast to housekeeper accounts only, and never creates a task", async () => {
    mockPost.mockResolvedValue({ data: { sent: 8 } });
    const outcome = await sendTeamBroadcast("  Check your assignments ");
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/notifications/broadcast", { message: "Check your assignments", roles: ["housekeeper"] });
    expect(mockPost.mock.calls.every((call) => !String(call[0]).startsWith("/tasks"))).toBe(true);
    expect(outcome).toEqual({ kind: "delivered", count: 8 });
  });

  it("reports a zero-recipient broadcast as nobody, and an odd answer as unknown", async () => {
    mockPost.mockResolvedValueOnce({ data: { sent: 0 } });
    await expect(sendTeamBroadcast("Hi")).resolves.toEqual({ kind: "nobody" });
    mockPost.mockResolvedValueOnce({});
    await expect(sendTeamBroadcast("Hi")).resolves.toEqual({ kind: "unknown" });
  });

  it("sends a direct message with the chosen recipient id", async () => {
    mockPost.mockResolvedValue({ data: { success: true } });
    await sendDirectMessage("hk-2", " Start 310 first ");
    expect(mockPost).toHaveBeenCalledWith("/notifications/direct", { recipient_id: "hk-2", message: "Start 310 first" });
  });
});

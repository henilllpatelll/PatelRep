const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) } }));

import { fetchLogbookReport, fetchShiftHandoff, submitShiftHandoff } from "@/lib/api/housekeepingSupervisor";
import type { EndShiftSummaryPayload } from "@/lib/housekeeping/supervisorHandoff";

beforeEach(() => jest.clearAllMocks());

const PAYLOAD: EndShiftSummaryPayload = {
  client_request_id: "11111111-1111-4111-8111-111111111111",
  report_date: "2026-10-16",
  rooms: { total: 10, out_of_order: 1, ready: 4, awaiting_inspection: 2, in_progress: 1, to_clean: 2 },
  inspections: { passed: 3, failed: 1, conditional: 0 },
  unresolved: { unassigned_rooms: 1, unassigned_room_numbers: ["105"], awaiting_inspection_room_numbers: ["103", "104"], blocked_tasks: null },
  notes: null,
};

describe("submitShiftHandoff", () => {
  it("posts the typed contract to the existing end-shift-summary endpoint, unchanged", async () => {
    mockPost.mockResolvedValue({ data: { id: "e1", created_at: "2026-10-16T21:00:00Z", report_date: "2026-10-16" }, idempotent_replay: false, notifications: { status: "complete" } });
    await expect(submitShiftHandoff(PAYLOAD)).resolves.toMatchObject({ id: "e1", managers: "complete", replay: false });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/housekeeping/end-shift-summary", PAYLOAD);
  });

  it("never sends the pre-contract field names the server ignored", async () => {
    mockPost.mockResolvedValue({ data: { id: "e1" } });
    await submitShiftHandoff(PAYLOAD);
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    for (const legacy of ["rooms_completed", "rooms_inspected", "rooms_failed", "rooms_ooo", "supervisor_notes"]) expect(body).not.toHaveProperty(legacy);
  });

  it("throws instead of claiming success when the answer carries no record id", async () => {
    mockPost.mockResolvedValue({ data: null });
    await expect(submitShiftHandoff(PAYLOAD)).rejects.toThrow(/Malformed/);
    mockPost.mockResolvedValue({});
    await expect(submitShiftHandoff(PAYLOAD)).rejects.toThrow(/Malformed/);
  });

  it("lets the server's error through so the caller can tell 'no' from 'no answer'", async () => {
    const rejected = Object.assign(new Error("x"), { status: 409, code: "inspection_counts_changed" });
    mockPost.mockRejectedValue(rejected);
    await expect(submitShiftHandoff(PAYLOAD)).rejects.toBe(rejected);
  });
});

describe("fetchShiftHandoff", () => {
  it("reads the report saved under a request id", async () => {
    mockGet.mockResolvedValue({ data: { id: "e1", created_at: "2026-10-16T21:00:00Z", report_date: "2026-10-16" }, idempotent_replay: true });
    await expect(fetchShiftHandoff("req 1")).resolves.toMatchObject({ id: "e1", replay: true });
    expect(mockGet).toHaveBeenCalledWith("/housekeeping/end-shift-summary/req%201");
  });

  it("returns null only for the server's definite 'no such handoff'", async () => {
    mockGet.mockRejectedValue(Object.assign(new Error("none"), { status: 404, code: "handoff_not_found" }));
    await expect(fetchShiftHandoff("req")).resolves.toBeNull();
  });

  it("does NOT read an unrelated 404, a 500 or a network failure as 'not saved'", async () => {
    const unrelated = Object.assign(new Error("Not Found"), { status: 404 });
    mockGet.mockRejectedValue(unrelated);
    await expect(fetchShiftHandoff("req")).rejects.toBe(unrelated);
    mockGet.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    await expect(fetchShiftHandoff("req")).rejects.toThrow("boom");
    mockGet.mockRejectedValue(new Error("Network request failed"));
    await expect(fetchShiftHandoff("req")).rejects.toThrow("Network");
  });

  it("refuses a malformed answer", async () => {
    mockGet.mockResolvedValue({ data: {} });
    await expect(fetchShiftHandoff("req")).rejects.toThrow(/Malformed/);
  });
});

describe("fetchLogbookReport", () => {
  it("reads one entry's text, author and department", async () => {
    mockGet.mockResolvedValue({
      data: {
        id: "e1",
        content: "Housekeeping shift handoff…",
        entry_date: "2026-10-16",
        created_at: "2026-10-16T21:00:00Z",
        user_profiles: { preferred_name: "Sam" },
        departments: { name: "Housekeeping" },
      },
    });
    await expect(fetchLogbookReport("e1")).resolves.toEqual({
      id: "e1",
      content: "Housekeeping shift handoff…",
      entryDate: "2026-10-16",
      createdAt: "2026-10-16T21:00:00Z",
      authorName: "Sam",
      departmentName: "Housekeeping",
    });
    expect(mockGet).toHaveBeenCalledWith("/logbook/entries/e1");
  });

  it("refuses an entry without id or text", async () => {
    mockGet.mockResolvedValue({ data: { id: "e1" } });
    await expect(fetchLogbookReport("e1")).rejects.toThrow(/Malformed/);
  });
});

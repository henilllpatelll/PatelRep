const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

import {
  fetchEvidenceUrl,
  fetchHistoryInspectors,
  fetchInspectionHistory,
  fetchInspectionInsights,
  fetchInspectionTimeline,
  historyPath,
} from "@/lib/api/inspectionHistory";
import { historyInsights, historyRow } from "../../helpers/inspectionFixtures";

beforeEach(() => mockGet.mockReset());

describe("historyPath", () => {
  it("sends only the filters that are set, URL-encoded", () => {
    expect(historyPath({ dateFrom: "2026-10-15", dateTo: "2026-10-21" })).toBe("/housekeeping/inspections?date_from=2026-10-15&date_to=2026-10-21");
    expect(
      historyPath({ dateFrom: "2026-10-15", dateTo: "2026-10-21", result: "failed", inspectionType: "reinspection", inspectorId: "u 1", roomNumber: " 2/04 ", failedItemId: "std", limit: 30, cursor: "a+b=" }),
    ).toBe("/housekeeping/inspections?date_from=2026-10-15&date_to=2026-10-21&result=failed&inspection_type=reinspection&inspector_id=u%201&room_number=2%2F04&failed_item_id=std&limit=30&cursor=a%2Bb%3D");
  });

  it("omits an empty room search and a null cursor", () => {
    expect(historyPath({ dateFrom: "a", dateTo: "b", roomNumber: "   ", cursor: null })).toBe("/housekeeping/inspections?date_from=a&date_to=b");
  });
});

describe("fetchInspectionHistory", () => {
  it("reads the page and its cursor", async () => {
    mockGet.mockResolvedValue({ data: [historyRow("a")], meta: { has_more: true, next_cursor: "CUR", total: 41 } });
    await expect(fetchInspectionHistory({ dateFrom: "a", dateTo: "b" })).resolves.toMatchObject({ hasMore: true, nextCursor: "CUR", total: 41, rows: [{ id: "a" }] });
  });

  it("treats a missing meta as 'no more' with an unknown total, not as zero", async () => {
    mockGet.mockResolvedValue({ data: [historyRow("a")] });
    await expect(fetchInspectionHistory({ dateFrom: "a", dateTo: "b" })).resolves.toMatchObject({ hasMore: false, nextCursor: null, total: null });
  });

  it("a body that is not the documented list throws - it is never 'no inspections'", async () => {
    for (const body of [undefined, {}, { data: null }, { data: "x" }]) {
      mockGet.mockResolvedValue(body);
      await expect(fetchInspectionHistory({ dateFrom: "a", dateTo: "b" })).rejects.toThrow("Malformed");
    }
  });

  it("a page whose every row is unreadable throws rather than reading as empty", async () => {
    mockGet.mockResolvedValue({ data: [{ nope: true }, null] });
    await expect(fetchInspectionHistory({ dateFrom: "a", dateTo: "b" })).rejects.toThrow("Malformed");
    mockGet.mockResolvedValue({ data: [] });
    await expect(fetchInspectionHistory({ dateFrom: "a", dateTo: "b" })).resolves.toMatchObject({ rows: [] }); // a genuine empty page is fine
  });
});

describe("the other reads", () => {
  it("inspectors", async () => {
    mockGet.mockResolvedValue({ data: [{ id: "u1", name: "Ana", count: 2 }, { nope: 1 }], meta: { truncated: true } });
    await expect(fetchHistoryInspectors("a", "b")).resolves.toEqual({ rows: [{ id: "u1", name: "Ana", count: 2 }], truncated: true });
    mockGet.mockResolvedValue({});
    await expect(fetchHistoryInspectors("a", "b")).rejects.toThrow("Malformed");
  });

  it("insights", async () => {
    mockGet.mockResolvedValue({ data: historyInsights() });
    await expect(fetchInspectionInsights("2026-10-20", "2026-10-20")).resolves.toMatchObject({ truncated: false });
    expect(mockGet).toHaveBeenCalledWith("/housekeeping/inspections/insights?date_from=2026-10-20&date_to=2026-10-20");
    mockGet.mockResolvedValue({ data: { counts: {} } });
    await expect(fetchInspectionInsights("a", "b")).rejects.toThrow("Malformed");
  });

  it("timeline", async () => {
    mockGet.mockResolvedValue({ data: { inspection_id: "i", inspections: [], events: [], room_id: "r", room_number: "1", truncated: false } });
    await expect(fetchInspectionTimeline("i/1")).resolves.toMatchObject({ inspection_id: "i" });
    expect(mockGet).toHaveBeenCalledWith("/housekeeping/inspections/i%2F1/timeline");
    mockGet.mockResolvedValue({ data: { inspections: "x" } });
    await expect(fetchInspectionTimeline("i")).rejects.toThrow("Malformed");
  });

  it("evidence link", async () => {
    mockGet.mockResolvedValue({ data: { url: "https://signed/x", expires_in: 600 } });
    await expect(fetchEvidenceUrl("i", "item")).resolves.toEqual({ url: "https://signed/x", expiresIn: 600 });
    expect(mockGet).toHaveBeenCalledWith("/housekeeping/inspections/i/evidence/item");
    mockGet.mockResolvedValue({ data: {} });
    await expect(fetchEvidenceUrl("i", "item")).rejects.toThrow("Malformed");
  });
});

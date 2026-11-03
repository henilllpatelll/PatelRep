jest.mock("@/lib/api/client", () => ({ API_BASE: "http://x", api: { get: jest.fn() } }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));

import { api } from "@/lib/api/client";
import { listActiveWorkOrders, WORK_ORDER_PAGE_SIZE } from "@/lib/api/workOrders";

const get = api.get as jest.Mock;
const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: `wo-${offset + i}` }));

beforeEach(() => get.mockReset());

describe("listActiveWorkOrders", () => {
  it("reads every active status in one request when it fits one page", async () => {
    get.mockResolvedValueOnce({ data: rows(12), meta: { has_more: false } });
    const res = await listActiveWorkOrders();
    expect(res.orders).toHaveLength(12);
    expect(res.truncated).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe(`/work-orders?statuses=open%2Cescalated%2Cin_progress%2Con_hold&per_page=${WORK_ORDER_PAGE_SIZE}`);
  });

  it("never asks for completed or cancelled history", async () => {
    get.mockResolvedValueOnce({ data: [], meta: { has_more: false } });
    await listActiveWorkOrders();
    expect(decodeURIComponent(get.mock.calls[0][0])).not.toMatch(/completed|cancelled/);
  });

  it("follows the server's has_more across pages", async () => {
    get
      .mockResolvedValueOnce({ data: rows(WORK_ORDER_PAGE_SIZE), meta: { has_more: true } })
      .mockResolvedValueOnce({ data: rows(5, WORK_ORDER_PAGE_SIZE), meta: { has_more: false } });
    const res = await listActiveWorkOrders();
    expect(res.orders).toHaveLength(WORK_ORDER_PAGE_SIZE + 5);
    expect(res.truncated).toBe(false);
    expect(get.mock.calls[1][0]).toContain("&page=2");
  });

  it("flags truncation instead of silently capping the count", async () => {
    get.mockImplementation(async () => ({ data: rows(WORK_ORDER_PAGE_SIZE), meta: { has_more: true } }));
    const res = await listActiveWorkOrders(2);
    expect(res.truncated).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("propagates a failed page so the caller shows an error, not a shorter list", async () => {
    get.mockResolvedValueOnce({ data: rows(WORK_ORDER_PAGE_SIZE), meta: { has_more: true } }).mockRejectedValueOnce(new Error("boom"));
    await expect(listActiveWorkOrders()).rejects.toThrow("boom");
  });
});

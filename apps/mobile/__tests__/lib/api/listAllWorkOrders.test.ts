jest.mock("@/lib/api/client", () => ({ API_BASE: "http://x", api: { get: jest.fn() } }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));

import { api } from "@/lib/api/client";
import { listAllWorkOrders, WORK_ORDER_PAGE_SIZE } from "@/lib/api/workOrders";

const get = api.get as jest.Mock;
const page = (n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `wo-${get.mock.calls.length}-${i}` })) });

beforeEach(() => get.mockReset());

describe("listAllWorkOrders", () => {
  it("stops after a short page and reports nothing truncated", async () => {
    get.mockResolvedValueOnce(page(WORK_ORDER_PAGE_SIZE)).mockResolvedValueOnce(page(7));
    const res = await listAllWorkOrders("open");
    expect(res.orders).toHaveLength(WORK_ORDER_PAGE_SIZE + 7);
    expect(res.truncated).toBe(false);
    expect(get.mock.calls[0][0]).toBe(`/work-orders?status=open&per_page=${WORK_ORDER_PAGE_SIZE}`);
    expect(get.mock.calls[1][0]).toBe(`/work-orders?status=open&per_page=${WORK_ORDER_PAGE_SIZE}&page=2`);
  });

  it("flags truncation instead of silently capping the count", async () => {
    get.mockImplementation(async () => page(WORK_ORDER_PAGE_SIZE));
    const res = await listAllWorkOrders("open", 3);
    expect(res.orders).toHaveLength(WORK_ORDER_PAGE_SIZE * 3);
    expect(res.truncated).toBe(true);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("propagates a failed page so the caller shows an error, not a shorter list", async () => {
    get.mockResolvedValueOnce(page(WORK_ORDER_PAGE_SIZE)).mockRejectedValueOnce(new Error("boom"));
    await expect(listAllWorkOrders("open")).rejects.toThrow("boom");
  });
});

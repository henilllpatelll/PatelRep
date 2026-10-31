jest.mock("@/lib/api/client", () => ({
  API_BASE: "https://api.test",
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));

import { api } from "@/lib/api/client";
import { listWorkOrderPage, WORK_QUEUE_PAGE_SIZE } from "@/lib/api/workOrders";
import { EMPTY_FILTERS, buildListParams } from "@/lib/engineering/workQueue";

const get = (api as unknown as { get: jest.Mock }).get;

beforeEach(() => get.mockReset());

describe("listWorkOrderPage", () => {
  it("sends the view's filters to the server, with the status list comma-joined", async () => {
    get.mockResolvedValue({ data: [], meta: { has_more: false } });
    const params = buildListParams("mine", { ...EMPTY_FILTERS, priority: "urgent", floor: 3 }, "312", { role: "engineer" });
    await listWorkOrderPage(params, 2);
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("statuses=open%2Cescalated%2Cin_progress%2Con_hold");
    expect(url).toContain("mine=true");
    expect(url).toContain("priority=urgent");
    expect(url).toContain("floor=3");
    expect(url).toContain("q=312");
    expect(url).toContain("sort_by=priority");
    expect(url).toContain(`per_page=${WORK_QUEUE_PAGE_SIZE}`);
    expect(url).toContain("page=2");
  });

  it("omits page 1 and any unset or false parameter", async () => {
    get.mockResolvedValue({ data: [] });
    await listWorkOrderPage({ statuses: ["open"], overdue: false }, 1);
    const url = get.mock.calls[0][0] as string;
    expect(url).not.toMatch(/[?&]page=/);
    expect(url).not.toContain("overdue");
  });

  it("encodes search text so punctuation cannot change the request", async () => {
    get.mockResolvedValue({ data: [] });
    await listWorkOrderPage({ q: "a&b=c#d" });
    expect(get.mock.calls[0][0]).toContain("q=a%26b%3Dc%23d");
  });

  it("trusts the server's has_more rather than guessing from the page length", async () => {
    get.mockResolvedValue({ data: Array.from({ length: WORK_QUEUE_PAGE_SIZE }, (_, i) => ({ id: String(i) })), meta: { has_more: false } });
    expect((await listWorkOrderPage({})).hasMore).toBe(false);
    get.mockResolvedValue({ data: [{ id: "1" }], meta: { has_more: true } });
    expect((await listWorkOrderPage({})).hasMore).toBe(true);
  });

  it("falls back to a full-page check only when an older API omits has_more", async () => {
    get.mockResolvedValue({ data: Array.from({ length: WORK_QUEUE_PAGE_SIZE }, (_, i) => ({ id: String(i) })) });
    expect((await listWorkOrderPage({})).hasMore).toBe(true);
    get.mockResolvedValue({ data: [{ id: "1" }] });
    expect((await listWorkOrderPage({})).hasMore).toBe(false);
  });
});

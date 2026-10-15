const mockSyncOnConnect = jest.fn();
const mockLoadSyncRows = jest.fn();
const mockResetFailed = jest.fn();
const mockResetActions = jest.fn();
let mockOnline = true;

jest.mock("@/lib/offline/sync", () => ({ syncOnConnect: () => mockSyncOnConnect() }));
jest.mock("@/lib/offline/db", () => ({ resetFailedSyncQueueAttempts: () => mockResetFailed() }));
jest.mock("@/lib/housekeeping/syncDetails", () => ({ loadSyncRows: () => mockLoadSyncRows() }));
jest.mock("@/stores/appStore", () => ({ useAppStore: { getState: () => ({ isOnline: mockOnline, resetFailedActions: () => mockResetActions() }) } }));

import { isSyncRunning, runSyncNow } from "@/lib/housekeeping/syncRunner";

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockResetFailed.mockResolvedValue(undefined);
  mockResetActions.mockResolvedValue(undefined);
  mockSyncOnConnect.mockResolvedValue(undefined);
  mockLoadSyncRows.mockResolvedValue({ rows: [], complete: true });
});

describe("runSyncNow", () => {
  it("does nothing offline: no queue is touched", async () => {
    mockOnline = false;
    expect(await runSyncNow()).toEqual({ ran: false, reason: "offline" });
    expect(mockSyncOnConnect).not.toHaveBeenCalled();
    expect(mockResetFailed).not.toHaveBeenCalled();
  });

  it("runs the app's own single flush, after giving out-of-retries items another go", async () => {
    const order: string[] = [];
    mockResetFailed.mockImplementation(async () => void order.push("reset"));
    mockResetActions.mockImplementation(async () => void order.push("reset-actions"));
    mockSyncOnConnect.mockImplementation(async () => void order.push("sync"));
    const result = await runSyncNow();
    expect(order).toEqual(["reset", "reset-actions", "sync"]);
    expect(result).toEqual({ ran: true, remaining: 0, failed: 0, conflicts: 0, verified: true });
  });

  it("joins a run already in progress instead of starting another", async () => {
    let finish: () => void = () => undefined;
    mockSyncOnConnect.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = runSyncNow();
    expect(isSyncRunning()).toBe(true);
    const second = runSyncNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSyncOnConnect).toHaveBeenCalledTimes(1);
    finish();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(mockSyncOnConnect).toHaveBeenCalledTimes(1);
    expect(isSyncRunning()).toBe(false);
  });

  it("reports what is still waiting, failed or refused — never 'done' by default", async () => {
    mockLoadSyncRows.mockResolvedValue({
      rows: [
        { key: "a", roomId: null, kind: "checklist", state: "pending", count: 2 },
        { key: "b", roomId: null, kind: "task", state: "failed" },
        { key: "c", roomId: "r", kind: "completion", state: "conflict" },
      ],
      complete: true,
    });
    expect(await runSyncNow()).toEqual({ ran: true, remaining: 2, failed: 1, conflicts: 1, verified: true });
  });

  it("flags an unreadable queue so the result cannot claim everything was sent", async () => {
    mockLoadSyncRows.mockResolvedValue({ rows: [], complete: false });
    expect(await runSyncNow()).toMatchObject({ ran: true, verified: false });
  });

  it("reports a failure without losing the ability to run again", async () => {
    mockSyncOnConnect.mockRejectedValueOnce(new Error("boom"));
    expect(await runSyncNow()).toEqual({ ran: false, reason: "failed" });
    expect(isSyncRunning()).toBe(false);
    expect(await runSyncNow()).toMatchObject({ ran: true });
  });
});

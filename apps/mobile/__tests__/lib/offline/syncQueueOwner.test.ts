/** The SQLite work-order / report queue belongs to the person + hotel that queued it. */
const mockRuns: Array<{ sql: string; params: unknown[] }> = [];
const mockReads: Array<{ sql: string; params: unknown[] }> = [];

const mockDb = {
  runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
    mockRuns.push({ sql, params });
  }),
  execAsync: jest.fn(async () => undefined),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
  getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
    mockReads.push({ sql, params });
    return [];
  }),
};

jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));

import { deleteSyncQueueItem, enqueueAction, getPendingSyncQueue, getSyncQueueSummary, incrementSyncQueueAttempts } from "@/lib/offline/db";
import { setQueueOwner } from "@/lib/offline/queueOwner";

beforeEach(() => {
  mockRuns.length = 0;
  mockReads.length = 0;
  setQueueOwner("hotel-1:user-a");
});

describe("sync_queue ownership", () => {
  it("discards rows from before ownership existed when the database opens", async () => {
    await getPendingSyncQueue();
    expect(mockRuns.some((run) => /DELETE FROM sync_queue WHERE owner_scope IS NULL/.test(run.sql))).toBe(true);
  });

  it("stamps the signed-in owner on every row", async () => {
    await enqueueAction("work_order", "claim", {}, "wo-1");
    const insert = mockRuns.find((run) => /INSERT INTO sync_queue/.test(run.sql));
    expect(insert?.sql).toMatch(/owner_scope/);
    expect(insert?.params.at(-1)).toBe("hotel-1:user-a");
  });

  it("refuses to queue when nobody is signed in", async () => {
    setQueueOwner(null);
    await expect(enqueueAction("work_order", "claim", {}, "wo-1")).rejects.toThrow();
  });

  it("reads only the signed-in owner's rows, and nothing at all when signed out", async () => {
    await getPendingSyncQueue();
    await getSyncQueueSummary();
    const reads = mockReads.filter((read) => /FROM sync_queue/.test(read.sql));
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.sql).toMatch(/owner_scope = \?/);
      expect(read.params).toContain("hotel-1:user-a");
    }

    mockReads.length = 0;
    setQueueOwner(null);
    expect(await getPendingSyncQueue()).toEqual([]);
    expect(await getSyncQueueSummary()).toEqual([]);
    expect(mockReads.filter((read) => /FROM sync_queue/.test(read.sql))).toHaveLength(0);
  });

  it("only updates or deletes a row the current owner holds", async () => {
    await incrementSyncQueueAttempts(4);
    await deleteSyncQueueItem(4);
    const writes = mockRuns.filter((run) => /sync_queue/.test(run.sql) && /WHERE id = \?/.test(run.sql));
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.sql).toMatch(/AND owner_scope = \?/);
      expect(write.params).toEqual([4, "hotel-1:user-a"]);
    }
  });
});

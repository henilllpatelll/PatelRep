import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

const mockPage = jest.fn();
const mockDone = jest.fn();
jest.mock("@/lib/api/tasks", () => ({
  ...jest.requireActual("@/lib/api/tasks"),
  fetchCompletedPage: (...args: unknown[]) => mockPage(...args),
}));
jest.mock("@/lib/tasks/workQueue", () => ({
  ...jest.requireActual("@/lib/tasks/workQueue"),
  fetchDoneToday: (...args: unknown[]) => mockDone(...args),
}));

import type { Task } from "@/lib/api/tasks";
import { TASK_CACHE_PREFIX, saveDoneToday, saveHistoryFirstPage } from "@/lib/tasks/offline/taskCache";
import { useCompletedHistory } from "@/lib/tasks/offline/useCompletedHistory";

function done(id: string, completedAt: string): Task {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    task_type: "general",
    status: "completed",
    priority: "normal",
    assigned_to: "me",
    assigned_to_name: null,
    created_by: null,
    created_by_name: null,
    room_id: null,
    room_number: null,
    room_floor: null,
    location_text: null,
    due_at: null,
    created_at: null,
    started_at: null,
    completed_at: completedAt,
    is_ai_created: false,
    guest_request: null,
    blocker: null,
  };
}

const page = (tasks: Task[], nextCursor: string | null = null) => ({ tasks, hasMore: nextCursor !== null, nextCursor, truncated: false });
const A = "h1:me";
const ZONE = "America/Chicago";
const today = () => new Date().toISOString();
const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockDone.mockResolvedValue({ count: 2, atLeast: false });
});

describe("useCompletedHistory", () => {
  it("loads the first page from the server, newest first, with the server's Done Today count", async () => {
    mockPage.mockResolvedValue(page([done("a", "2026-10-13T15:00:00Z"), done("b", "2026-10-13T16:00:00Z")]));
    const { result } = renderHook(() => useCompletedHistory({ isOnline: true, scope: A, zone: ZONE }));

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.tasks.map((t) => t.id)).toEqual(["b", "a"]);
    expect(result.current.fromCache).toBe(false);
    await waitFor(() => expect(result.current.done.value).toEqual({ count: 2, atLeast: false }));
    expect(mockPage).toHaveBeenCalledWith(null, 30);
  });

  it("paginates with the server cursor and never repeats a row", async () => {
    mockPage.mockResolvedValueOnce(page([done("a", "2026-10-13T16:00:00Z")], "cur-1"));
    const { result } = renderHook(() => useCompletedHistory({ isOnline: true, scope: A, zone: ZONE }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mockPage.mockResolvedValueOnce(page([done("a", "2026-10-13T16:00:00Z"), done("b", "2026-10-12T16:00:00Z")]));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockPage).toHaveBeenLastCalledWith("cur-1", 30);
    expect(result.current.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("keeps what is shown when a later page fails, and says so", async () => {
    mockPage.mockResolvedValueOnce(page([done("a", "2026-10-13T16:00:00Z")], "cur-1"));
    const { result } = renderHook(() => useCompletedHistory({ isOnline: true, scope: A, zone: ZONE }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    mockPage.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(result.current.moreFailed).toBe("failed");
    expect(result.current.hasMore).toBe(true);
  });

  it("does not try to load older pages offline", async () => {
    mockPage.mockResolvedValueOnce(page([done("a", "2026-10-13T16:00:00Z")], "cur-1"));
    const { result, rerender } = renderHook((props: { online: boolean }) => useCompletedHistory({ isOnline: props.online, scope: A, zone: ZONE }), {
      initialProps: { online: true },
    });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    mockPage.mockClear();

    rerender({ online: false });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockPage).not.toHaveBeenCalled();
    expect(result.current.moreFailed).toBe("offline");
  });

  it("shows the saved first page, flagged as saved, when the server cannot be reached", async () => {
    await saveHistoryFirstPage(A, { tasks: [done("a", "2026-10-13T16:00:00Z")], nextCursor: null, hasMore: false });
    mockPage.mockRejectedValue(new Error("Network request failed"));
    mockDone.mockRejectedValue(new Error("Network request failed"));

    const { result } = renderHook(() => useCompletedHistory({ isOnline: false, scope: A, zone: ZONE }));

    await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(["a"]));
    expect(result.current.status).toBe("ready");
    expect(result.current.fromCache).toBe(true);
    expect(result.current.syncedAt).not.toBeNull();
  });

  it("is an error — never 'no completed tasks' — when offline with nothing saved", async () => {
    mockPage.mockRejectedValue(new Error("Network request failed"));
    mockDone.mockRejectedValue(new Error("Network request failed"));

    const { result } = renderHook(() => useCompletedHistory({ isOnline: false, scope: A, zone: ZONE }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.tasks).toEqual([]);
  });

  it("replaces the saved copy with live data when the connection returns", async () => {
    await saveHistoryFirstPage(A, { tasks: [done("old", "2026-10-12T16:00:00Z")], nextCursor: null, hasMore: false });
    mockPage.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(page([done("fresh", "2026-10-13T16:00:00Z")]));
    mockDone.mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook((props: { online: boolean }) => useCompletedHistory({ isOnline: props.online, scope: A, zone: ZONE }), {
      initialProps: { online: false },
    });
    await waitFor(() => expect(result.current.fromCache).toBe(true));

    rerender({ online: true });

    await waitFor(() => expect(result.current.fromCache).toBe(false));
    expect(result.current.tasks.map((t) => t.id)).toEqual(["fresh"]);
  });

  it("a slow read of the saved copy never overwrites or relabels data the server already returned", async () => {
    await saveHistoryFirstPage(A, { tasks: [done("old", "2026-10-12T16:00:00Z")], nextCursor: null, hasMore: false });
    await saveDoneToday(A, { count: 9, atLeast: false }, dayKey());
    const real = (AsyncStorage.getItem as jest.Mock).getMockImplementation() as (key: string) => Promise<string | null>;
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
      (key: string) => new Promise((resolve) => setTimeout(() => resolve(real(key)), 80)),
    );
    mockPage.mockResolvedValue(page([done("fresh", "2026-10-13T16:00:00Z")]));
    mockDone.mockResolvedValue({ count: 1, atLeast: false });

    const { result } = renderHook(() => useCompletedHistory({ isOnline: true, scope: A, zone: ZONE }));
    await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(["fresh"]));
    await waitFor(() => expect(result.current.done.value).toEqual({ count: 1, atLeast: false }));
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the slow saved read finish

    expect(result.current.tasks.map((t) => t.id)).toEqual(["fresh"]);
    expect(result.current.fromCache).toBe(false);
    expect(result.current.done).toEqual({ value: { count: 1, atLeast: false }, failed: false });
  });

  it("shows a saved Done Today only for the same hotel day, labelled as not confirmed", async () => {
    await saveDoneToday(A, { count: 5, atLeast: false }, dayKey());
    mockPage.mockRejectedValue(new Error("offline"));
    mockDone.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useCompletedHistory({ isOnline: false, scope: A, zone: ZONE }));

    await waitFor(() => expect(result.current.done.value).toEqual({ count: 5, atLeast: false }));
    expect(result.current.done.failed).toBe(true);
  });

  it("never shows yesterday's saved count as today's", async () => {
    await saveDoneToday(A, { count: 9, atLeast: false }, "2020-01-01");
    mockPage.mockRejectedValue(new Error("offline"));
    mockDone.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useCompletedHistory({ isOnline: false, scope: A, zone: ZONE }));
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.done.value).toBeNull();
  });

  it("another person's saved history is invisible (scope isolation) and a scope switch resets the list", async () => {
    await saveHistoryFirstPage("h1:other", { tasks: [done("theirs", today())], nextCursor: null, hasMore: false });
    mockPage.mockResolvedValueOnce(page([done("mine", today())]));
    const { result, rerender } = renderHook((props: { scope: string | null }) => useCompletedHistory({ isOnline: true, scope: props.scope, zone: ZONE }), {
      initialProps: { scope: A as string | null },
    });
    await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(["mine"]));

    mockPage.mockResolvedValueOnce(page([done("second-user", today())]));
    rerender({ scope: "h1:second" });

    await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(["second-user"]));
    expect(await AsyncStorage.getItem(`${TASK_CACHE_PREFIX}h1:other`)).not.toBeNull(); // untouched, just never read
  });

  it("drops a slow response that arrives after the scope changed", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockPage.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { result, rerender } = renderHook((props: { scope: string | null }) => useCompletedHistory({ isOnline: true, scope: props.scope, zone: ZONE }), {
      initialProps: { scope: A as string | null },
    });
    mockPage.mockResolvedValueOnce(page([done("b-task", today())]));
    rerender({ scope: "h1:b" });
    await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(["b-task"]));

    await act(async () => {
      release(page([done("a-late", today())]));
    });

    expect(result.current.tasks.map((t) => t.id)).toEqual(["b-task"]);
  });
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  submitShiftHandoff: jest.fn(),
  fetchShiftHandoff: jest.fn(),
}));

import { fetchShiftHandoff, submitShiftHandoff } from "@/lib/api/housekeepingSupervisor";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { availableSource } from "@/lib/housekeeping/supervisorSources";
import { composeSupervisorToday, normalizeBoard } from "@/lib/housekeeping/supervisorToday";
import { useShiftHandoff } from "@/lib/housekeeping/useShiftHandoff";

const submit = submitShiftHandoff as jest.Mock;
const fetchSaved = fetchShiftHandoff as jest.Mock;

const NOW = Date.now();
const SCOPE = "h1:sup-1";
const DRAFT_KEY = `@patelrep/mobile/supervisor-handoff-draft:${SCOPE}`;
const SAVED = { id: "abcdef12-0000-4000-8000-000000000000", createdAt: null, reportDate: "2026-10-16", replay: false, managers: "complete" as const };

const room = (id: string, status: string): BoardRoomRaw => ({ room_id: `r-${id}`, status, rooms: { id: `r-${id}`, room_number: id, floor: 1 } });
const today = composeSupervisorToday(
  {
    board: availableSource(normalizeBoard([room("101", "INSPECTED"), room("102", "DIRTY")]), NOW),
    staff: availableSource([], NOW),
    roster: availableSource([], NOW),
    inspections: availableSource([], NOW),
    blockedTasks: availableSource([], NOW),
  },
  { now: NOW, timeZone: "America/Chicago", viewerId: "sup-1" },
);
const refresh = jest.fn(async () => undefined);

function setup(isOnline = true) {
  return renderHook(() => useShiftHandoff({ today, refresh, scope: SCOPE, isOnline }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  submit.mockResolvedValue(SAVED);
  fetchSaved.mockResolvedValue(null);
});

describe("useShiftHandoff", () => {
  it("sends one request when submit is triggered twice in the same instant", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setAcknowledged(true));
    expect(result.current.canSubmit).toBe(true);

    await act(async () => {
      void result.current.actions.submit();
      void result.current.actions.submit();
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe("saved");
  });

  it("does not send without a verified, acknowledged report", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.actions.submit(); // not acknowledged yet
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not send while offline", async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.setAcknowledged(true));
    expect(result.current.canSubmit).toBe(false);
    await act(async () => {
      await result.current.actions.submit();
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("an explicit discard keeps the marker for a submit whose outcome is unknown", async () => {
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ notes: "n", requestId: "44444444-4444-4444-8444-444444444444", attempted: true, savedAt: Date.now() }));
    fetchSaved.mockRejectedValue(new Error("offline"));
    const { result } = setup();
    await waitFor(() => expect(result.current.unresolved).toBe(true));
    act(() => result.current.actions.discard());
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY)) as string)).toMatchObject({ notes: "", attempted: true }));
  });

  it("keeps a failed manager-notification recovery across reopening and retries the original report", async () => {
    const failed = { ...SAVED, managers: "failed" as const };
    submit.mockResolvedValueOnce(failed).mockResolvedValueOnce(SAVED);
    const first = setup();
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    act(() => first.result.current.setAcknowledged(true));
    await act(async () => {
      await first.result.current.actions.submit();
    });

    const originalPayload = submit.mock.calls[0][0];
    await waitFor(async () => {
      expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY)) as string)).toMatchObject({
        attempted: false,
        notificationPending: true,
        recoveryPayload: originalPayload,
      });
    });
    first.unmount();

    fetchSaved.mockResolvedValueOnce({ ...failed, replay: true });
    const reopened = setup();
    await waitFor(() => expect(reopened.result.current.saved?.managers).toBe("failed"));
    await act(async () => {
      await reopened.result.current.actions.notifyAgain();
    });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toEqual(originalPayload);
    await waitFor(async () => expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull());
  });
});

import { act, renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/lib/api/workOrders", () => ({
  createWorkOrderDetailed: jest.fn(),
  uploadWorkOrderPhoto: jest.fn(),
}));
jest.mock("@/lib/api/engineeringRooms", () => ({
  getActiveRoomPeriod: jest.fn(),
  listAvailabilityReasons: jest.fn(),
}));
jest.mock("@/lib/offline/db", () => ({ enqueueAction: jest.fn() }));
jest.mock("@/lib/housekeeping/photo", () => ({ prepareForUpload: jest.fn(async (uri: string) => `${uri}?small`) }));
jest.mock("@/lib/housekeeping/photoAsset", () => ({ discardLocalPhoto: jest.fn() }));

import { createWorkOrderDetailed, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import { getActiveRoomPeriod, listAvailabilityReasons } from "@/lib/api/engineeringRooms";
import { enqueueAction } from "@/lib/offline/db";
import { REPORT_QUEUE_MARK } from "@/lib/engineering/pendingReports";
import { takeAssetListStale } from "@/lib/engineering/useAssetBrowse";
import { takeRoomBoardStale } from "@/lib/engineering/useRoomBoard";
import { loadStoredDraft, useReportIssue } from "@/lib/engineering/useReportIssue";
import type { ReportDraft } from "@/lib/engineering/reportIssue";

const create = createWorkOrderDetailed as jest.Mock;
const upload = uploadWorkOrderPhoto as jest.Mock;
const activePeriod = getActiveRoomPeriod as jest.Mock;
const reasonsApi = listAvailabilityReasons as jest.Mock;
const enqueue = enqueueAction as jest.Mock;

const SCOPE = "hotel-1:eng-1";
const room312: Partial<ReportDraft> = { location: { kind: "room", roomId: "r312", roomNumber: "312", floor: 3 } };
const created = (over: Record<string, unknown> = {}) => ({ id: "wo-1", workOrderNumber: "1042", status: "open", title: "Sink leaking", priority: "normal", replayed: false, roomMarkedOutOfOrder: false, ...over });
const refusal = (status: number, message = "Refused") => Object.assign(new Error(message), { status });
const defer = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
};

function mount(over: { isOnline?: boolean; prefill?: Partial<ReportDraft> | undefined } = {}) {
  return renderHook(() => useReportIssue({ scope: SCOPE, userId: "eng-1", isOnline: over.isOnline ?? true, prefill: "prefill" in over ? over.prefill : room312 }));
}

async function fill(result: { current: ReturnType<typeof useReportIssue> }, title = "Sink leaking") {
  await act(async () => result.current.update({ title }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  takeAssetListStale();
  takeRoomBoardStale();
  create.mockResolvedValue(created());
  upload.mockResolvedValue({});
  activePeriod.mockResolvedValue(null);
  reasonsApi.mockResolvedValue([{ id: "1", code: "PLUMBING", label: "Plumbing" }]);
  enqueue.mockResolvedValue(undefined);
});

describe("creating a report online", () => {
  it("is 'created' only from the server's answer, with the server's work order number, and refreshes the lists it affects", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => void (await result.current.submit()));

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ title: "Sink leaking", room_id: "r312", category: "general", priority: "normal", client_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(result.current.outcome).toMatchObject({ kind: "created", workOrderId: "wo-1", workOrderNumber: "1042", status: "open" });
    expect(takeAssetListStale()).toBe(true);
    expect(takeRoomBoardStale()).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("invalid input never reaches the server and shows the field errors", async () => {
    const { result } = mount({ prefill: undefined });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => void (await result.current.submit()));
    expect(create).not.toHaveBeenCalled();
    expect(result.current.showErrors).toBe(true);
    expect(result.current.validation.errors).toEqual(["location_required", "title_required"]);
  });

  it("two taps in the same tick send one request", async () => {
    const gate = defer<ReturnType<typeof created>>();
    create.mockReturnValue(gate.promise);
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.submit();
      second = result.current.submit();
      gate.resolve(created());
      await Promise.all([first, second]);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(await second).toBeNull();
  });

  it("keeps the same request key after a lost answer so the retry can't make a second work order", async () => {
    create.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce(created({ replayed: true }));
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => void (await result.current.submit()));
    expect(result.current.failure).toMatchObject({ kind: "failed", ambiguous: true });
    expect(result.current.outcome).toBeNull();
    expect(result.current.draft.title).toBe("Sink leaking");

    await act(async () => void (await result.current.submit()));
    const [first, second] = create.mock.calls.map(([payload]) => payload.client_request_id);
    expect(first).toBe(second);
    expect(result.current.outcome).toMatchObject({ kind: "created", replayed: true });
  });

  it("takes a fresh key only after the server definitively refused the previous one, and keeps the person's words", async () => {
    create.mockRejectedValueOnce(refusal(422, "Room not found")).mockResolvedValueOnce(created());
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => void (await result.current.submit()));
    expect(result.current.failure).toMatchObject({ kind: "failed", ambiguous: false, status: 422, message: "Room not found" });
    await act(async () => void (await result.current.submit()));
    const [first, second] = create.mock.calls.map(([payload]) => payload.client_request_id);
    expect(first).not.toBe(second);
  });

  it("passes a permission refusal through without pretending success", async () => {
    create.mockRejectedValue(refusal(403, "Forbidden"));
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => void (await result.current.submit()));
    expect(result.current.failure).toMatchObject({ status: 403 });
    expect(result.current.outcome).toBeNull();
  });
});

describe("photos", () => {
  const photos = async (result: { current: ReturnType<typeof useReportIssue> }) => {
    await act(async () => {
      result.current.addPhoto("file:///a.jpg", "Leak");
      result.current.addPhoto("file:///b.jpg");
    });
  };

  it("uploads each photo to the work order that was just created, never before", async () => {
    const order: string[] = [];
    create.mockImplementation(async () => (order.push("create"), created()));
    upload.mockImplementation(async () => (order.push("upload"), {}));
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await photos(result);
    await act(async () => void (await result.current.submit()));
    expect(order).toEqual(["create", "upload", "upload"]);
    expect(upload).toHaveBeenNthCalledWith(1, "wo-1", "file:///a.jpg?small", expect.objectContaining({ caption: "Leak" }));
    expect(result.current.photosPending).toEqual([]);
  });

  it("reports a partial success when the order is created but a photo fails, and retrying uploads only that photo, never a second order", async () => {
    upload.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Network request failed"));
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await photos(result);
    await act(async () => void (await result.current.submit()));

    expect(result.current.outcome).toMatchObject({ kind: "created", workOrderId: "wo-1" });
    expect(result.current.photosPending.map((p) => p.uri)).toEqual(["file:///b.jpg"]);

    upload.mockClear();
    create.mockClear();
    await act(async () => result.current.retryPhotos());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("wo-1", "file:///b.jpg?small", expect.anything());
    expect(create).not.toHaveBeenCalled();
    expect(result.current.photosPending).toEqual([]);
  });

  it("keeps a photo pending if the retry fails too", async () => {
    upload.mockRejectedValue(new Error("Network request failed"));
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => void result.current.addPhoto("file:///a.jpg"));
    await act(async () => void (await result.current.submit()));
    await act(async () => result.current.retryPhotos());
    expect(result.current.photosPending).toHaveLength(1);
  });

  it("holds at most four photos", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    const added: boolean[] = [];
    await act(async () => {
      for (let i = 0; i < 6; i += 1) added.push(result.current.addPhoto(`file:///${i}.jpg`));
    });
    expect(added.filter(Boolean)).toHaveLength(4);
  });
});

describe("offline", () => {
  it("saves the report in the sync queue under a stable key, says it is only saved, and sends nothing", async () => {
    const { result } = mount({ isOnline: false });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => void result.current.addPhoto("file:///a.jpg"));
    await act(async () => void (await result.current.submit()));

    expect(create).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [entity, action, payload, entityId] = enqueue.mock.calls[0];
    expect([entity, action]).toEqual(["work_order", "create"]);
    expect(payload).toMatchObject({ title: "Sink leaking", room_id: "r312" });
    expect(entityId).toBe(`${REPORT_QUEUE_MARK}${payload.client_request_id}`);
    expect(result.current.outcome).toEqual({ kind: "queued", photosDropped: 1 });
  });

  it("never saves a room-down request for later", async () => {
    const { result } = mount({ isOnline: false });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => result.current.setRoomDown({ type: "OUT_OF_ORDER", reasonCode: "PLUMBING", details: "", returnAt: new Date(Date.now() + 3_600_000 * 5), workOrderId: null }));
    // Reasons can't load offline, so the request can't even be built; either way nothing is queued.
    await act(async () => void (await result.current.submit()));
    expect(enqueue).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.current.outcome).toBeNull();
  });

  it("a second offline report gets its own key", async () => {
    const { result } = mount({ isOnline: false });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => void (await result.current.submit()));
    await act(async () => result.current.reset());
    await fill(result, "Door sticks");
    await act(async () => result.current.setLocation({ kind: "other", text: "Lobby" }));
    await act(async () => void (await result.current.submit()));
    const keys = enqueue.mock.calls.map(([, , payload]) => payload.client_request_id);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("taking the room down together with the report", () => {
  const down = () => ({ type: "OUT_OF_ORDER" as const, reasonCode: "PLUMBING", details: "", returnAt: new Date(Date.now() + 3_600_000 * 5), workOrderId: null });

  it("proves the room-down half by asking the room, not by trusting the create answer", async () => {
    activePeriod.mockResolvedValue({ id: "p1", status: "ACTIVE" });
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => result.current.setRoomDown(down()));
    await waitFor(() => expect(result.current.reasons).toHaveLength(1));
    await act(async () => void (await result.current.submit()));

    expect(create.mock.calls[0][0].room_unavailability).toMatchObject({ room_id: "r312", type: "OUT_OF_ORDER", reason_code: "PLUMBING", source: "MOBILE" });
    expect(activePeriod).toHaveBeenCalledWith("r312");
    expect(result.current.outcome).toMatchObject({ kind: "created", roomDown: "confirmed" });
  });

  it("says 'unconfirmed' when the room shows no record afterwards or cannot be read", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => result.current.setRoomDown(down()));
    await waitFor(() => expect(result.current.reasons).toHaveLength(1));
    activePeriod.mockResolvedValue(null);
    await act(async () => void (await result.current.submit()));
    expect(result.current.outcome).toMatchObject({ roomDown: "unconfirmed" });
  });

  it("plain reports never ask the room anything, and an emergency alone adds no room-down request", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await fill(result);
    await act(async () => {
      result.current.setPriority("emergency");
      result.current.update({ emergencyConfirmed: true });
    });
    await act(async () => void (await result.current.submit()));
    expect(create.mock.calls[0][0]).toMatchObject({ priority: "emergency" });
    expect(create.mock.calls[0][0]).not.toHaveProperty("room_unavailability");
    expect(activePeriod).not.toHaveBeenCalled();
  });
});

describe("drafts", () => {
  it("keeps what was typed on the device, restores it next time, and always asks again about an emergency", async () => {
    const first = mount({ prefill: undefined });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => {
      first.result.current.update({ title: "Half typed", description: "More" });
      first.result.current.setPriority("emergency");
      first.result.current.update({ emergencyConfirmed: true });
    });
    await waitFor(async () => expect((await loadStoredDraft(SCOPE))?.title).toBe("Half typed"));
    first.unmount();

    const second = mount({ prefill: undefined });
    await waitFor(() => expect(second.result.current.restored).toBe(true));
    expect(second.result.current.draft).toMatchObject({ title: "Half typed", description: "More", priority: "emergency", emergencyConfirmed: false });
  });

  it("starts from the entry point's context instead of an old draft", async () => {
    await AsyncStorage.setItem(`@patelrep/eng_report_draft:${SCOPE}`, JSON.stringify({ draft: { title: "Old draft", location: null }, savedAt: "2026-10-30T00:00:00Z" }));
    const { result } = mount({ prefill: room312 });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.restored).toBe(false);
    expect(result.current.draft.title).toBe("");
    expect(result.current.draft.location).toMatchObject({ roomNumber: "312" });
    expect(result.current.dirty).toBe(false);
  });

  it("clears the saved draft once the report is accepted and remembers the place as recent", async () => {
    const { result } = mount({ prefill: undefined });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      result.current.setLocation({ kind: "other", text: "Pool deck" });
      result.current.update({ title: "Gate latch broken" });
    });
    await waitFor(async () => expect(await loadStoredDraft(SCOPE)).not.toBeNull());
    await act(async () => void (await result.current.submit()));
    await waitFor(async () => expect(await loadStoredDraft(SCOPE)).toBeNull());
    expect(JSON.parse((await AsyncStorage.getItem("@patelrep/eng_report_recent:" + SCOPE)) ?? "[]")[0]).toEqual({ kind: "other", text: "Pool deck" });
  });

  it("discard clears the draft", async () => {
    const { result } = mount({ prefill: undefined });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.update({ title: "Oops" }));
    await waitFor(async () => expect(await loadStoredDraft(SCOPE)).not.toBeNull());
    await act(async () => void (await result.current.discard()));
    expect(await loadStoredDraft(SCOPE)).toBeNull();
    expect(result.current.draft.title).toBe("");
  });
});

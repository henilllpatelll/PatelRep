import { act } from "@testing-library/react-native";
import {
  AsyncStorage,
  mockComplete,
  mockQueue,
  mockSubmitLegacy,
  mockSubscribe,
  mockTemplates,
  navigate,
  openWorkspace as open,
  resetWorld,
  room205,
  useAppStore,
} from "../helpers/workspaceMocks";
import { afterAutosave, CHECKLIST_ITEMS, flush, flatText, settle, standardTemplate } from "../helpers/workspaceHarness";
import { draftKey } from "@/lib/inspections/draftStore";
import { rawItem, readyRoom } from "../helpers/inspectionFixtures";

/* ─── The world changes under an unfinished inspection ──────────────────────
   Another supervisor approves the room, the housekeeper cleans it again, the day rolls over, the account changes.
   Whatever happens, nothing is sent, the draft stays on the phone under its own key, and the supervisor is told. */

let dateNow: jest.SpyInstance;
beforeEach(async () => {
  dateNow = await resetWorld();
});
afterEach(async () => {
  await flush();
  dateNow.mockRestore();
});

/** Fire the shared realtime channel's callback: the same path a room change takes in production. */
async function roomChanged() {
  const callback = mockSubscribe.mock.calls.at(-1)?.[1] as (() => void) | undefined;
  await act(async () => callback?.());
  await settle();
}
const KEY = draftKey("hotel-1", "sup-1", "room-205");

describe("the room moves on", () => {
  it("another supervisor approves it: the screen stops, says so, keeps the draft, and sends nothing", async () => {
    const { screen, answer, text, has } = await open();
    await answer("toilet", "pass");
    mockQueue.mockResolvedValue([readyRoom("room-305", { room_number: "305" })]);
    await roomChanged();
    expect(text("workspace-blocked-title")).toBe("Room 205 isn't waiting any more");
    expect(text("workspace-blocked-body")).toContain("Your draft stays on this phone. Nothing was sent.");
    expect(has("workspace-list")).toBe(false);
    expect(has("workspace-review")).toBe(false);
    expect(screen.queryByTestId("workspace-more")).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string).answers).toEqual({ toilet: { result: "pass" } });
    expect(mockSubmitLegacy).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("offers a way back to the queue and to the room, and never switches to another room", async () => {
    const { answer, press, screen } = await open();
    await answer("toilet", "pass");
    mockQueue.mockResolvedValue([readyRoom("room-305", { room_number: "305" })]);
    await roomChanged();
    expect(screen.queryByText("305")).toBeNull();
    await press("workspace-blocked-view");
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-205" } });
  });

  it("the housekeeper starts a new clean: the old answers no longer apply", async () => {
    const { answer, text } = await open();
    await answer("toilet", "pass");
    mockQueue.mockResolvedValue([room205({ clean_cycle_id: "cycle-2" })]);
    await roomChanged();
    expect(text("workspace-blocked-title")).toBe("Room 205 has changed");
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string).cleanCycleId).toBe("cycle-1");
  });

  it("the earlier failure being re-checked changes", async () => {
    const failure = { inspection_id: "insp-9", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "reclean" as const, items: [] };
    const { answer, text } = await open();
    await answer("toilet", "pass");
    mockQueue.mockResolvedValue([room205({ previous_failure: failure })]);
    await roomChanged();
    expect(text("workspace-blocked-title")).toBe("Room 205 has changed");
  });

  it("the hotel day rolls over", async () => {
    const { answer, text } = await open();
    await answer("toilet", "pass");
    dateNow.mockReturnValue(Date.parse("2026-10-21T07:00:00Z")); // 2:00 AM the next hotel day
    await roomChanged();
    expect(text("workspace-blocked-title")).toBe("A new day has started");
  });

  it("the room's checklist disappears", async () => {
    const { answer, text } = await open();
    await answer("toilet", "pass");
    mockTemplates.mockResolvedValue({ data: [standardTemplate({ is_active: false })] });
    await roomChanged();
    expect(text("workspace-blocked-title")).toBe("The checklist isn't available");
  });

  it("if the room comes back unchanged the inspection simply continues", async () => {
    const { answer, screen } = await open();
    await answer("toilet", "pass");
    mockQueue.mockResolvedValue([]);
    await roomChanged();
    expect(screen.queryByTestId("workspace-list")).toBeNull();
    mockQueue.mockResolvedValue([room205()]);
    await roomChanged();
    expect(screen.getByTestId("workspace-list")).toBeTruthy();
    expect(screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("a refresh that cannot run does not interrupt the supervisor: not knowing is not a reason to stop", async () => {
    const { answer, screen } = await open();
    await answer("toilet", "pass");
    mockQueue.mockRejectedValue(new Error("offline"));
    await roomChanged();
    expect(screen.getByTestId("workspace-list")).toBeTruthy();
  });
});

describe("accounts", () => {
  it("another hotel signing in leaves the previous inspection behind: its details are never shown and the screen goes back", async () => {
    const { answer, screen } = await open();
    await answer("toilet", "pass");
    await afterAutosave();
    mockQueue.mockResolvedValue([readyRoom("room-900", { room_number: "900" })]);
    await act(async () => useAppStore.setState({ user: { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" } as never }));
    await settle();
    expect(navigate).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
    expect(screen.queryByText("Maria S.")).toBeNull();
    expect(screen.queryByTestId("workspace-answer-toilet-pass")).toBeNull();
    // the first hotel's draft is still on the phone, under ITS key
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(draftKey("hotel-2", "sup-1", "room-205"))).toBeNull();
  });

  it("a late reply for the previous hotel is ignored", async () => {
    let releaseOld: (rooms: unknown[]) => void = () => undefined;
    mockQueue.mockReset();
    mockQueue.mockReturnValueOnce(new Promise((resolve) => { releaseOld = resolve; }));
    const { screen } = await open();
    mockQueue.mockResolvedValue([readyRoom("room-900", { room_number: "900" })]);
    await act(async () => useAppStore.setState({ user: { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" } as never }));
    await settle();
    await act(async () => releaseOld([room205()]));
    await settle();
    expect(screen.queryByTestId("workspace-room-number")).toBeNull();
    expect(flatText(screen.getByTestId("workspace-unavailable-title"))).toBe("Not waiting for inspection");
  });

  it("signing out says so", async () => {
    const { text } = await open();
    await act(async () => useAppStore.setState({ user: null as never }));
    await settle();
    expect(text("workspace-unavailable-title")).toBe("Signed out");
  });
});

describe("speed and size", () => {
  it("rapid changes to one item settle on the last tap, in memory and on the phone", async () => {
    const { answer, screen } = await open();
    await answer("toilet", "pass");
    await answer("toilet", "fail");
    await answer("toilet", "na");
    await answer("toilet", "pass");
    await afterAutosave();
    expect(screen.getByTestId("workspace-answer-toilet-pass").props.accessibilityState).toMatchObject({ checked: true });
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string).answers).toEqual({ toilet: { result: "pass" } });
  });

  it("a large hotel checklist mounts only the open section, not every item", async () => {
    const items = Array.from({ length: 40 }, (_, s) => Array.from({ length: 10 }, (_, i) => rawItem(`s${s}i${i}`, { section: `Section ${s}`, description: `Check ${s}.${i}`, sort_order: s * 10 + i }))).flat();
    mockTemplates.mockResolvedValue({ data: [standardTemplate({ items })] });
    const { screen, text } = await open();
    expect(text("workspace-progress-fraction")).toBe("0 of 400");
    // virtualised: nowhere near the 40 headers + 10 open items exist as views at once
    const mounted = screen.getAllByTestId(/^workspace-(section-Section \d+|item-s\d+i\d+)$/).length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThanOrEqual(20);
    expect(screen.queryByTestId("workspace-item-s1i0")).toBeNull(); // a collapsed section's items are never mounted
  });

  it("releases its subscription and timers when the screen goes away", async () => {
    const unsubscribe = jest.fn();
    mockSubscribe.mockImplementation(() => unsubscribe);
    const { screen, answer } = await open();
    await answer("toilet", "pass");
    screen.unmount();
    await flush();
    expect(unsubscribe).toHaveBeenCalled();
    expect(await AsyncStorage.getItem(KEY)).not.toBeNull(); // and what was pending is written on the way out
  });

  it("the checklist items are all the template's, in order, with nothing added", async () => {
    const { screen, press } = await open();
    await press("workspace-section-Bedroom");
    await press("workspace-section-Entry");
    expect(screen.getAllByTestId(/^workspace-item-[a-z]+$/).map((n) => n.props.testID.replace("workspace-item-", ""))).toEqual(CHECKLIST_ITEMS.map((i) => i.id));
  });
});

import React from "react";
import { AppState } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { build, room, session } from "../helpers/homeModelFixture";
import type { ChecklistItem, LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import type { ActionResult } from "@/stores/cleanSessionStore";

jest.mock("react-i18next", () => {
  const { makeTranslator } = require("../helpers/i18n");
  const t = makeTranslator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

let mockScreenReader = false;
jest.mock("@/lib/accessibility/useScreenReader", () => ({ useScreenReaderEnabled: () => mockScreenReader }));
const mockMarkRoomClean = jest.fn();
jest.mock("@/lib/housekeeping/markClean", () => ({ markRoomClean: (...args: unknown[]) => mockMarkRoomClean(...args) }));

const mockRestore = jest.fn().mockResolvedValue(undefined);
const mockStore: { sessions: Record<string, LocalCleanSession>; scope: string } = { sessions: {}, scope: "s" };
jest.mock("@/stores/cleanSessionStore", () => ({
  useCleanSessionStore: Object.assign((selector: (state: unknown) => unknown) => selector(mockStore), {
    getState: () => ({ restoreForRoom: (...args: unknown[]) => mockRestore(...args) }),
  }),
  selectSession: (roomId: string) => (state: typeof mockStore) => state.sessions[roomId],
}));

import { MarkCleanConfirmationSheet } from "@/components/home/MarkCleanConfirmationSheet";
import { makeTranslator } from "../helpers/i18n";

const t = makeTranslator("en");
const ctx = { language: "en", timeZone: "America/Chicago" };

const item = (id: string, checked: boolean): ChecklistItem => ({ item_id: id, section: "Bed", label: `Item ${id}`, is_required: true, checked, checked_at: null });
const complete = () => [item("a", true), item("b", true)];

function rooms(extra: ReturnType<typeof room>[] = [room("215", { clean_type: "LIGHT" })]) {
  return [room("208", { status: "IN_PROGRESS", clean_type: "LIGHT" }), ...extra];
}

interface Handlers {
  onClose: jest.Mock;
  onOpenRoom: jest.Mock;
  onOpenSync: jest.Mock;
  onConfirmed: jest.Mock;
}

function renderSheet(opts: { checklist?: ChecklistItem[]; online?: boolean; roomList?: ReturnType<typeof room>[]; noSession?: boolean } = {}) {
  const roomList = opts.roomList ?? rooms();
  const live = session("208", { cleanType: "LIGHT", checklist: opts.checklist ?? complete() });
  mockStore.sessions = opts.noSession ? {} : { "208": live };
  const handlers: Handlers = { onClose: jest.fn(), onOpenRoom: jest.fn(), onOpenSync: jest.fn(), onConfirmed: jest.fn() };
  const model = (list = roomList) => build(list, { sessions: opts.noSession ? {} : { "208": live }, online: opts.online ?? true });
  const tree = (list = roomList) => (
    <ThemeProvider>
      <MarkCleanConfirmationSheet visible roomId="208" model={model(list)} isOnline={opts.online ?? true} t={t} ctx={ctx} {...handlers} />
    </ThemeProvider>
  );
  const view = render(tree());
  return { ...view, handlers, rerenderWith: (list: ReturnType<typeof room>[]) => view.rerender(tree(list)) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMarkRoomClean.mockReset();
  mockRestore.mockResolvedValue(undefined);
  mockScreenReader = false;
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const confirmed = (): ActionResult => ({ outcome: "confirmed", session: session("208") });
const queued = (): ActionResult => ({ outcome: "queued", session: session("208") });

describe("MarkCleanConfirmationSheet — before confirming", () => {
  it("states what will happen: checklist done, new status, next step", async () => {
    const { getByTestId, getByText } = renderSheet();
    expect(getByText("Finish room 208?")).toBeTruthy();
    expect(getByTestId("mark-clean-checklist")).toBeTruthy();
    expect(getByText("Required checklist complete")).toBeTruthy();
    expect(getByText("2 of 2 required items")).toBeTruthy();
    expect(getByTestId("mark-clean-new-status").props.accessibilityLabel).toBe("New status Clean");
    expect(getByTestId("mark-clean-next-step").props.accessibilityLabel).toBe("Next step Inspection");
    expect(getByText("Hold to confirm clean")).toBeTruthy();
    expect(getByText("Release to cancel")).toBeTruthy();
    expect(mockMarkRoomClean).not.toHaveBeenCalled();
  });

  it("refreshes this phone's copy of the session when online, and not when offline", async () => {
    renderSheet();
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith({ id: "208", status: "IN_PROGRESS" }));
    mockRestore.mockClear();
    renderSheet({ online: false });
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("says offline completion is only saved on the phone, and not Clean until the server confirms", () => {
    const { getByTestId } = renderSheet({ online: false });
    expect(getByTestId("mark-clean-offline")).toBeTruthy();
    expect(getByTestId("mark-clean-new-status").props.accessibilityLabel).toBe("New status Clean, once the server confirms");
  });

  it("explains an unfinished checklist and routes to finishing it — no disabled button without a reason", () => {
    const { getByTestId, queryByTestId, getByText } = renderSheet({ checklist: [item("a", true), item("b", false), item("c", false)] });
    expect(getByTestId("mark-clean-blocked-checklist_incomplete")).toBeTruthy();
    expect(getByText(/1 of 3 done/)).toBeTruthy();
    expect(getByTestId("mark-clean-missing")).toBeTruthy();
    expect(getByText("• Item b")).toBeTruthy();
    expect(queryByTestId("mark-clean-hold")).toBeNull();
    expect(queryByTestId("mark-clean-tap")).toBeNull();
    fireEvent.press(getByTestId("mark-clean-open-room"));
    expect(mockMarkRoomClean).not.toHaveBeenCalled();
  });

  it("names how many more items are open past the first few", () => {
    const many = ["a", "b", "c", "d", "e"].map((id) => item(id, false));
    const { getByText } = renderSheet({ checklist: many });
    expect(getByText("and 2 more")).toBeTruthy();
  });

  it("sends a departure to the room screen for its linen counts", () => {
    const { getByTestId, queryByTestId } = renderSheet({ roomList: [room("208", { status: "IN_PROGRESS", clean_type: "DEP" })] });
    expect(getByTestId("mark-clean-blocked-departure")).toBeTruthy();
    expect(queryByTestId("mark-clean-tap")).toBeNull();
  });

  it("offers Open room when the phone holds no session", async () => {
    const { getByTestId, findByTestId } = renderSheet({ noSession: true });
    expect(await findByTestId("mark-clean-blocked-no_session")).toBeTruthy();
    expect(getByTestId("mark-clean-open-room")).toBeTruthy();
  });

  it("closes safely, with a clear message, when the room was reassigned while the sheet was open", () => {
    const { getByTestId, queryByTestId, rerenderWith } = renderSheet();
    expect(getByTestId("mark-clean-tap")).toBeTruthy();
    rerenderWith([room("999")]);
    expect(getByTestId("mark-clean-gone")).toBeTruthy();
    expect(queryByTestId("mark-clean-tap")).toBeNull();
    expect(queryByTestId("mark-clean-hold")).toBeNull();
  });
});

describe("MarkCleanConfirmationSheet — confirming", () => {
  it("confirms with the tap alternative: the server result, then the next room", async () => {
    mockMarkRoomClean.mockResolvedValue(confirmed());
    const { getByTestId, getByText, queryByTestId, handlers } = renderSheet();

    fireEvent.press(getByTestId("mark-clean-tap"));

    await waitFor(() => expect(getByTestId("post-completion-confirmed")).toBeTruthy());
    expect(mockMarkRoomClean).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirmed).toHaveBeenCalledWith("208");
    expect(getByText("Ready for inspection.")).toBeTruthy();
    // Submitting is not inspecting.
    expect(queryByTestId("post-completion-queued")).toBeNull();
    expect(getByTestId("post-completion-next")).toBeTruthy();

    fireEvent.press(getByTestId("post-completion-open-next"));
    expect(handlers.onOpenRoom).toHaveBeenCalledWith("215");
  });

  it("goes Back to Home from the confirmation", async () => {
    mockMarkRoomClean.mockResolvedValue(confirmed());
    const { getByTestId, handlers } = renderSheet();
    fireEvent.press(getByTestId("mark-clean-tap"));
    await waitFor(() => expect(getByTestId("post-completion-home")).toBeTruthy());
    fireEvent.press(getByTestId("post-completion-home"));
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("says so when no other room is ready", async () => {
    mockMarkRoomClean.mockResolvedValue(confirmed());
    const { getByTestId, queryByTestId } = renderSheet({ roomList: rooms([]) });
    fireEvent.press(getByTestId("mark-clean-tap"));
    await waitFor(() => expect(getByTestId("post-completion-none")).toBeTruthy());
    expect(queryByTestId("post-completion-open-next")).toBeNull();
  });

  it("never offers a restricted room as the next one", async () => {
    mockMarkRoomClean.mockResolvedValue(confirmed());
    const { getByTestId, queryByText } = renderSheet({ roomList: rooms([room("216", { dnd_flag: true, clean_type: "LIGHT" }), room("220", { clean_type: "LIGHT" })]) });
    fireEvent.press(getByTestId("mark-clean-tap"));
    await waitFor(() => expect(getByTestId("post-completion-next")).toBeTruthy());
    expect(queryByText("Open room 216")).toBeNull();
    expect(getByTestId("post-completion-open-next")).toBeTruthy();
  });

  it("prevents a duplicate submission from repeated taps", async () => {
    let resolve: (value: ActionResult) => void = () => undefined;
    mockMarkRoomClean.mockImplementation(() => new Promise<ActionResult>((r) => { resolve = r; }));
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId("mark-clean-tap"));
    fireEvent.press(getByTestId("mark-clean-tap"));
    fireEvent.press(getByTestId("mark-clean-tap"));
    expect(mockMarkRoomClean).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(confirmed());
    });
    await waitFor(() => expect(getByTestId("post-completion-confirmed")).toBeTruthy());
    expect(mockMarkRoomClean).toHaveBeenCalledTimes(1);
  });

  it("shows a queued completion as saved on the device — never as Clean", async () => {
    mockMarkRoomClean.mockResolvedValue(queued());
    const { getByTestId, getByText, getAllByText, queryByTestId, handlers } = renderSheet({ online: false });
    fireEvent.press(getByTestId("mark-clean-tap"));

    await waitFor(() => expect(getByTestId("post-completion-queued")).toBeTruthy());
    expect(getAllByText("Room 208 saved on this device").length).toBeGreaterThan(0);
    expect(getByText(/waiting to sync/)).toBeTruthy();
    expect(queryByTestId("post-completion-confirmed")).toBeNull();
    // The room is not reported to Home as confirmed.
    expect(handlers.onConfirmed).not.toHaveBeenCalled();

    fireEvent.press(getByTestId("post-completion-sync"));
    expect(handlers.onOpenSync).toHaveBeenCalled();
  });

  it("keeps the sheet open and says what is unfinished when the server rejects the completion", async () => {
    mockMarkRoomClean.mockResolvedValue({
      outcome: "rejected",
      code: "REQUIRED_ITEMS_INCOMPLETE",
      message: "2 required checklist item(s) unfinished",
      missing: ["Make bed", "Vacuum"],
    } as ActionResult);
    const { getByTestId, getByText, queryByTestId, handlers } = renderSheet();
    fireEvent.press(getByTestId("mark-clean-tap"));

    await waitFor(() => expect(getByTestId("mark-clean-error")).toBeTruthy());
    expect(getByText("Finish the required checklist items first.")).toBeTruthy();
    expect(getByText("• Make bed")).toBeTruthy();
    expect(queryByTestId("post-completion-confirmed")).toBeNull();
    expect(handlers.onConfirmed).not.toHaveBeenCalled();
    expect(getByTestId("mark-clean-error-open-room")).toBeTruthy();
    // A safe retry stays available.
    expect(getByTestId("mark-clean-tap")).toBeTruthy();
  });

  it("explains a session conflict in the person's words, not the server's", async () => {
    mockMarkRoomClean.mockResolvedValue({ outcome: "rejected", code: "SESSION_ABANDONED", message: "RAW SERVER TEXT 4f2a" } as ActionResult);
    const { getByTestId, getByText, queryByText } = renderSheet();
    fireEvent.press(getByTestId("mark-clean-tap"));
    await waitFor(() => expect(getByText("This cleaning session was closed.")).toBeTruthy());
    expect(queryByText(/RAW SERVER TEXT/)).toBeNull();
  });

  it("recovers from a thrown network error without a false success", async () => {
    mockMarkRoomClean.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce(confirmed());
    const { getByTestId, getByText, queryByTestId } = renderSheet();
    fireEvent.press(getByTestId("mark-clean-tap"));
    await waitFor(() => expect(getByTestId("mark-clean-error")).toBeTruthy());
    expect(getByText(/Nothing was changed/)).toBeTruthy();
    expect(queryByTestId("post-completion-confirmed")).toBeNull();

    fireEvent.press(getByTestId("mark-clean-tap"));
    await waitFor(() => expect(getByTestId("post-completion-confirmed")).toBeTruthy());
    expect(mockMarkRoomClean).toHaveBeenCalledTimes(2);
  });

  it("submits the live room from the model, not a stale copy", async () => {
    mockMarkRoomClean.mockResolvedValue(confirmed());
    const { getByTestId } = renderSheet();
    fireEvent.press(getByTestId("mark-clean-tap"));
    await waitFor(() => expect(mockMarkRoomClean).toHaveBeenCalled());
    expect(mockMarkRoomClean.mock.calls[0][0]).toMatchObject({ id: "208", status: "IN_PROGRESS" });
  });
});

describe("MarkCleanConfirmationSheet — hold to confirm", () => {
  it("confirms after a sustained press and cancels when released early", async () => {
    jest.useFakeTimers();
    mockMarkRoomClean.mockResolvedValue(confirmed());
    const { getByTestId } = renderSheet();
    const hold = getByTestId("mark-clean-hold");

    fireEvent(hold, "pressIn");
    act(() => void jest.advanceTimersByTime(300));
    fireEvent(hold, "pressOut");
    act(() => void jest.advanceTimersByTime(1000));
    expect(mockMarkRoomClean).not.toHaveBeenCalled();

    fireEvent(hold, "pressIn");
    await act(async () => {
      jest.advanceTimersByTime(750);
    });
    expect(mockMarkRoomClean).toHaveBeenCalledTimes(1);
  });

  it("cancels the hold when the app leaves the foreground", () => {
    jest.useFakeTimers();
    let onChange: (state: string) => void = () => undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, handler: (state: string) => void) => {
      onChange = handler;
      return { remove: jest.fn() };
    }) as never);
    const { getByTestId } = renderSheet();

    fireEvent(getByTestId("mark-clean-hold"), "pressIn");
    act(() => void jest.advanceTimersByTime(300));
    act(() => onChange("background"));
    act(() => void jest.advanceTimersByTime(2000));
    expect(mockMarkRoomClean).not.toHaveBeenCalled();
  });

  it("makes the tap alternative the main action for a screen reader, where a hold is not reliable", async () => {
    mockScreenReader = true;
    const { getByTestId, queryByTestId } = renderSheet();
    expect(queryByTestId("mark-clean-hold")).toBeNull();
    const tap = getByTestId("mark-clean-tap");
    expect(tap.props.accessibilityLabel).toBe("Confirm room 208 is clean");
  });

  it("runs the very same checks on the tap alternative: an incomplete room cannot be confirmed either way", () => {
    const { queryByTestId } = renderSheet({ checklist: [item("a", false)] });
    expect(queryByTestId("mark-clean-hold")).toBeNull();
    expect(queryByTestId("mark-clean-tap")).toBeNull();
  });
});

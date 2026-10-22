import React from "react";
import { Keyboard, Modal } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";

/* Search, the Filter & Sort drawer, chips and persistence on the real screen. The harness mirrors the one in
   InspectionsScreen.test.tsx (the network, router, translator and realtime channel are the only fakes). */

let mockParams: Record<string, string | undefined> = {};
const mockParamListeners = new Set<() => void>();
const mockSetParams = jest.fn((next: Record<string, string | undefined>) => {
  mockParams = Object.fromEntries(Object.entries({ ...mockParams, ...next }).filter(([, value]) => value !== undefined));
  mockParamListeners.forEach((listener) => listener());
});

jest.mock("expo-router", () => {
  const react = require("react");
  return {
    router: { setParams: (...args: [Record<string, string | undefined>]) => mockSetParams(...args), back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn() },
    useLocalSearchParams: () => {
      const [, force] = react.useState(0);
      react.useEffect(() => {
        const listener = () => force((n: number) => n + 1);
        mockParamListeners.add(listener);
        return () => {
          mockParamListeners.delete(listener);
        };
      }, []);
      return mockParams;
    },
  };
});
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
const mockSubscribe = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({ subscribeSupervisorRealtime: (...args: unknown[]) => mockSubscribe(...args) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
const mockQueue = jest.fn();
jest.mock("@/lib/api/inspections", () => ({
  listInspectionTemplates: jest.fn(),
  submitInspection: jest.fn(),
  fetchReadyForInspection: (...args: unknown[]) => mockQueue(...args),
  fetchReadyForInspectionVerified: (...args: unknown[]) => mockQueue(...args),
  fetchOpenCorrections: jest.fn(),
  fetchInspectionRecords: jest.fn(),
  fetchInspectionDetail: jest.fn(),
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({ triggerReclean: jest.fn() }));
const mockHistoryPage = jest.fn();
jest.mock("@/lib/api/inspectionHistory", () => ({
  fetchInspectionHistory: (...args: unknown[]) => mockHistoryPage(...args),
  fetchInspectionInsights: jest.fn().mockResolvedValue(require("../helpers/inspectionFixtures").historyInsights()),
  fetchHistoryInspectors: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
}));

import { fetchInspectionRecords, fetchOpenCorrections, listInspectionTemplates } from "@/lib/api/inspections";
import { router } from "expo-router";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { useAppStore } from "@/stores/appStore";
import InspectScreen from "@/app/(app)/inspect";
import { historyRow, inspectionRecord, openCorrection, rawTemplate, readyRoom } from "../helpers/inspectionFixtures";

const NOW = Date.parse("2026-10-20T18:00:00Z"); // 1:00 PM in Chicago
const mockCorrections = fetchOpenCorrections as jest.Mock;
const mockRecords = fetchInspectionRecords as jest.Mock;
const mockTemplates = listInspectionTemplates as jest.Mock;

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
async function settle() {
  await flush();
  await flush();
}

type Screen = ReturnType<typeof renderScreen>;
function renderScreen() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <InspectScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

const room = (n: string, over = {}) =>
  readyRoom(`room-${n}`, { room_number: n, floor: Number(n[0]), cleaned_at: "2026-10-20T17:00:00.000Z", clean_type: "DEP", ...over });
const shownRooms = (screen: Screen) => screen.queryAllByTestId(/^queue-card-room-/).map((node) => String(node.props.testID).replace("queue-card-room-", ""));
const press = (screen: Screen, id: string) => act(async () => fireEvent.press(screen.getByTestId(id)));
const type = (screen: Screen, value: string) => act(async () => fireEvent.changeText(screen.getByTestId("inspect-search"), value));
const applyLabel = (screen: Screen) => screen.getByTestId("inspect-filter-apply").props.accessibilityLabel as string;

const FIVE = () => [
  room("201", { cleaned_at: "2026-10-20T16:00:00.000Z", vip: true, arrival_at: "2026-10-20T22:00:00Z" }),
  room("202", { cleaned_at: "2026-10-20T15:00:00.000Z", vip: false, clean_type: "LIGHT", arrival_at: "2026-10-20T16:00:00Z" }),
  room("301", { vip: true }),
  room("302", { vip: false, clean_type: "FULL" }),
  room("112", { vip: false }),
];

let dateNow: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  dateNow = jest.spyOn(Date, "now").mockReturnValue(NOW);
  mockQueue.mockResolvedValue(FIVE());
  mockTemplates.mockResolvedValue({ data: [rawTemplate("t1", { is_default: true, room_type_id: null })] });
  mockCorrections.mockResolvedValue({ rows: [], truncated: false });
  mockRecords.mockResolvedValue([]);
  mockHistoryPage.mockResolvedValue({ rows: [], hasMore: false, nextCursor: null, total: 0 });
  mockSubscribe.mockImplementation(() => jest.fn());
  useAppStore.setState({ hotelTimezone: "America/Chicago", isOnline: true, user: { id: "sup-1", tenant_id: "hotel-1", role: "housekeeping_supervisor" } as never });
});
afterEach(() => dateNow.mockRestore());

describe("search", () => {
  it("is a room-number field with the documented placeholder", async () => {
    const screen = renderScreen();
    await settle();
    expect(screen.getByPlaceholderText("Search room number…")).toBeTruthy();
    expect(screen.getByTestId("inspect-search").props.accessibilityLabel).toBe("Search by room number");
  });

  it("filters as you type without asking the server again", async () => {
    const screen = renderScreen();
    await settle();
    mockQueue.mockClear();
    await type(screen, "30");
    expect(shownRooms(screen).sort()).toEqual(["301", "302"]);
    expect(mockQueue).not.toHaveBeenCalled();
    await type(screen, "301");
    expect(shownRooms(screen)).toEqual(["301"]);
  });

  it("ranks exact, then prefix, then contains, and ignores case and surrounding spaces", async () => {
    mockQueue.mockResolvedValue([room("211"), room("112"), room("11"), room("2A")]);
    const screen = renderScreen();
    await settle();
    await type(screen, "  11 ");
    expect(shownRooms(screen)).toEqual(["11", "112", "211"]);
    await type(screen, "2a");
    expect(shownRooms(screen)).toEqual(["2A"]);
  });

  it("does not match a housekeeper's name", async () => {
    mockQueue.mockResolvedValue([room("201", { cleaned_by: "Maria" })]);
    const screen = renderScreen();
    await settle();
    await type(screen, "maria");
    expect(shownRooms(screen)).toEqual([]);
    expect(screen.getByText("No rooms match your search")).toBeTruthy();
  });

  it("has a clear action that appears with text and restores the list", async () => {
    const screen = renderScreen();
    await settle();
    expect(screen.queryByTestId("inspect-search-clear")).toBeNull();
    await type(screen, "301");
    await press(screen, "inspect-search-clear");
    expect(screen.getByTestId("inspect-search").props.value).toBe("");
    expect(shownRooms(screen)).toHaveLength(5);
  });

  it("no match is not the same as an empty queue, and offers to clear the search", async () => {
    const screen = renderScreen();
    await settle();
    await type(screen, "999");
    expect(screen.getByText("No rooms match your search")).toBeTruthy();
    expect(screen.queryByText("All caught up")).toBeNull();
    await press(screen, "inspect-empty-search-action");
    expect(shownRooms(screen)).toHaveLength(5);
  });

  it("dismisses the keyboard on submit", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss");
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent(screen.getByTestId("inspect-search"), "submitEditing"));
    expect(dismiss).toHaveBeenCalled();
  });

  it("searches Corrections locally and Done on the server, by room number", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305"), openCorrection("406")], truncated: false });
    mockHistoryPage.mockResolvedValue({ rows: [historyRow("305")], hasMore: false, nextCursor: null, total: 1 });
    const screen = renderScreen();
    await settle();
    await type(screen, "30");
    await press(screen, "inspect-tab-corrections");
    expect(screen.getByTestId("inspect-search").props.value).toBe("30");
    expect(screen.queryAllByTestId(/^correction-card-room-/)).toHaveLength(1);
    await press(screen, "inspect-tab-done");
    // Done has its own room search, asked of the server (after a short pause), not filtered on the phone
    expect(screen.getByTestId("inspect-search").props.value).toBe("");
    await type(screen, "30");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    await settle();
    expect(mockHistoryPage).toHaveBeenLastCalledWith(expect.objectContaining({ roomNumber: "30" }));
    expect(screen.queryAllByTestId(/^done-row-/)).toHaveLength(1);
    await press(screen, "inspect-tab-queue");
    expect(screen.getByTestId("inspect-search").props.value).toBe("30"); // the list tabs keep their own text
  });

  it("is kept when a room is opened and closed again", async () => {
    const screen = renderScreen();
    await settle();
    await type(screen, "30");
    await press(screen, "queue-card-room-301");
    await settle();
    // the room opens in its own screen; this one stays mounted underneath, exactly as it was left
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-301", from: "queue", roomNumber: "301" } });
    expect(screen.getByTestId("inspect-search").props.value).toBe("30");
    expect(shownRooms(screen).sort()).toEqual(["301", "302"]);
  });
});

describe("the Filter & Sort drawer", () => {
  const open = async (screen: Screen) => press(screen, "inspect-filter-button");

  it("opens from the filter button with every section and a sort that starts on Priority first", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    const sheet = within(screen.getByTestId("inspect-filter-sheet"));
    for (const title of ["Filter & Sort", "Priority", "Inspection type", "Sort by"]) expect(sheet.getByText(title)).toBeTruthy();
    expect(sheet.getAllByText("Floor").length).toBeGreaterThanOrEqual(2); // the section title and the Floor sort
    expect(screen.getByTestId("inspect-sort-priority").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("inspect-filter-priority-all").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("inspect-filter-floor-all").props.accessibilityState).toMatchObject({ checked: true });
    expect(applyLabel(screen)).toBe("Show 5 rooms");
  });

  it("offers the hotel's real floors", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    for (const floor of ["~|1", "~|2", "~|3"]) expect(screen.getByTestId(`inspect-filter-floor-${floor}`)).toBeTruthy();
    expect(screen.queryByTestId("inspect-filter-floor-~|4")).toBeNull();
  });

  it("edits a draft: nothing changes until Show is tapped, and the button counts the real result", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-floor-~|3");
    expect(applyLabel(screen)).toBe("Show 2 rooms");
    expect(shownRooms(screen)).toHaveLength(5); // the list behind the drawer is unchanged
    await press(screen, "inspect-filter-apply");
    expect(shownRooms(screen).sort()).toEqual(["301", "302"]);
    expect(screen.queryByTestId("inspect-filter-sheet")).toBeNull();
    expect(screen.getByTestId("inspect-result-count").props.children).toEqual("Showing 2 of 5 rooms");
  });

  it("closing without applying discards the draft", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-floor-~|3");
    await press(screen, "inspect-filter-close");
    expect(shownRooms(screen)).toHaveLength(5);
    expect(screen.queryByTestId("inspect-active-filters")).toBeNull();
    await open(screen);
    expect(screen.getByTestId("inspect-filter-floor-~|3").props.accessibilityState).toMatchObject({ checked: false });
    expect(applyLabel(screen)).toBe("Show 5 rooms");
  });

  it("the backdrop and Android back close it without applying", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-floor-~|3");
    // the backdrop is rightly hidden from screen readers while the sheet is modal, so reach it past that filter
    await act(async () => fireEvent.press(screen.getByTestId("inspect-filter-backdrop", { includeHiddenElements: true })));
    expect(screen.queryByTestId("inspect-filter-sheet")).toBeNull();
    await open(screen);
    await press(screen, "inspect-filter-floor-~|3");
    await act(async () => {
      screen.UNSAFE_getAllByType(Modal)[0].props.onRequestClose();
    });
    expect(screen.queryByTestId("inspect-filter-sheet")).toBeNull();
    expect(shownRooms(screen)).toHaveLength(5);
  });

  it("starts each opening from what is applied, and Reset only clears the draft until Show", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-floor-~|3");
    await press(screen, "inspect-filter-apply");
    await open(screen);
    expect(screen.getByTestId("inspect-filter-floor-~|3").props.accessibilityState).toMatchObject({ checked: true });
    await press(screen, "inspect-filter-reset");
    expect(screen.getByTestId("inspect-filter-floor-~|3").props.accessibilityState).toMatchObject({ checked: false });
    expect(applyLabel(screen)).toBe("Show 5 rooms");
    expect(shownRooms(screen)).toHaveLength(2); // still the applied filter behind the drawer
    await press(screen, "inspect-filter-apply");
    expect(shownRooms(screen)).toHaveLength(5);
    expect(screen.queryByTestId("inspect-active-filters")).toBeNull();
  });

  it("several floors widen (OR); a priority filter then narrows (AND)", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-floor-~|2");
    await press(screen, "inspect-filter-floor-~|3");
    expect(applyLabel(screen)).toBe("Show 4 rooms");
    await press(screen, "inspect-filter-priority-vip");
    expect(applyLabel(screen)).toBe("Show 2 rooms");
    await press(screen, "inspect-filter-apply");
    expect(shownRooms(screen).sort()).toEqual(["201", "301"]);
  });

  it("several priority choices widen (OR)", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-priority-vip");
    await press(screen, "inspect-filter-priority-overdue");
    await press(screen, "inspect-filter-apply");
    expect(shownRooms(screen).sort()).toEqual(["201", "202", "301"]);
  });

  it("initial / reinspection and departure / stayover are separate questions", async () => {
    mockQueue.mockResolvedValue([
      room("201"),
      room("202", { clean_type: "LIGHT" }),
      room("301", { previous_failure: { inspection_id: "i", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "reclean", items: [] } }),
    ]);
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-review-reinspection");
    expect(applyLabel(screen)).toBe("Show 1 room");
    await press(screen, "inspect-filter-review-reinspection");
    await press(screen, "inspect-filter-clean-stayover");
    expect(applyLabel(screen)).toBe("Show 1 room");
    await press(screen, "inspect-filter-review-initial");
    await press(screen, "inspect-filter-apply");
    expect(shownRooms(screen)).toEqual(["202"]);
  });

  it("a filter with no data behind it is disabled with the reason, and cannot create a false zero", async () => {
    mockQueue.mockResolvedValue([room("201", { vip: undefined, arrival_at: undefined, clean_type: null })]);
    const screen = renderScreen();
    await settle();
    await open(screen);
    for (const id of ["inspect-filter-priority-arrival", "inspect-filter-priority-vip", "inspect-filter-priority-overdue", "inspect-filter-clean-departure", "inspect-filter-clean-stayover"]) {
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ disabled: true });
      expect(screen.getByTestId(id).props.accessibilityLabel).toMatch(/No data recorded yet$/);
    }
    expect(screen.getByTestId("inspect-filter-review-reinspection").props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("sorting is a single choice and reorders the list", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-sort-room");
    expect(screen.getByTestId("inspect-sort-room").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("inspect-sort-priority").props.accessibilityState).toMatchObject({ selected: false });
    await press(screen, "inspect-sort-floor");
    expect(screen.getByTestId("inspect-sort-room").props.accessibilityState).toMatchObject({ selected: false });
    await press(screen, "inspect-sort-room");
    await press(screen, "inspect-filter-apply");
    expect(shownRooms(screen)).toEqual(["112", "201", "202", "301", "302"]);
    expect(screen.getByTestId("inspect-filter-badge")).toBeTruthy();
    await open(screen);
    await press(screen, "inspect-sort-waiting");
    await press(screen, "inspect-filter-apply");
    expect(shownRooms(screen)[0]).toBe("202"); // cleaned the longest ago
  });

  it("the count includes the search that is already typed", async () => {
    const screen = renderScreen();
    await settle();
    await type(screen, "30");
    await open(screen);
    expect(applyLabel(screen)).toBe("Show 2 rooms");
    await press(screen, "inspect-filter-priority-vip");
    expect(applyLabel(screen)).toBe("Show 1 room");
  });

  it("keeps a half-made selection when the list refreshes behind it", async () => {
    const screen = renderScreen();
    await settle();
    await open(screen);
    await press(screen, "inspect-filter-floor-~|3");
    await act(async () => {
      (mockSubscribe.mock.calls[0][1] as () => void)();
    });
    await settle();
    expect(screen.getByTestId("inspect-filter-floor-~|3").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("labels floors with their building when the hotel has several", async () => {
    mockQueue.mockResolvedValue([room("101", { room_id: "a-101", building: "A", floor: 1 }), room("101", { room_id: "b-101", building: "B", floor: 1 })]);
    const screen = renderScreen();
    await settle();
    await open(screen);
    expect(screen.getByTestId("inspect-filter-floor-A|1").props.accessibilityLabel).toBe("A · Floor 1");
    expect(screen.getByTestId("inspect-filter-floor-B|1").props.accessibilityLabel).toBe("B · Floor 1");
    await press(screen, "inspect-filter-floor-B|1");
    await press(screen, "inspect-filter-apply");
    expect(screen.getAllByTestId(/^queue-card-/).map((n) => n.props.testID)).toContain("queue-card-b-101");
    expect(screen.queryByTestId("queue-card-a-101")).toBeNull();
  });
});

describe("applied filters and chips", () => {
  const apply = async (screen: Screen, ids: string[]) => {
    await press(screen, "inspect-filter-button");
    for (const id of ids) await press(screen, id);
    await press(screen, "inspect-filter-apply");
  };

  it("shows one chip per filter, each removes its own filter, and Clear all clears the rest", async () => {
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-floor-~|3", "inspect-filter-priority-vip"]);
    expect(screen.getByTestId("inspect-chip-floor:~|3")).toBeTruthy();
    expect(screen.getByTestId("inspect-chip-priority:vip")).toBeTruthy();
    expect(screen.getByTestId("inspect-result-count").props.children).toBe("Showing 1 of 5 rooms");
    await press(screen, "inspect-chip-priority:vip");
    expect(screen.queryByTestId("inspect-chip-priority:vip")).toBeNull();
    expect(screen.getByTestId("inspect-result-count").props.children).toBe("Showing 2 of 5 rooms");
    await press(screen, "inspect-clear-filters");
    expect(screen.queryByTestId("inspect-active-filters")).toBeNull();
    expect(shownRooms(screen)).toHaveLength(5);
  });

  it("chips have descriptive labels for screen readers", async () => {
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-floor-~|2"]);
    expect(screen.getByTestId("inspect-chip-floor:~|2").props.accessibilityLabel).toBe("Remove filter Floor 2");
  });

  it("filters and the count agree with search, from one snapshot", async () => {
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-floor-~|2", "inspect-filter-floor-~|3"]);
    await type(screen, "30");
    expect(shownRooms(screen).sort()).toEqual(["301", "302"]);
    expect(screen.getByTestId("inspect-result-count").props.children).toBe("Showing 2 of 5 rooms");
  });

  it("a filter that matches nothing says so, differently from an unavailable queue, and can be cleared", async () => {
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-floor-~|3", "inspect-filter-priority-overdue"]);
    expect(screen.getByText("No rooms match these filters")).toBeTruthy();
    expect(screen.queryByText("Unable to load inspections")).toBeNull();
    expect(screen.queryByText("All caught up")).toBeNull();
    await press(screen, "inspect-empty-filters-action");
    expect(shownRooms(screen)).toHaveLength(5);
  });

  it("persists when a room is opened and closed again", async () => {
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-floor-~|3"]);
    await press(screen, "queue-card-room-301");
    await settle();
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-301", from: "queue", roomNumber: "301" } });
    expect(screen.getByTestId("inspect-chip-floor:~|3")).toBeTruthy();
    expect(shownRooms(screen).sort()).toEqual(["301", "302"]);
  });

  it("applies to the To inspect list only: Corrections and Done are never filtered by it", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("105"), openCorrection("406")], truncated: false });
    mockRecords.mockResolvedValue([inspectionRecord("105"), inspectionRecord("406")]);
    mockHistoryPage.mockResolvedValue({ rows: [historyRow("105"), historyRow("406")], hasMore: false, nextCursor: null, total: 2 });
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-floor-~|3"]);
    await press(screen, "inspect-tab-corrections");
    expect(screen.queryByTestId("inspect-filter-button")).toBeNull();
    expect(screen.queryByTestId("inspect-active-filters")).toBeNull();
    expect(screen.queryAllByTestId(/^correction-card-room-/)).toHaveLength(2);
    await press(screen, "inspect-tab-done");
    expect(mockHistoryPage).toHaveBeenLastCalledWith(expect.not.objectContaining({ floors: expect.anything() }));
    expect(screen.queryAllByTestId(/^done-row-/)).toHaveLength(2);
    await press(screen, "inspect-tab-queue");
    expect(screen.getByTestId("inspect-chip-floor:~|3")).toBeTruthy();
    expect(shownRooms(screen).sort()).toEqual(["301", "302"]);
  });

  it("a filter whose data disappears is flagged instead of silently dropped", async () => {
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-priority-vip"]);
    mockQueue.mockResolvedValue([room("201", { vip: undefined, arrival_at: undefined })]);
    await press(screen, "inspect-refresh");
    await settle();
    expect(screen.getByTestId("inspect-filter-ignored")).toBeTruthy();
    expect(screen.getByTestId("inspect-chip-priority:vip")).toBeTruthy();
    expect(shownRooms(screen)).toEqual(["201"]); // not hidden by a filter that cannot be evaluated
  });

  it("a floor chosen earlier stays visible even after its rooms leave, so it can be removed", async () => {
    const screen = renderScreen();
    await settle();
    await apply(screen, ["inspect-filter-floor-~|3"]);
    mockQueue.mockResolvedValue([room("201")]);
    await press(screen, "inspect-refresh");
    await settle();
    expect(screen.getByText("No rooms match these filters")).toBeTruthy();
    await press(screen, "inspect-filter-button");
    expect(screen.getByTestId("inspect-filter-floor-~|3").props.accessibilityState).toMatchObject({ checked: true });
  });
});

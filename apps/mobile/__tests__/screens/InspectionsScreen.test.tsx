import React from "react";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

/* ─── Harness ───────────────────────────────────────────────────────────────
   The real screen, hook, models and components; only the network, router, translator and realtime channel are
   replaced. `router.setParams` really updates the params the screen reads, so a tapped card goes through the same
   path as a Room Board link. */

let mockParams: Record<string, string | undefined> = {};
const mockParamListeners = new Set<() => void>();
const mockSetParams = jest.fn((next: Record<string, string | undefined>) => {
  mockParams = Object.fromEntries(Object.entries({ ...mockParams, ...next }).filter(([, value]) => value !== undefined));
  mockParamListeners.forEach((listener) => listener());
});
let mockLanguage: "en" | "es" = "en";
let mockScheme: "light" | "dark" = "light";

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
  const english = translator("en");
  const spanish = translator("es");
  const i18n = { get language() { return mockLanguage; } };
  return { useTranslation: () => ({ t: mockLanguage === "es" ? spanish : english, i18n }) };
});
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
const mockSubscribe = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({ subscribeSupervisorRealtime: (...args: unknown[]) => mockSubscribe(...args), pokeSupervisorRealtime: jest.fn() }));
jest.setTimeout(30000); // the first render loads the whole screen graph
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
  fetchCorrectionOwners: jest.fn(),
  reassignCorrection: jest.fn(),
  escalateCorrection: jest.fn(),
  requestCorrectionAgain: jest.fn(),
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({ triggerReclean: jest.fn() }));

import { router } from "expo-router";
import { fetchInspectionDetail, fetchInspectionRecords, fetchOpenCorrections, listInspectionTemplates, submitInspection } from "@/lib/api/inspections";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider, ToastViewport } from "@/lib/theme/ToastProvider";
import { useAppStore } from "@/stores/appStore";
import InspectScreen from "@/app/(app)/inspect";
import { inspectionRecord, openCorrection, rawTemplate, readyRoom } from "../helpers/inspectionFixtures";

const NOW = Date.parse("2026-10-20T18:00:00Z"); // 1:00 PM in Chicago
const mockCorrections = fetchOpenCorrections as jest.Mock;
const mockRecords = fetchInspectionRecords as jest.Mock;
const mockTemplates = listInspectionTemplates as jest.Mock;
const mockDetail = fetchInspectionDetail as jest.Mock;
const mockSubmit = submitInspection as jest.Mock;
const push = router.push as jest.Mock;
const en = makeTranslator("en");
const es = makeTranslator("es");

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
async function settle() {
  await flush();
  await flush();
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ToastViewport topOffset={0} />
        <InspectScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

const standard = rawTemplate("t1", { is_default: true, room_type_id: null });
const room = (n: string, over = {}) => readyRoom(`room-${n}`, { room_number: n, floor: Number(n[0]), cleaned_at: "2026-10-20T17:42:00.000Z", clean_type: "DEP", ...over });
const text = (screen: ReturnType<typeof renderScreen>, id: string) => (screen.getByTestId(id).props.children as string | string[]);
const metric = (screen: ReturnType<typeof renderScreen>, key: string) => String(text(screen, `inspect-metric-${key}-value`));

let dateNow: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockLanguage = "en";
  mockScheme = "light";
  dateNow = jest.spyOn(Date, "now").mockReturnValue(NOW);
  mockQueue.mockResolvedValue([room("203"), room("103")]);
  mockTemplates.mockResolvedValue({ data: [standard] });
  mockCorrections.mockResolvedValue({ rows: [], truncated: false });
  mockRecords.mockResolvedValue([]);
  mockSubscribe.mockImplementation(() => jest.fn());
  useAppStore.setState({
    hotelTimezone: "America/Chicago",
    isOnline: true,
    user: { id: "sup-1", tenant_id: "hotel-1", role: "housekeeping_supervisor" } as never,
  });
});
afterEach(() => dateNow.mockRestore());

describe("header and verified counts", () => {
  it("shows the compact header, an honest Live line, and counts that come from the server", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305"), openCorrection("306", { status: "resubmitted" })], truncated: false });
    mockRecords.mockResolvedValue([inspectionRecord("401"), inspectionRecord("402", { overall_result: "failed" }), inspectionRecord("403")]);
    const screen = renderScreen();
    await settle();
    expect(screen.getByText("HOUSEKEEPING · TODAY")).toBeTruthy();
    expect(screen.getByText("Inspections")).toBeTruthy();
    expect(text(screen, "inspect-status-text")).toBe("Live · Updated just now");
    expect(metric(screen, "waiting")).toBe("2");
    expect(metric(screen, "corrections")).toBe("2");
    expect(metric(screen, "passed")).toBe("2"); // two passes of three records; the fail is not counted
  });

  it("an unverified count is an em dash, never a misleading zero, and the other counts still show", async () => {
    mockCorrections.mockRejectedValue(new Error("boom"));
    mockRecords.mockRejectedValue(new Error("boom"));
    const screen = renderScreen();
    await settle();
    expect(metric(screen, "waiting")).toBe("2");
    expect(metric(screen, "corrections")).toBe("—");
    expect(metric(screen, "passed")).toBe("—");
    expect(screen.getByTestId("inspect-metric-corrections").props.accessibilityLabel).toBe("Corrections: unavailable");
  });

  it("a verified zero is a real zero", async () => {
    mockQueue.mockResolvedValue([]);
    const screen = renderScreen();
    await settle();
    expect(metric(screen, "waiting")).toBe("0");
    expect(metric(screen, "corrections")).toBe("0");
    expect(metric(screen, "passed")).toBe("0");
  });

  it("counts a correction once however many failed items it has, and drops closed ones", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305", { failed_count: 9 }), openCorrection("306", { status: "verified" })], truncated: false });
    const screen = renderScreen();
    await settle();
    expect(metric(screen, "corrections")).toBe("1");
  });

  it("a truncated corrections list is shown as a lower bound", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305")], truncated: true });
    const screen = renderScreen();
    await settle();
    expect(metric(screen, "corrections")).toBe("1+");
  });

  it("the Refresh button reloads every source", async () => {
    const screen = renderScreen();
    await settle();
    mockQueue.mockClear();
    mockCorrections.mockClear();
    mockRecords.mockClear();
    await act(async () => fireEvent.press(screen.getByTestId("inspect-refresh")));
    await settle();
    expect(mockQueue).toHaveBeenCalledTimes(1);
    expect(mockCorrections).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveBeenCalledTimes(1);
  });

  it("asks for the hotel's business date, not the phone's", async () => {
    dateNow.mockReturnValue(Date.parse("2026-10-17T02:30:00Z")); // still the 16th in Chicago
    renderScreen();
    await settle();
    expect(mockQueue).toHaveBeenCalledWith("2026-10-16");
    expect(mockRecords).toHaveBeenCalledWith("2026-10-16");
  });
});

describe("not live when it cannot be shown to be", () => {
  it("offline with cached rooms keeps them visible, labelled, and says what needs a connection", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => useAppStore.setState({ isOnline: false }));
    await settle();
    expect(screen.getByTestId("queue-card-room-203")).toBeTruthy();
    expect(String(text(screen, "inspect-status-text"))).toMatch(/^Offline · Last checked /);
    expect(String(text(screen, "inspect-status-text"))).not.toMatch(/live/i);
    expect(within(screen.getByTestId("inspect-stale-banner")).getByText(/Starting an inspection needs a connection/)).toBeTruthy();
  });

  it("starting an inspection from stale data is refused with an explanation, and nothing is opened", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => useAppStore.setState({ isOnline: false }));
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("queue-card-room-203")));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(en("inspect.start.needsConnection"))).toBeTruthy();
  });

  it("no verified data at all: Unable to load, with Try again, and never All caught up", async () => {
    mockQueue.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const screen = renderScreen();
    await settle();
    expect(screen.getByText("Unable to load inspections")).toBeTruthy();
    expect(screen.queryByText("All caught up")).toBeNull();
    expect(text(screen, "inspect-status-text")).toBe("Unable to check the queue");
    expect(metric(screen, "waiting")).toBe("—");
    mockQueue.mockResolvedValue([room("203")]);
    await act(async () => fireEvent.press(screen.getByTestId("inspect-error-action")));
    await settle();
    expect(screen.getByTestId("queue-card-room-203")).toBeTruthy();
  });

  it("shows placeholders, not counts or an empty message, while the first answer is on its way", async () => {
    mockQueue.mockReturnValue(new Promise(() => undefined));
    const screen = renderScreen();
    await flush();
    expect(screen.getByTestId("inspect-skeleton")).toBeTruthy();
    expect(metric(screen, "waiting")).toBe("—");
    expect(screen.queryByText("All caught up")).toBeNull();
  });

  it("a verified empty queue is All caught up", async () => {
    mockQueue.mockResolvedValue([]);
    const screen = renderScreen();
    await settle();
    expect(screen.getByText("All caught up")).toBeTruthy();
    expect(screen.getByText("No rooms are currently awaiting inspection.")).toBeTruthy();
  });

  it("a failed refresh keeps the last rooms on screen with a banner", async () => {
    const screen = renderScreen();
    await settle();
    mockQueue.mockRejectedValue(new Error("down"));
    await act(async () => fireEvent.press(screen.getByTestId("inspect-refresh")));
    await settle();
    expect(screen.getByTestId("queue-card-room-203")).toBeTruthy();
    expect(within(screen.getByTestId("inspect-stale-banner")).getByText(/Couldn't refresh/)).toBeTruthy();
  });
});

describe("tabs", () => {
  it("defaults to To inspect and announces the selected tab and the counts", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305")], truncated: false });
    mockRecords.mockResolvedValue([inspectionRecord("401")]);
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("inspect-tab-queue").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("inspect-tab-corrections").props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId("inspect-tab-queue").props.accessibilityLabel).toBe("To inspect, 2");
    expect(screen.getByTestId("inspect-tab-corrections").props.accessibilityLabel).toBe("Corrections, 1");
    expect(screen.getByTestId("inspect-tab-done").props.accessibilityLabel).toBe("Done, 1");
  });

  it("an unknown count is announced as unavailable, not zero", async () => {
    mockCorrections.mockRejectedValue(new Error("boom"));
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("inspect-tab-corrections").props.accessibilityLabel).toBe("Corrections, count unavailable");
  });

  it("switching tabs changes the list and the selected state", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305")], truncated: false });
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("inspect-tab-corrections")));
    expect(screen.getByTestId("inspect-tab-corrections").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("correction-card-room-305")).toBeTruthy();
    expect(screen.queryByTestId("queue-card-room-203")).toBeNull();
  });
});

describe("queue cards", () => {
  it("shows the room, where it is, who cleaned it and for how long, with one obvious text action", async () => {
    mockQueue.mockResolvedValue([room("205", { cleaned_by: "Maria S.", cleaned_at: "2026-10-20T17:42:00.000Z", clean_type: "DEP", arrival_at: "2026-10-20T19:00:00Z" })]);
    const screen = renderScreen();
    await settle();
    const card = within(screen.getByTestId("queue-card-room-205"));
    expect(card.getByText("205")).toBeTruthy();
    expect(card.getByText("Departure · Floor 2")).toBeTruthy();
    expect(card.getByText("Maria S. · Cleaned 18 min ago")).toBeTruthy();
    expect(card.getByText("Arrival 2:00 PM")).toBeTruthy();
    expect(card.getByText("Arrival priority")).toBeTruthy();
    expect(card.getByText("Start inspection")).toBeTruthy();
  });

  it("offers no pass, touch-up or fail shortcut on the queue", async () => {
    const screen = renderScreen();
    await settle();
    expect(screen.queryAllByLabelText("Confirm Pass")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Confirm Fail")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Confirm Touch-up")).toHaveLength(0);
  });

  it("a reinspection says so and never claims the original failures are fixed", async () => {
    mockQueue.mockResolvedValue([
      room("312", {
        cleaned_by: "Carlos M.",
        clean_type: "FULL",
        previous_failure: {
          inspection_id: "i-1",
          inspected_at: null,
          overall_result: "failed",
          notes: null,
          correction_kind: "reclean",
          items: [{ id: "a", label: "Mirror", note: null }, { id: "b", label: "Floor", note: null }],
        },
      }),
    ]);
    const screen = renderScreen();
    await settle();
    const card = within(screen.getByTestId("queue-card-room-312"));
    expect(card.getByText("Reinspection")).toBeTruthy();
    expect(card.getByText("Reinspect room")).toBeTruthy();
    expect(card.getByText("2 original failed items")).toBeTruthy();
    expect(card.getByText(/Carlos M\. · Resubmitted/)).toBeTruthy();
    expect(card.queryByText(/fixed/i)).toBeNull();
  });

  it("an unnamed housekeeper and an unknown clean time are called not recorded", async () => {
    mockQueue.mockResolvedValue([room("207", { cleaned_by: "", cleaned_at: null, clean_type: null })]);
    const screen = renderScreen();
    await settle();
    expect(within(screen.getByTestId("queue-card-room-207")).getByText("Housekeeper not recorded · Clean time not recorded")).toBeTruthy();
  });

  it("tapping a card opens THAT room by its id, not its number", async () => {
    mockQueue.mockResolvedValue([
      room("101", { room_id: "tower-a-101", building: "A" }),
      room("101", { room_id: "tower-b-101", building: "B" }),
    ]);
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("queue-card-tower-b-101")));
    // the stable id travels to the active inspection; the number is only a label
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "tower-b-101", from: "queue", roomNumber: "101" } });
    // this screen stays as it was: both towers' room 101 are still listed
    expect(screen.getByTestId("queue-card-tower-a-101")).toBeTruthy();
    expect(screen.getByTestId("queue-card-tower-b-101")).toBeTruthy();
  });

  it("opening a room sends nothing", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("queue-card-room-203")));
    await settle();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("an older room link is handed to the active inspection by its id, whatever the label says", async () => {
    mockParams = { roomId: "room-103", roomNumber: "999" };
    renderScreen();
    await settle();
    // cleared from THIS screen first, so it cannot fire twice, then opened in the workspace
    expect(mockSetParams).toHaveBeenCalledWith({ roomId: undefined, roomNumber: undefined });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-103", from: "queue", roomNumber: "999" } });
    expect(mockSetParams.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]);
  });

  it("a link naming a room that is not queued is still only handed on: the workspace explains, this screen never judges it", async () => {
    mockParams = { roomId: "room-555", roomNumber: "555" };
    renderScreen();
    await settle();
    expect(push).toHaveBeenCalledWith({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-555", from: "queue", roomNumber: "555" } });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("a room whose checklist cannot be used stays visible, says why on the card and on tap, and opens nothing", async () => {
    mockTemplates.mockResolvedValue({ data: [rawTemplate("t1", { is_default: true, is_active: false })] });
    const screen = renderScreen();
    await settle();
    const card = within(screen.getByTestId("queue-card-room-203"));
    expect(card.getByText("Checklist unavailable")).toBeTruthy();
    expect(card.getByText("203")).toBeTruthy();
    // the reason is on the card itself, before anyone taps
    expect(screen.getByTestId("queue-card-blocked-room-203").props.children).toBe(en("inspect.template.no_usable_template"));
    await act(async () => fireEvent.press(screen.getByTestId("queue-card-room-203")));
    expect(screen.getAllByText(en("inspect.template.no_usable_template")).length).toBeGreaterThanOrEqual(2); // card + toast
    expect(push).not.toHaveBeenCalled();
  });

  it("orders by priority: an overdue arrival, then an elevated priority, then the rest by wait", async () => {
    mockQueue.mockResolvedValue([
      room("101", { cleaned_at: "2026-10-20T15:00:00.000Z" }),
      room("102", { priority: 1 }),
      room("103", { arrival_at: "2026-10-20T16:00:00Z" }),
    ]);
    const screen = renderScreen();
    await settle();
    const order = screen.getAllByTestId(/^queue-card-room-/).map((node) => node.props.testID);
    expect(order).toEqual(["queue-card-room-103", "queue-card-room-102", "queue-card-room-101"]);
  });
});

describe("corrections tab", () => {
  const open = (tab = true) => async (screen: ReturnType<typeof renderScreen>) => {
    if (tab) await act(async () => fireEvent.press(screen.getByTestId("inspect-tab-corrections")));
  };

  it("lists each correction with its verified status, real owner and failed items", async () => {
    mockCorrections.mockResolvedValue({
      rows: [
        openCorrection("305"),
        openCorrection("306", { status: "unassigned", task: { id: "t", status: "open", assigned_to: null, assigned_name: null, due_at: null, started_at: null, completed_at: null } }),
        openCorrection("307", { status: "resubmitted" }),
      ],
      truncated: false,
    });
    const screen = renderScreen();
    await settle();
    await open()(screen);
    const text305 = within(screen.getByTestId("correction-card-room-305"));
    expect(text305.getByText("With housekeeper")).toBeTruthy();
    expect(text305.getByText(/Owner: Hana/)).toBeTruthy();
    expect(text305.getByText(/Mirror streaked, Floor not vacuumed/)).toBeTruthy();
    expect(within(screen.getByTestId("correction-card-room-306")).getByText("Needs action")).toBeTruthy();
    expect(within(screen.getByTestId("correction-card-room-306")).getByText(/Unassigned/)).toBeTruthy();
    expect(within(screen.getByTestId("correction-card-room-307")).getByText("Ready for reinspection")).toBeTruthy();
  });

  it("puts what needs the supervisor first", async () => {
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305"), openCorrection("306", { status: "resubmitted" }), openCorrection("307", { status: "escalated" })], truncated: false });
    const screen = renderScreen();
    await settle();
    await open()(screen);
    expect(screen.getAllByTestId(/^correction-card-room-/).map((n) => n.props.testID)).toEqual([
      "correction-card-room-307",
      "correction-card-room-306",
      "correction-card-room-305",
    ]);
  });

  it("a room that is back in the verified queue can be reinspected; one still with the housekeeper opens its correction", async () => {
    mockQueue.mockResolvedValue([room("307")]);
    mockCorrections.mockResolvedValue({ rows: [openCorrection("307", { status: "resubmitted" }), openCorrection("305")], truncated: false });
    const screen = renderScreen();
    await settle();
    await open()(screen);
    expect(within(screen.getByTestId("correction-card-room-307")).getByText("Start reinspection")).toBeTruthy();
    expect(within(screen.getByTestId("correction-card-room-305")).getByText("View correction")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("correction-action-room-305")));
    expect(screen.getByTestId("correction-sheet")).toBeTruthy(); // the correction opens in its drawer; no navigation
    expect(push).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId("correction-action-room-307")));
    expect(push).toHaveBeenCalledWith({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-307", from: "queue", roomNumber: "307" } });
  });

  it("resubmitted but not in the queue (state moved on) is not offered for reinspection", async () => {
    mockQueue.mockResolvedValue([]);
    mockCorrections.mockResolvedValue({ rows: [openCorrection("307", { status: "resubmitted" })], truncated: false });
    const screen = renderScreen();
    await settle();
    await open()(screen);
    expect(within(screen.getByTestId("correction-card-room-307")).getByText("View correction")).toBeTruthy();
    expect(within(screen.getByTestId("correction-card-room-307")).queryByText("Start reinspection")).toBeNull();
  });

  it("has its own empty and error states", async () => {
    const screen = renderScreen();
    await settle();
    await open()(screen);
    expect(screen.getByText("No corrections outstanding")).toBeTruthy();
    mockCorrections.mockRejectedValue(new Error("boom"));
    mockCorrections.mockClear();
  });

  it("a failed corrections load says so and retries; it does not claim there are none", async () => {
    mockCorrections.mockRejectedValue(new Error("boom"));
    const screen = renderScreen();
    await settle();
    await open()(screen);
    expect(screen.getByText("Unable to load corrections")).toBeTruthy();
    expect(screen.queryByText("No corrections outstanding")).toBeNull();
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305")], truncated: false });
    await act(async () => fireEvent.press(screen.getByTestId("inspect-error-action")));
    await settle();
    expect(screen.getByTestId("correction-card-room-305")).toBeTruthy();
  });
});

describe("done tab", () => {
  const openDone = async (screen: ReturnType<typeof renderScreen>) => act(async () => fireEvent.press(screen.getByTestId("inspect-tab-done")));

  it("shows the room, the inspector, the time and the result in words", async () => {
    mockRecords.mockResolvedValue([
      inspectionRecord("401"),
      inspectionRecord("402", { overall_result: "failed", completed_at: "2026-10-20T17:00:00.000Z" }),
      inspectionRecord("403", { overall_result: "conditional", completed_at: "2026-10-20T15:00:00.000Z" }),
      inspectionRecord("404", { reinspection_of: "insp-1", completed_at: "2026-10-20T14:00:00.000Z" }),
    ]);
    const screen = renderScreen();
    await settle();
    await openDone(screen);
    expect(within(screen.getByTestId("done-row-401")).getByText("Passed")).toBeTruthy();
    expect(within(screen.getByTestId("done-row-402")).getByText("Failed")).toBeTruthy();
    expect(within(screen.getByTestId("done-row-403")).getByText("Conditional")).toBeTruthy();
    expect(within(screen.getByTestId("done-row-401")).getByText("Sam Supervisor")).toBeTruthy();
    expect(within(screen.getByTestId("done-row-401")).getByText("11:00 AM")).toBeTruthy();
    expect(within(screen.getByTestId("done-row-404")).getByText(/Reinspection/)).toBeTruthy();
    expect(within(screen.getByTestId("done-row-401")).queryByText(/Reinspection/)).toBeNull();
  });

  it("never shows part of an id as an inspector name", async () => {
    mockRecords.mockResolvedValue([inspectionRecord("401", { inspector_display_name: null, inspector_name: "a1b2c3d4" })]);
    const screen = renderScreen();
    await settle();
    await openDone(screen);
    expect(screen.getByText("Inspector not recorded")).toBeTruthy();
    expect(screen.queryByText(/a1b2c3d4/)).toBeNull();
  });

  it("opens what the server records about an inspection, including its failed items", async () => {
    mockRecords.mockResolvedValue([inspectionRecord("402", { overall_result: "failed", notes: "Bathroom" })]);
    mockDetail.mockResolvedValue({
      id: "402",
      room_id: "room-402",
      overall_result: "failed",
      items: [
        { template_item_id: "a", description: "Mirror streaked", result: "fail", note: null },
        { template_item_id: "b", description: "Bed made", result: "pass", note: null },
      ],
      correction: { status: "assigned", reinspection_id: null, kind: "reclean", task: null },
    });
    const screen = renderScreen();
    await settle();
    await openDone(screen);
    await act(async () => fireEvent.press(screen.getByTestId("done-row-402")));
    await settle();
    expect(mockDetail).toHaveBeenCalledWith("402");
    const sheet = within(screen.getByTestId("inspect-record-sheet"));
    expect(sheet.getByText("Room 402 Inspection")).toBeTruthy();
    expect(sheet.getByText("Bathroom")).toBeTruthy();
    expect(sheet.getByText("• Mirror streaked")).toBeTruthy();
    expect(sheet.queryByText("• Bed made")).toBeNull();
    expect(sheet.getByText("Assigned, not started")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("inspect-record-view-room")));
    expect(push).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-402" } });
  });

  it("if the details cannot be loaded the sheet still shows what the list knew, and offers a retry", async () => {
    mockRecords.mockResolvedValue([inspectionRecord("402", { overall_result: "failed" })]);
    mockDetail.mockRejectedValueOnce(new Error("boom"));
    const screen = renderScreen();
    await settle();
    await openDone(screen);
    await act(async () => fireEvent.press(screen.getByTestId("done-row-402")));
    await settle();
    const sheet = within(screen.getByTestId("inspect-record-sheet"));
    expect(sheet.getByText("Couldn't load the inspection details.")).toBeTruthy();
    expect(sheet.getByText("Sam Supervisor")).toBeTruthy();
    mockDetail.mockResolvedValue({ id: "402", room_id: "room-402", overall_result: "failed", items: [], correction: null });
    await act(async () => fireEvent.press(sheet.getByText("Try again")));
    await settle();
    expect(within(screen.getByTestId("inspect-record-sheet")).getByText("No failed items were recorded.")).toBeTruthy();
  });

  it("has empty and error states of its own", async () => {
    const screen = renderScreen();
    await settle();
    await openDone(screen);
    expect(screen.getByText("No inspections completed today")).toBeTruthy();
    mockRecords.mockRejectedValue(new Error("boom"));
    await act(async () => fireEvent.press(screen.getByTestId("inspect-refresh")));
    await settle();
    // the verified (empty) answer is kept, but flagged
    expect(screen.getByTestId("inspect-stale-banner")).toBeTruthy();
  });
});

describe("hotel and account switching", () => {
  it("drops the old hotel's rooms, view state and focus, and ignores a late reply", async () => {
    let releaseOld: (rooms: unknown[]) => void = () => undefined;
    mockQueue.mockReturnValueOnce(new Promise((resolve) => { releaseOld = resolve; }));
    const screen = renderScreen();
    await flush();
    mockQueue.mockResolvedValue([room("900")]);
    await act(async () => useAppStore.setState({ user: { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" } as never }));
    await settle();
    await act(async () => releaseOld([room("101")])); // hotel-1's answer arrives late
    await settle();
    expect(screen.queryByTestId("queue-card-room-101")).toBeNull();
    expect(screen.getByTestId("queue-card-room-900")).toBeTruthy();
  });

  it("clears search and filters, and any link still on this screen, when the hotel changes", async () => {
    const screen = renderScreen();
    await settle();
    fireEvent.changeText(screen.getByTestId("inspect-search"), "20");
    await act(async () => fireEvent.press(screen.getByTestId("inspect-filter-button")));
    await act(async () => fireEvent.press(screen.getByTestId("inspect-filter-floor-~|2")));
    await act(async () => fireEvent.press(screen.getByTestId("inspect-filter-apply")));
    expect(screen.getByTestId("inspect-active-filters")).toBeTruthy();
    mockQueue.mockResolvedValue([room("900")]);
    await act(async () => useAppStore.setState({ user: { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" } as never }));
    await settle();
    expect(screen.queryByTestId("inspect-active-filters")).toBeNull();
    expect(screen.getByTestId("inspect-search").props.value).toBe("");
    expect(mockSetParams).toHaveBeenCalledWith({ roomId: undefined, roomNumber: undefined });
    expect(screen.getByTestId("queue-card-room-900")).toBeTruthy();
  });
});

describe("realtime", () => {
  it("joins the shared channel for the signed-in hotel and refreshes every list on a room change", async () => {
    renderScreen();
    await settle();
    expect(mockSubscribe).toHaveBeenCalledWith("hotel-1", expect.any(Function), { independent: true });
    mockQueue.mockClear();
    mockCorrections.mockClear();
    mockRecords.mockClear();
    await act(async () => {
      (mockSubscribe.mock.calls[0][1] as () => void)();
    });
    await settle();
    expect(mockQueue).toHaveBeenCalledTimes(1);
    expect(mockCorrections).toHaveBeenCalledTimes(1);
    expect(mockRecords).toHaveBeenCalledTimes(1);
  });

  it("a room approved elsewhere leaves the queue and joins the Passed count after the refresh", async () => {
    const screen = renderScreen();
    await settle();
    expect(metric(screen, "waiting")).toBe("2");
    mockQueue.mockResolvedValue([room("103")]);
    mockRecords.mockResolvedValue([inspectionRecord("203")]);
    await act(async () => {
      (mockSubscribe.mock.calls[0][1] as () => void)();
    });
    await settle();
    expect(metric(screen, "waiting")).toBe("1");
    expect(metric(screen, "passed")).toBe("1");
    expect(screen.queryByTestId("queue-card-room-203")).toBeNull();
  });
});

describe("Spanish and dark mode", () => {
  it("renders real Spanish, never a raw key", async () => {
    mockLanguage = "es";
    mockCorrections.mockResolvedValue({ rows: [openCorrection("305")], truncated: false });
    mockRecords.mockResolvedValue([inspectionRecord("401", { inspector_display_name: null })]);
    const screen = renderScreen();
    await settle();
    expect(screen.getByText("LIMPIEZA · HOY")).toBeTruthy();
    expect(text(screen, "inspect-status-text")).toBe("En vivo · Actualizado ahora");
    expect(within(screen.getByTestId("queue-card-room-203")).getByText("Iniciar inspección")).toBeTruthy();
    expect(screen.getByTestId("inspect-tab-queue").props.accessibilityLabel).toBe("Por inspeccionar, 2");
    await act(async () => fireEvent.press(screen.getByTestId("inspect-tab-corrections")));
    expect(within(screen.getByTestId("correction-card-room-305")).getByText("Con la camarista")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("inspect-tab-done")));
    expect(screen.getByText(es("inspect.done.inspectorUnknown"))).toBeTruthy();
    expect(screen.queryAllByText(/^inspect\.[A-Za-z]/)).toHaveLength(0);
  });

  it("renders in dark mode with the same content", async () => {
    mockScheme = "dark";
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("queue-card-room-203")).toBeTruthy();
    expect(screen.getAllByText("Start inspection")).toHaveLength(2);
    expect(metric(screen, "waiting")).toBe("2");
  });
});

describe("a large hotel", () => {
  it("virtualises: hundreds of rooms do not all mount, and the count still says how many wait", async () => {
    mockQueue.mockResolvedValue(Array.from({ length: 400 }, (_, n) => room(String(100 + n), { floor: 1 + (n % 9) })));
    const screen = renderScreen();
    await settle();
    expect(metric(screen, "waiting")).toBe("400");
    expect(screen.getAllByTestId(/^queue-card-room-/).length).toBeLessThan(60);
  });
});

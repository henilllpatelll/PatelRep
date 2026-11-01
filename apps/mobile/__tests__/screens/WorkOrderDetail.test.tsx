import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockRouter = { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ woId: "wo-1" }),
  // Delegates at call time: the const above is not initialised yet when the factory first runs.
  router: {
    back: (...args: unknown[]) => mockRouter.back(...args),
    canGoBack: () => mockRouter.canGoBack(),
    replace: (...args: unknown[]) => mockRouter.replace(...args),
    push: (...args: unknown[]) => mockRouter.push(...args),
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => {
      if (k === "workOrders.roomOccupancy.occupied") return "Occupied";
      if (k === "workOrders.roomOccupancy.vacant") return "Vacant";
      return o?.defaultValue === "" ? k : k;
    },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/housekeeping/photo", () => ({
  pickPhoto: jest.fn(),
  prepareForUpload: jest.fn(async (uri: string) => uri),
}));
jest.mock("@/lib/api/workOrders", () => ({
  getWorkOrder: jest.fn(),
  getWorkOrderLabor: jest.fn(),
  getWorkOrderEvents: jest.fn(),
  getWorkOrderAudit: jest.fn(),
  getWorkOrderParts: jest.fn(),
  getWorkOrderChecklist: jest.fn(),
  setWorkOrderChecklistItem: jest.fn(),
  listAssetRepairs: jest.fn(),
  listRepairCodes: jest.fn(),
  listInventoryParts: jest.fn(),
  getPartStock: jest.fn(),
  claimWorkOrder: jest.fn(),
  completeWorkOrder: jest.fn(),
  transitionWorkOrder: jest.fn(),
  addWorkOrderComment: jest.fn(),
  uploadWorkOrderPhoto: jest.fn(),
  arriveAtWorkOrder: jest.fn(),
  acknowledgeWorkOrder: jest.fn(),
  startWorkOrderLabor: jest.fn(),
  pauseWorkOrderLabor: jest.fn(),
  saveDiagnosis: jest.fn(),
  workOrderPhotoUrl: jest.fn().mockReturnValue(null),
}));
let mockUser: Record<string, unknown> = { id: "u1", role: "engineer", language_pref: "en", full_name: "Eli Park" };
let mockOnline = true;
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: mockOnline, user: mockUser }),
}));
const mockToast = { error: jest.fn(), success: jest.fn(), info: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
  getPendingSyncQueue: jest.fn().mockResolvedValue([]),
}));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import * as api from "@/lib/api/workOrders";
import { enqueueAction, getPendingSyncQueue } from "@/lib/offline/db";
import WorkOrderDetailScreen from "@/app/(app)/work-orders/[woId]";

const m = (fn: unknown) => fn as jest.Mock;

const baseOrder = (over: Record<string, unknown> = {}) => ({
  id: "wo-1",
  work_order_number: 1042,
  title: "Fix AC",
  description: "Room is not cooling; guest called twice.",
  status: "in_progress",
  priority: "urgent",
  category: "hvac",
  room_id: "room-101",
  rooms: { room_number: "101", floor: 1 },
  room_context: { occupancy: "occupied", availability: null },
  assigned_to: "u1",
  created_at: "2026-10-31T09:00:00Z",
  acknowledged_at: null,
  arrived_at: null,
  asset_id: null,
  assets: null,
  work_order_photos: [],
  work_order_comments: [],
  ...over,
});

const clItem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  label: `Step ${id}`,
  is_required: false,
  is_done: false,
  done_by: null,
  done_at: null,
  sort_order: Number(id.replace(/\D/g, "")),
  estimated_minutes: null,
  ...over,
});
const clSummary = (items: ReturnType<typeof clItem>[]) => {
  const remaining = items.filter((i) => i.is_required && !i.is_done).map((i) => ({ id: i.id, label: i.label }));
  return { total: items.length, completed: items.filter((i) => i.is_done).length, required_total: items.filter((i) => i.is_required).length, required_completed: 0, required_remaining: remaining, ready: remaining.length === 0 };
};
const clSnapshot = (items: ReturnType<typeof clItem>[], editable = true) => ({ items, summary: clSummary(items), editable });

const codes = [
  { id: "res-1", code_type: "resolution", code: "replaced_part", label: "Replaced part", engineering_category: "hvac" },
  { id: "res-9", code_type: "resolution", code: "other_resolution", label: "Other", engineering_category: null },
  { id: "pro-1", code_type: "problem", code: "no_cooling", label: "No cooling", engineering_category: "hvac" },
];

function renderScreen() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <WorkOrderDetailScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** The detail screen is tabbed; tools live on Work and the timeline on History. */
const openTab = async (getByTestId: (id: string) => unknown, tab: "overview" | "checklist" | "work" | "history") => {
  await waitFor(() => expect(getByTestId(`wo-tab-${tab}`)).toBeTruthy());
  fireEvent.press(getByTestId(`wo-tab-${tab}`) as never);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "u1", role: "engineer", language_pref: "en", full_name: "Eli Park" };
  mockOnline = true;
  m(api.getWorkOrder).mockResolvedValue(baseOrder());
  m(api.getWorkOrderLabor).mockResolvedValue([]);
  m(api.getWorkOrderEvents).mockResolvedValue([]);
  m(api.getWorkOrderAudit).mockResolvedValue([]);
  m(api.getWorkOrderParts).mockResolvedValue([]);
  m(api.listAssetRepairs).mockResolvedValue([]);
  m(api.listRepairCodes).mockResolvedValue(codes);
  m(api.getWorkOrderChecklist).mockResolvedValue(clSnapshot([]));
  m(api.completeWorkOrder).mockResolvedValue({});
  m(api.transitionWorkOrder).mockResolvedValue(undefined);
  m(api.startWorkOrderLabor).mockResolvedValue(undefined);
  m(api.pauseWorkOrderLabor).mockResolvedValue(undefined);
  m(api.arriveAtWorkOrder).mockResolvedValue(undefined);
  m(api.claimWorkOrder).mockResolvedValue(null);
  m(getPendingSyncQueue).mockResolvedValue([]);
});

const runningSession = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  work_order_id: "wo-1",
  staff_user_id: "u1",
  started_at: new Date(Date.now() - 24 * 60_000).toISOString(),
  ended_at: null,
  duration_minutes: null,
  ...over,
});

describe("header and reported problem", () => {
  it("shows the number, priority and status, and the full original request", async () => {
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-number")).toBeTruthy());
    expect(getByTestId("wo-number").props.children).toBe("WO-1042");
    expect(getByTestId("wo-status-line").props.children).toBe("WORKORDERS.REPAIR.PRIORITY.URGENT · WORKORDERS.STATUS.IN_PROGRESS");
    expect(getByTestId("wo-description").props.children).toBe("Room is not cooling; guest called twice.");
    await waitFor(() => expect(getByText(/Occupied/)).toBeTruthy());
  });

  it("opens Room Detail from the room named on the work order, by the room's canonical id", async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-open-room")).toBeTruthy());
    fireEvent.press(getByTestId("wo-open-room"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/(app)/room-status/[roomId]", params: { roomId: "room-101" } });
  });

  it("says 'no deadline' rather than inventing one, and shows no labor until the server has some", async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-due")).toBeTruthy());
    expect(getByTestId("wo-due").props.children).toBe("workOrders.repair.summary.noDeadline");
    expect(getByTestId("wo-labor-value").props.children).toBe("workOrders.repair.summary.noLabor");
  });

  it("shows the hold reason carried by the order", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "on_hold", hold_reason_code: "awaiting_parts", hold_reason_note: "Compressor ordered" }));
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-banner-hold")).toBeTruthy());
    expect(getByText(/workOrders\.holdReason\.awaiting_parts.*Compressor ordered/)).toBeTruthy();
  });
});

describe("who can do what", () => {
  it("offers Claim on an unassigned open order, and not the repair tools that need ownership", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "open", assigned_to: null }));
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-claim")).toBeTruthy());
    expect(queryByTestId("wo-review-completion")).toBeNull();
    expect(queryByTestId("wo-tool-arrive")).toBeNull();
  });

  it("claims through the API when online", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "open", assigned_to: null }));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-claim")).toBeTruthy());
    fireEvent.press(getByTestId("wo-claim"));
    await waitFor(() => expect(api.claimWorkOrder).toHaveBeenCalledWith("wo-1"));
  });

  it("offline, a claim is queued and the screen does not pretend it was confirmed", async () => {
    mockOnline = false;
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "open", assigned_to: null }));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-claim")).toBeTruthy());
    fireEvent.press(getByTestId("wo-claim"));
    await waitFor(() => expect(enqueueAction).toHaveBeenCalledWith("work_order", "claim", { label: "WO-1042" }, "wo-1", "WO-1042"));
    expect(api.claimWorkOrder).not.toHaveBeenCalled();
    expect(getByTestId("wo-banner-offline")).toBeTruthy();
  });

  it("gives a chief engineer a read-only view", async () => {
    mockUser = { id: "chief-1", role: "chief_engineer", language_pref: "en" };
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ assigned_to: "other" }));
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-view-only")).toBeTruthy());
    expect(queryByTestId("wo-action-bar")).toBeNull();
    expect(queryByTestId("wo-more")).toBeNull();
  });

  it("keeps another engineer's order read-only for an engineer", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ assigned_to: "someone-else" }));
    const { getByText, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByText("workOrders.claimedElsewhere")).toBeTruthy());
    expect(queryByTestId("wo-action-bar")).toBeNull();
  });

  it("shows a completed order as a read-only record", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "completed", verification_result: "passed", resolution_code: { id: "r", code: "x", label: "Replaced part" }, notes: "Swapped it" }));
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-record")).toBeTruthy());
    expect(queryByTestId("wo-action-bar")).toBeNull();
    expect(queryByTestId("wo-tool-arrive")).toBeNull();
  });

  it("shows a cancelled order with its context and no repair controls", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "cancelled" }));
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-banner-cancelled")).toBeTruthy());
    expect(queryByTestId("wo-action-bar")).toBeNull();
  });
});

describe("arrival and labor are structured server records", () => {
  it("arrival calls the arrive endpoint, never a comment, and shows the server's time afterwards", async () => {
    m(api.getWorkOrder).mockResolvedValueOnce(baseOrder()).mockResolvedValue(baseOrder({ arrived_at: "2026-10-31T09:15:00Z" }));
    const { getByTestId } = renderScreen();
    await openTab(getByTestId, "work");
    await waitFor(() => expect(getByTestId("wo-tool-arrive")).toBeTruthy());
    fireEvent.press(getByTestId("wo-tool-arrive"));
    await waitFor(() => expect(api.arriveAtWorkOrder).toHaveBeenCalledWith("wo-1"));
    expect(api.addWorkOrderComment).not.toHaveBeenCalled();
    await waitFor(() => expect(getByTestId("wo-tool-arrive").props.accessibilityLabel).toContain("workOrders.repair.tools.arrivedAt"));
    // Already arrived: the tile is no longer pressable, so it cannot be recorded twice.
    expect(getByTestId("wo-tool-arrive").props.accessibilityState.disabled).toBe(true);
  });

  it("starts labor from the action bar and re-reads the server's sessions", async () => {
    // A session the server has just started is only seconds old.
    m(api.getWorkOrderLabor).mockResolvedValueOnce([]).mockResolvedValue([runningSession({ started_at: new Date(Date.now() - 2000).toISOString() })]);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-toggle")).toBeTruthy());
    fireEvent.press(getByTestId("wo-labor-toggle"));
    await waitFor(() => expect(api.startWorkOrderLabor).toHaveBeenCalledWith("wo-1"));
    await waitFor(() => expect(getByTestId("wo-labor-value").props.children).toMatch(/^00:00:0\d$/));
  });

  it("a wrong phone clock does not corrupt a timer that was just started", async () => {
    // The phone is 10 minutes slow, so the server's start time is "in the future" for the phone.
    const serverStart = new Date(Date.now() + 10 * 60_000).toISOString();
    m(api.getWorkOrderLabor).mockResolvedValueOnce([]).mockResolvedValue([runningSession({ started_at: serverStart })]);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-toggle")).toBeTruthy());
    fireEvent.press(getByTestId("wo-labor-toggle"));
    await waitFor(() => expect(getByTestId("wo-labor-value").props.children).toMatch(/^00:00:0\d$/));
  });

  it("restores a running timer from the server after a reload", async () => {
    m(api.getWorkOrderLabor).mockResolvedValue([runningSession()]);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-value").props.children).toMatch(/^00:2[3-5]:\d\d$/));
    expect(getByTestId("wo-labor-toggle").props.accessibilityLabel).toContain("pauseLabor");
  });

  it("two quick taps send one request", async () => {
    let release: () => void = () => undefined;
    m(api.startWorkOrderLabor).mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-toggle")).toBeTruthy());
    fireEvent.press(getByTestId("wo-labor-toggle"));
    fireEvent.press(getByTestId("wo-labor-toggle"));
    expect(api.startWorkOrderLabor).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it("does not offer labor offline — nothing is counted that the server did not record", async () => {
    mockOnline = false;
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-toggle")).toBeTruthy());
    expect(getByTestId("wo-labor-toggle").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId("wo-labor-toggle"));
    expect(api.startWorkOrderLabor).not.toHaveBeenCalled();
  });

  it("shows a server refusal (a timer already runs elsewhere) and leaves the screen as it was", async () => {
    m(api.startWorkOrderLabor).mockRejectedValue(new Error("You already have a running labor timer on another work order"));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-toggle")).toBeTruthy());
    fireEvent.press(getByTestId("wo-labor-toggle"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("You already have a running labor timer on another work order"));
    expect(getByTestId("wo-labor-value").props.children).toBe("workOrders.repair.summary.noLabor");
  });
});

describe("hold, resume and escalate use the transition endpoint", () => {
  async function openMore(getByTestId: (id: string) => unknown) {
    await waitFor(() => expect(getByTestId("wo-more")).toBeTruthy());
    fireEvent.press(getByTestId("wo-more") as never);
  }

  it("will not hold without a structured reason, then sends reason and note", async () => {
    const { getByTestId } = renderScreen();
    await openMore(getByTestId);
    fireEvent.press(getByTestId("wo-more-hold"));
    await waitFor(() => expect(getByTestId("hold-reason-sheet")).toBeTruthy());
    expect(getByTestId("wo-hold-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId("hold-reason-awaiting_parts"));
    fireEvent.changeText(getByTestId("wo-hold-note"), "Compressor on order");
    fireEvent.press(getByTestId("wo-hold-confirm"));
    await waitFor(() =>
      expect(api.transitionWorkOrder).toHaveBeenCalledWith("wo-1", { status: "on_hold", reason_code: "awaiting_parts", reason_note: "Compressor on order" }),
    );
    expect(api.pauseWorkOrderLabor).not.toHaveBeenCalled();
  });

  it("pauses a running timer first when the engineer chooses to, because holding does not stop it", async () => {
    m(api.getWorkOrderLabor).mockResolvedValue([runningSession()]);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-value").props.children).toMatch(/^00:/));
    await openMore(getByTestId);
    fireEvent.press(getByTestId("wo-more-hold"));
    await waitFor(() => expect(getByTestId("wo-hold-pause-labor")).toBeTruthy());
    fireEvent.press(getByTestId("hold-reason-safety_review"));
    fireEvent.press(getByTestId("wo-hold-confirm"));
    await waitFor(() => expect(api.transitionWorkOrder).toHaveBeenCalled());
    const pauseOrder = m(api.pauseWorkOrderLabor).mock.invocationCallOrder[0];
    const holdOrder = m(api.transitionWorkOrder).mock.invocationCallOrder[0];
    expect(pauseOrder).toBeLessThan(holdOrder);
  });

  it("resumes a held order with no reason", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "on_hold" }));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-resume-work")).toBeTruthy());
    fireEvent.press(getByTestId("wo-resume-work"));
    await waitFor(() => expect(api.transitionWorkOrder).toHaveBeenCalledWith("wo-1", { status: "in_progress" }));
  });

  it("escalates as a status with a required note — it does not change the priority", async () => {
    const { getByTestId } = renderScreen();
    await openMore(getByTestId);
    fireEvent.press(getByTestId("wo-more-escalate"));
    await waitFor(() => expect(getByTestId("wo-escalate-sheet")).toBeTruthy());
    expect(getByTestId("wo-escalate-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(getByTestId("wo-escalate-note"), "Needs the HVAC vendor");
    fireEvent.press(getByTestId("wo-escalate-confirm"));
    await waitFor(() => expect(api.transitionWorkOrder).toHaveBeenCalledWith("wo-1", { status: "escalated", reason_note: "Needs the HVAC vendor" }));
  });

  it("shows the server's refusal when the transition is invalid and keeps the sheet's input", async () => {
    m(api.transitionWorkOrder).mockRejectedValue(new Error("Cannot transition a work order from in_progress to on_hold"));
    const { getByTestId, findByText } = renderScreen();
    await openMore(getByTestId);
    fireEvent.press(getByTestId("wo-more-hold"));
    await waitFor(() => expect(getByTestId("hold-reason-sheet")).toBeTruthy());
    fireEvent.press(getByTestId("hold-reason-awaiting_vendor"));
    fireEvent.changeText(getByTestId("wo-hold-note"), "Vendor visit");
    fireEvent.press(getByTestId("wo-hold-confirm"));
    expect(await findByText("Cannot transition a work order from in_progress to on_hold")).toBeTruthy();
    expect(getByTestId("wo-hold-note").props.value).toBe("Vendor visit");
  });
});

describe("notes and the activity timeline", () => {
  it("adds a note through the existing comments API without re-reading the whole history", async () => {
    m(api.addWorkOrderComment).mockResolvedValue({ id: "c9", comment: "Checked the breaker", user_id: "u1", created_at: "2026-10-31T09:30:00Z", is_system: false });
    const { getByTestId, findByText } = renderScreen();
    await openTab(getByTestId, "work");
    await waitFor(() => expect(getByTestId("wo-tool-note")).toBeTruthy());
    const auditCalls = m(api.getWorkOrderAudit).mock.calls.length;
    fireEvent.press(getByTestId("wo-tool-note"));
    await waitFor(() => expect(getByTestId("wo-comment-input")).toBeTruthy());
    fireEvent.changeText(getByTestId("wo-comment-input"), "Checked the breaker");
    fireEvent.press(getByTestId("wo-note-save"));
    await waitFor(() => expect(api.addWorkOrderComment).toHaveBeenCalledWith("wo-1", "Checked the breaker"));
    await openTab(getByTestId, "history");
    expect(await findByText("Checked the breaker")).toBeTruthy();
    expect(m(api.getWorkOrderAudit).mock.calls.length).toBe(auditCalls);
  });

  it("tells a technician's note apart from a machine event", async () => {
    m(api.getWorkOrder).mockResolvedValue(
      baseOrder({ work_order_comments: [{ id: "c1", comment: "Looks like the capacitor", user_id: "u1", created_at: "2026-10-31T09:10:00Z", is_system: false }] }),
    );
    m(api.getWorkOrderEvents).mockResolvedValue([{ id: "e1", event_type: "arrived", occurred_at: "2026-10-31T09:05:00Z", actor_user_id: "u1" }]);
    const { getByText, getAllByTestId, getByTestId } = renderScreen();
    await openTab(getByTestId, "history");
    await waitFor(() => expect(getByText("workOrders.repair.timeline.noteMine")).toBeTruthy());
    expect(getByText("workOrders.repair.timeline.arrived")).toBeTruthy();
    expect(getAllByTestId("wo-timeline-note")).toHaveLength(1);
  });

  it("says the history could not load instead of showing an empty one", async () => {
    m(api.getWorkOrderEvents).mockRejectedValue(new Error("boom"));
    const { findByText, getByTestId } = renderScreen();
    await openTab(getByTestId, "history");
    expect(await findByText("workOrders.repair.timeline.loadFailed")).toBeTruthy();
  });
});

describe("completion", () => {
  async function openCompletion(utils: ReturnType<typeof renderScreen>) {
    await waitFor(() => expect(utils.getByTestId("wo-review-completion")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-review-completion"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-sheet")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-toggle"));
    await waitFor(() => expect(utils.getByTestId("wo-cx-resolution-replaced_part")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-replaced_part"));
  }

  it("will not go to the final review without a resolution and a verification result", async () => {
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByTestId("wo-review-completion")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-review-completion"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-review")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    expect(utils.getByTestId("wo-err-resolution")).toBeTruthy();
    expect(utils.getByTestId("wo-err-verification")).toBeTruthy();
    expect(utils.queryByTestId("wo-complete-confirm")).toBeNull();
    expect(api.completeWorkOrder).not.toHaveBeenCalled();
  });

  it("requires notes when the result is not 'passed'", async () => {
    const utils = renderScreen();
    await openCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-verify-follow_up_required"));
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    expect(utils.getByTestId("wo-err-verification-notes")).toBeTruthy();
  });

  it("sends the structured body only after an explicit final confirmation, and shows success only once the server accepts", async () => {
    let accept: (v: unknown) => void = () => undefined;
    m(api.completeWorkOrder).mockImplementation(() => new Promise((resolve) => (accept = resolve)));
    const utils = renderScreen();
    await openCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-verify-passed"));
    fireEvent.changeText(utils.getByTestId("completion-notes"), "Swapped the capacitor");
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-review-panel")).toBeTruthy());
    expect(api.completeWorkOrder).not.toHaveBeenCalled();

    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    // A second press while the first is in flight is ignored.
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    expect(api.completeWorkOrder).toHaveBeenCalledTimes(1);
    expect(api.completeWorkOrder).toHaveBeenCalledWith("wo-1", {
      notes: "Swapped the capacitor",
      resolution_code_id: "res-1",
      verification_result: "passed",
    });
    // Not confirmed yet: no success view.
    expect(utils.queryByTestId("wo-completion-result")).toBeNull();

    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "completed" }));
    await act(async () => accept({}));
    await waitFor(() => expect(utils.getByTestId("wo-completion-result")).toBeTruthy());
  });

  it("a failed test is recorded but is not a completion: no success view, the order stays in progress", async () => {
    m(api.completeWorkOrder).mockRejectedValue(Object.assign(new Error("Repair verification failed. The work order remains in progress."), { status: 409 }));
    const utils = renderScreen();
    await openCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-verify-failed"));
    fireEvent.changeText(utils.getByTestId("wo-verification-notes"), "Still blowing warm");
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() => expect(utils.getByTestId("wo-outcome-failed")).toBeTruthy());
    expect(utils.queryByTestId("wo-completion-result")).toBeNull();
    expect(utils.getByTestId("wo-status-line").props.children).toContain("IN_PROGRESS");
  });

  it("shows a conflict when someone changed the order, and no success", async () => {
    m(api.completeWorkOrder).mockRejectedValue(Object.assign(new Error("Cannot transition a work order from completed to completed"), { status: 409 }));
    const utils = renderScreen();
    await openCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-verify-passed"));
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() => expect(utils.getByTestId("wo-outcome-conflict")).toBeTruthy());
    expect(utils.queryByTestId("wo-completion-result")).toBeNull();
  });

  it("offline, a plain completion is queued, not confirmed: the order stays open and no success view appears", async () => {
    mockOnline = false;
    const utils = renderScreen();
    await openCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-verify-passed"));
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() =>
      expect(enqueueAction).toHaveBeenCalledWith("work_order", "complete", { resolution_code_id: "res-1", verification_result: "passed" }, "wo-1", expect.anything()),
    );
    expect(api.completeWorkOrder).not.toHaveBeenCalled();
    expect(utils.queryByTestId("wo-completion-result")).toBeNull();
    expect(utils.getByTestId("wo-status-line").props.children).toContain("IN_PROGRESS");
  });

  it("offline, a failed test cannot be queued", async () => {
    mockOnline = false;
    const utils = renderScreen();
    await openCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-verify-failed"));
    fireEvent.changeText(utils.getByTestId("wo-verification-notes"), "Still warm");
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-offline-block")).toBeTruthy());
    expect(utils.getByTestId("wo-complete-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it("shows a queued completion as waiting for the server after a restart", async () => {
    m(getPendingSyncQueue).mockResolvedValue([{ entity_type: "work_order", entity_id: "wo-1", action: "complete" }]);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-banner-complete-queued")).toBeTruthy());
  });
});

describe("parts and evidence", () => {
  it("stages an inventory part and includes it in the completion body as parts_consumed", async () => {
    m(api.listInventoryParts).mockResolvedValue([{ id: "part-1", name: "Capacitor 45/5", sku: "CAP-45", unit: "ea", total_on_hand: 6 }]);
    m(api.getPartStock).mockResolvedValue([{ location_id: "loc-1", quantity: 6, engineering_part_locations: { name: "Shop" } }]);
    const utils = renderScreen();
    await openTab(utils.getByTestId, "work");
    await waitFor(() => expect(utils.getByTestId("wo-tool-parts")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-tool-parts"));
    await waitFor(() => expect(utils.getByTestId("wo-part-part-1")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-part-part-1"));
    await waitFor(() => expect(utils.getByTestId("wo-part-quantity")).toBeTruthy());
    fireEvent.changeText(utils.getByTestId("wo-part-quantity"), "2");
    fireEvent.press(utils.getByTestId("wo-part-add"));
    await waitFor(() => expect(utils.getByTestId("wo-staged-part-0")).toBeTruthy());
    // Staging deducts nothing: no inventory or completion request has been made.
    expect(api.completeWorkOrder).not.toHaveBeenCalled();
    fireEvent.press(utils.getByTestId("wo-parts-done"));

    fireEvent.press(utils.getByTestId("wo-review-completion"));
    await waitFor(() => expect(utils.getByTestId("wo-cx-resolution-toggle")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-toggle"));
    await waitFor(() => expect(utils.getByTestId("wo-cx-resolution-replaced_part")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-replaced_part"));
    fireEvent.press(utils.getByTestId("wo-verify-passed"));
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() =>
      expect(api.completeWorkOrder).toHaveBeenCalledWith("wo-1", {
        resolution_code_id: "res-1",
        verification_result: "passed",
        parts_consumed: [{ part_id: "part-1", location_id: "loc-1", quantity: 2 }],
      }),
    );
  });

  it("will not stage more than is on hand at the chosen location", async () => {
    m(api.listInventoryParts).mockResolvedValue([{ id: "part-1", name: "Capacitor 45/5", total_on_hand: 2 }]);
    m(api.getPartStock).mockResolvedValue([{ location_id: "loc-1", quantity: 2, engineering_part_locations: { name: "Shop" } }]);
    const utils = renderScreen();
    await openTab(utils.getByTestId, "work");
    await waitFor(() => expect(utils.getByTestId("wo-tool-parts")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-tool-parts"));
    await waitFor(() => expect(utils.getByTestId("wo-part-part-1")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-part-part-1"));
    await waitFor(() => expect(utils.getByTestId("wo-part-quantity")).toBeTruthy());
    fireEvent.changeText(utils.getByTestId("wo-part-quantity"), "5");
    expect(utils.getByTestId("wo-part-add").props.accessibilityState.disabled).toBe(true);
  });

  it("keeps a historical free-text parts note as part of the record", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "completed", parts_used: "Belt A-4L360" }));
    const { getByText } = renderScreen();
    await waitFor(() => expect(getByText("Belt A-4L360")).toBeTruthy());
  });

  it("evidence needs a connection and is not queued offline", async () => {
    mockOnline = false;
    const { getByTestId } = renderScreen();
    await openTab(getByTestId, "work");
    await waitFor(() => expect(getByTestId("wo-tool-evidence")).toBeTruthy());
    fireEvent.press(getByTestId("wo-tool-evidence"));
    await waitFor(() => expect(getByTestId("wo-evidence-sheet")).toBeTruthy());
    expect(getByTestId("wo-evidence-camera").props.accessibilityState.disabled).toBe(true);
  });
});

describe("diagnosis", () => {
  it("saves the problem code through the diagnosis endpoint", async () => {
    m(api.saveDiagnosis).mockResolvedValue({ id: "wo-1" });
    const utils = renderScreen();
    await openTab(utils.getByTestId, "work");
    await waitFor(() => expect(utils.getByTestId("wo-tool-diagnosis")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-tool-diagnosis"));
    await waitFor(() => expect(utils.getByTestId("wo-dx-problem-toggle")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-dx-problem-toggle"));
    await waitFor(() => expect(utils.getByTestId("wo-dx-problem-no_cooling")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-dx-problem-no_cooling"));
    fireEvent.press(utils.getByTestId("wo-diagnosis-save"));
    await waitFor(() => expect(api.saveDiagnosis).toHaveBeenCalledWith("wo-1", { problem_code_id: "pro-1", cause_code_id: undefined, problem_other_text: undefined, cause_other_text: undefined }));
  });

  it("refuses to save an empty diagnosis", async () => {
    const utils = renderScreen();
    await openTab(utils.getByTestId, "work");
    await waitFor(() => expect(utils.getByTestId("wo-tool-diagnosis")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-tool-diagnosis"));
    await waitFor(() => expect(utils.getByTestId("wo-diagnosis-save")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-diagnosis-save"));
    expect(api.saveDiagnosis).not.toHaveBeenCalled();
  });

  it("surfaces a permission refusal in the sheet", async () => {
    m(api.saveDiagnosis).mockRejectedValue(new Error("Engineers can only update assigned or unassigned open work orders"));
    const utils = renderScreen();
    await openTab(utils.getByTestId, "work");
    await waitFor(() => expect(utils.getByTestId("wo-tool-diagnosis")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-tool-diagnosis"));
    await waitFor(() => expect(utils.getByTestId("wo-dx-problem-toggle")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-dx-problem-toggle"));
    await waitFor(() => expect(utils.getByTestId("wo-dx-problem-no_cooling")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-dx-problem-no_cooling"));
    fireEvent.press(utils.getByTestId("wo-diagnosis-save"));
    expect(await utils.findByText("Engineers can only update assigned or unassigned open work orders")).toBeTruthy();
  });
});

describe("loading failures", () => {
  it("a 403 on the order says access is denied, not 'could not load'", async () => {
    m(api.getWorkOrder).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const { findByText } = renderScreen();
    expect(await findByText("workOrders.repair.errorForbidden")).toBeTruthy();
  });

  it("a failed labor read does not break the screen and the labor total is not shown as zero", async () => {
    m(api.getWorkOrderLabor).mockRejectedValue(new Error("boom"));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-value").props.children).toBe("—"));
    expect(getByTestId("wo-title")).toBeTruthy();
  });
});

describe("Phase 3: tabbed detail workspace", () => {
  const assetOrder = (over: Record<string, unknown> = {}) =>
    baseOrder({ asset_id: "asset-1", assets: { id: "asset-1", name: "PTAC 101", asset_tag: "A-101", location_text: "Room 101" }, ...over });

  it("opens on Overview with four tabs, announces the selected one, and switches content", async () => {
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-tabs")).toBeTruthy());
    for (const tab of ["overview", "checklist", "work", "history"]) expect(getByTestId(`wo-tab-${tab}`).props.accessibilityRole).toBe("tab");
    expect(getByTestId("wo-tab-overview").props.accessibilityState.selected).toBe(true);
    expect(getByTestId("wo-issue")).toBeTruthy();
    expect(queryByTestId("wo-tools")).toBeNull();
    fireEvent.press(getByTestId("wo-tab-work"));
    expect(getByTestId("wo-tab-work").props.accessibilityState.selected).toBe(true);
    expect(getByTestId("wo-tab-overview").props.accessibilityState.selected).toBe(false);
    expect(getByTestId("wo-tools")).toBeTruthy();
    expect(queryByTestId("wo-issue")).toBeNull();
    fireEvent.press(getByTestId("wo-tab-history"));
    expect(getByTestId("wo-timeline")).toBeTruthy();
  });

  it("keeps the sticky action bar on every tab", async () => {
    const { getByTestId } = renderScreen();
    await openTab(getByTestId, "work");
    expect(getByTestId("wo-review-completion")).toBeTruthy();
    fireEvent.press(getByTestId("wo-tab-history"));
    expect(getByTestId("wo-review-completion")).toBeTruthy();
  });

  it("shows the room and a guest-reported chip in the header", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ guest_reported: true }));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-where")).toBeTruthy());
    expect(getByTestId("wo-number")).toBeTruthy();
    expect(getByTestId("wo-chip-guest")).toBeTruthy();
  });

  it("leads with Claim Work for an unassigned order and Continue Repair for one in progress", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "open", assigned_to: null }));
    const first = renderScreen();
    await waitFor(() => expect(first.getByTestId("wo-next-label").props.children).toBe("workOrders.repair.next.claim.label"));
    expect(first.getByTestId("wo-claim")).toBeTruthy();
    first.unmount();
    m(api.getWorkOrder).mockResolvedValue(baseOrder());
    const second = renderScreen();
    await waitFor(() => expect(second.getByTestId("wo-next-label").props.children).toBe("workOrders.repair.next.continue.label"));
  });

  it("calls a held order Review Hold while the bar still offers the real Resume action", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "on_hold", hold_reason_code: "awaiting_parts" }));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-next-label").props.children).toBe("workOrders.repair.next.reviewHold.label"));
    expect(getByTestId("wo-resume-work")).toBeTruthy();
  });

  it("does not offer technician actions to a chief engineer, only the record", async () => {
    mockUser = { id: "chief-1", role: "chief_engineer", language_pref: "en" };
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ assigned_to: "other" }));
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-next-label").props.children).toBe("workOrders.repair.next.viewOnly.label"));
    expect(queryByTestId("wo-action-bar")).toBeNull();
    fireEvent.press(getByTestId("wo-tab-work"));
    expect(queryByTestId("wo-tool-hold")).toBeNull();
    expect(queryByTestId("wo-tool-escalate")).toBeNull();
    expect(queryByTestId("wo-tool-diagnosis")?.props.accessibilityState.disabled).toBe(true);
  });

  it("does not guess occupancy when the server could not verify it", async () => {
    for (const room_context of [{ occupancy: "unknown", availability: null }, undefined]) {
      m(api.getWorkOrder).mockResolvedValue(baseOrder({ room_context }));
      const { getByTestId, queryByText, unmount } = renderScreen();
      await waitFor(() => expect(getByTestId("wo-open-room")).toBeTruthy());
      expect(queryByText(/Occupied|Vacant/)).toBeNull();
      unmount();
    }
  });

  it("shows a recorded room availability from the server, and none when nothing is recorded", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ room_context: { occupancy: "vacant", availability: "out_of_service" } }));
    const down = renderScreen();
    await waitFor(() => expect(down.getByText("engRooms.availability.out_of_service")).toBeTruthy());
    down.unmount();
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ room_context: { occupancy: "vacant", availability: null } }));
    const up = renderScreen();
    await waitFor(() => expect(up.getByText(/Vacant/)).toBeTruthy());
    expect(up.queryByText(/engRooms\.availability/)).toBeNull();
  });

  it("renders without any room at all", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ room_id: null, rooms: null, location_text: "Boiler room" }));
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-where")).toBeTruthy());
    expect(getByTestId("wo-issue")).toBeTruthy();
  });

  it("says there is no checklist, with no items and no progress, when the order has none", async () => {
    const { getByTestId, queryByTestId } = renderScreen();
    await openTab(getByTestId, "checklist");
    await waitFor(() => expect(getByTestId("wo-checklist-empty")).toBeTruthy());
    expect(queryByTestId("wo-checklist-bar")).toBeNull();
  });

  it("scopes earlier repairs to the linked asset and keeps them out of this order's activity", async () => {
    m(api.getWorkOrder).mockResolvedValue(assetOrder());
    m(api.listAssetRepairs).mockResolvedValue([{ id: "wo-old", title: "Replaced fan", status: "completed", priority: "normal", completed_at: "2026-09-01T10:00:00Z" }]);
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-asset-summary-line")).toBeTruthy());
    expect(queryByTestId("wo-related-wo-old")).toBeNull();
    expect(api.listAssetRepairs).toHaveBeenCalledWith("asset-1", expect.anything());
    fireEvent.press(getByTestId("wo-tab-history"));
    await waitFor(() => expect(getByTestId("wo-related-wo-old")).toBeTruthy());
    expect(getByTestId("wo-asset-history")).toBeTruthy();
    expect(getByTestId("wo-timeline")).toBeTruthy();
  });

  it("shows no asset history for an order with no linked asset, even in a room with one", async () => {
    const { getByTestId, queryByTestId } = renderScreen();
    await openTab(getByTestId, "history");
    expect(queryByTestId("wo-asset-history")).toBeNull();
    expect(api.listAssetRepairs).not.toHaveBeenCalled();
  });

  it("does not tick Diagnose just because the Diagnosis sheet was opened", async () => {
    const { getByTestId } = renderScreen();
    await openTab(getByTestId, "work");
    fireEvent.press(getByTestId("wo-tool-diagnosis"));
    await waitFor(() => expect(getByTestId("wo-dx-problem-toggle")).toBeTruthy());
    expect(api.saveDiagnosis).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("wo-tab-overview"));
    expect(getByTestId("wo-progress").props.accessibilityLabel).toContain("workOrders.repair.progress.stage.diagnose: workOrders.repair.progress.state.pending");
  });

  it("opens Hold from the Work tab, and disables Hold and Escalate offline", async () => {
    const online = renderScreen();
    await openTab(online.getByTestId, "work");
    fireEvent.press(online.getByTestId("wo-tool-hold"));
    await waitFor(() => expect(online.getByTestId("hold-reason-sheet")).toBeTruthy());
    online.unmount();
    mockOnline = false;
    const offline = renderScreen();
    await openTab(offline.getByTestId, "work");
    expect(offline.getByTestId("wo-tool-hold").props.accessibilityState.disabled).toBe(true);
    expect(offline.getByTestId("wo-tool-escalate").props.accessibilityState.disabled).toBe(true);
    expect(offline.getByTestId("wo-banner-offline")).toBeTruthy();
  });

  it("resumes a held order from the Work tab through the transition endpoint", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "on_hold" }));
    const { getByTestId } = renderScreen();
    await openTab(getByTestId, "work");
    fireEvent.press(getByTestId("wo-tool-resumeWork"));
    await waitFor(() => expect(api.transitionWorkOrder).toHaveBeenCalledWith("wo-1", { status: "in_progress" }));
  });

  it("takes the Overview labor card to the Work tab", async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId("wo-labor-card")).toBeTruthy());
    fireEvent.press(getByTestId("wo-labor-card"));
    expect(getByTestId("wo-tab-work").props.accessibilityState.selected).toBe(true);
  });

  it("opens the existing completion sheet from the bar on any tab", async () => {
    const { getByTestId } = renderScreen();
    await openTab(getByTestId, "history");
    fireEvent.press(getByTestId("wo-review-completion"));
    await waitFor(() => expect(getByTestId("wo-complete-sheet")).toBeTruthy());
  });
});

describe("Phase 4: checklist and completion verification", () => {
  const withChecklist = (items: ReturnType<typeof clItem>[], editable = true) => m(api.getWorkOrderChecklist).mockResolvedValue(clSnapshot(items, editable));

  async function openChecklist(utils: ReturnType<typeof renderScreen>) {
    await openTab(utils.getByTestId, "checklist");
    await waitFor(() => expect(utils.queryByTestId("wo-checklist-summary")).toBeTruthy());
  }

  async function reachCompletion(utils: ReturnType<typeof renderScreen>) {
    await waitFor(() => expect(utils.getByTestId("wo-review-completion")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-review-completion"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-sheet")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-toggle"));
    await waitFor(() => expect(utils.getByTestId("wo-cx-resolution-replaced_part")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-replaced_part"));
    fireEvent.press(utils.getByTestId("wo-verify-passed"));
  }

  it("shows the order's real checklist from the server, with its count", async () => {
    withChecklist([clItem("a1", { is_done: true }), clItem("a2"), clItem("a3")]);
    const utils = renderScreen();
    await openChecklist(utils);
    expect(api.getWorkOrderChecklist).toHaveBeenCalledWith("wo-1", expect.anything());
    expect(utils.getByText("Step a2")).toBeTruthy();
    expect(utils.getByTestId("wo-checklist-bar").props.accessibilityValue).toEqual({ min: 0, max: 3, now: 1 });
  });

  it("ticks a step through the API and shows it done only after the server confirms", async () => {
    withChecklist([clItem("a1"), clItem("a2")]);
    let confirm: (v: unknown) => void = () => undefined;
    m(api.setWorkOrderChecklistItem).mockImplementation(() => new Promise((resolve) => (confirm = resolve)));
    const utils = renderScreen();
    await openChecklist(utils);
    fireEvent.press(utils.getByTestId("wo-checklist-item-a1"));
    fireEvent.press(utils.getByTestId("wo-checklist-item-a1"));
    expect(api.setWorkOrderChecklistItem).toHaveBeenCalledTimes(1);
    expect(api.setWorkOrderChecklistItem).toHaveBeenCalledWith("wo-1", "a1", true);
    expect(utils.getByTestId("wo-checklist-saving-a1")).toBeTruthy();
    expect(utils.getByTestId("wo-checklist-item-a1").props.accessibilityState.checked).toBe(false);

    const done = clItem("a1", { is_done: true, done_by: "u1", done_at: "2026-10-31T15:00:00Z" });
    await act(async () => confirm({ item: done, summary: clSummary([done, clItem("a2")]) }));
    await waitFor(() => expect(utils.getByTestId("wo-checklist-item-a1").props.accessibilityState.checked).toBe(true));
    expect(utils.queryByTestId("wo-checklist-saving-a1")).toBeNull();
  });

  it("keeps a step open and says so when the server refuses the change", async () => {
    withChecklist([clItem("a1")]);
    m(api.setWorkOrderChecklistItem).mockRejectedValue(Object.assign(new Error("closed"), { status: 409, code: "work_order_closed" }));
    const utils = renderScreen();
    await openChecklist(utils);
    fireEvent.press(utils.getByTestId("wo-checklist-item-a1"));
    await waitFor(() => expect(utils.getByTestId("wo-checklist-error-a1")).toBeTruthy());
    expect(utils.getByTestId("wo-checklist-item-a1").props.accessibilityState.checked).toBe(false);
  });

  it("shows a failed checklist read as a failure with retry, not as 'no checklist'", async () => {
    m(api.getWorkOrderChecklist).mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    const utils = renderScreen();
    await openTab(utils.getByTestId, "checklist");
    await waitFor(() => expect(utils.getByText("workOrders.repair.checklist.errorLoad")).toBeTruthy());
    expect(utils.queryByTestId("wo-checklist-empty")).toBeNull();
    withChecklist([clItem("a1")]);
    fireEvent.press(utils.getByText("common.retry"));
    await waitFor(() => expect(utils.getByText("Step a1")).toBeTruthy());
  });

  it("makes a chief engineer's checklist read-only", async () => {
    mockUser = { id: "chief", role: "chief_engineer", language_pref: "en" };
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ assigned_to: "u1" }));
    withChecklist([clItem("a1")]);
    const utils = renderScreen();
    await openChecklist(utils);
    expect(utils.getByTestId("wo-checklist-readonly")).toBeTruthy();
    fireEvent.press(utils.getByTestId("wo-checklist-item-a1"));
    expect(api.setWorkOrderChecklistItem).not.toHaveBeenCalled();
  });

  it("shows a completed order's checklist as a read-only record", async () => {
    m(api.getWorkOrder).mockResolvedValue(baseOrder({ status: "completed" }));
    withChecklist([clItem("a1", { is_done: true, is_required: true })], false);
    const utils = renderScreen();
    await openChecklist(utils);
    expect(utils.getByText("Step a1")).toBeTruthy();
    fireEvent.press(utils.getByTestId("wo-checklist-item-a1"));
    expect(api.setWorkOrderChecklistItem).not.toHaveBeenCalled();
  });

  it("cannot change a step offline, because a step is never queued", async () => {
    mockOnline = false;
    withChecklist([clItem("a1")]);
    const utils = renderScreen();
    await openChecklist(utils);
    fireEvent.press(utils.getByTestId("wo-checklist-item-a1"));
    expect(api.setWorkOrderChecklistItem).not.toHaveBeenCalled();
    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it("lists the open required steps in completion readiness and leads back to the checklist", async () => {
    withChecklist([clItem("a1", { is_required: true }), clItem("a2", { is_required: true }), clItem("a3")]);
    const utils = renderScreen();
    await reachCompletion(utils);
    await waitFor(() => expect(utils.getByTestId("wo-blocker-checklist")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    expect(utils.getByTestId("wo-err-checklist")).toBeTruthy();
    expect(utils.queryByTestId("wo-complete-confirm")).toBeNull();
    expect(api.completeWorkOrder).not.toHaveBeenCalled();
    fireEvent.press(utils.getByTestId("wo-readiness-view-checklist"));
    await waitFor(() => expect(utils.getByTestId("wo-tab-checklist").props.accessibilityState.selected).toBe(true));
  });

  it("is ready to complete when every required step is done, and optional ones never block", async () => {
    withChecklist([clItem("a1", { is_required: true, is_done: true }), clItem("a2")]);
    const utils = renderScreen();
    await reachCompletion(utils);
    await waitFor(() => expect(utils.getByTestId("wo-readiness-checklist")).toBeTruthy());
    expect(utils.queryByTestId("wo-blocker-checklist")).toBeNull();
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
  });

  it("completes an order with no checklist as before", async () => {
    const utils = renderScreen();
    await reachCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    expect(utils.queryByTestId("wo-readiness-checklist")).toBeNull();
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() => expect(api.completeWorkOrder).toHaveBeenCalledWith("wo-1", { resolution_code_id: "res-1", verification_result: "passed" }));
  });

  it("shows the server's refusal when required steps are open and never shows success", async () => {
    // The phone's read said ready; someone reopened a step before the server saw the completion.
    withChecklist([clItem("a1", { is_required: true, is_done: true })]);
    m(api.completeWorkOrder).mockRejectedValue(
      Object.assign(new Error("1 required checklist item must be done"), { status: 422, code: "checklist_incomplete", detail: { code: "checklist_incomplete", remaining: [{ id: "a1", label: "Step a1" }] } }),
    );
    const utils = renderScreen();
    await reachCompletion(utils);
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    withChecklist([clItem("a1", { is_required: true })]);
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() => expect(utils.getByTestId("wo-err-checklist")).toBeTruthy());
    expect(utils.queryByTestId("wo-completion-result")).toBeNull();
    expect(utils.getByTestId("wo-status-line").props.children).toContain("IN_PROGRESS");
    // The checklist was re-read, so the readiness now names the step.
    await waitFor(() => expect(utils.getByTestId("wo-blocker-checklist")).toBeTruthy());
  });

  it("offline, will not queue a completion while a required step is open", async () => {
    mockOnline = false;
    withChecklist([clItem("a1", { is_required: true })]);
    const utils = renderScreen();
    await reachCompletion(utils);
    await waitFor(() => expect(utils.getByTestId("wo-blocker-checklist")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    expect(utils.queryByTestId("wo-complete-confirm")).toBeNull();
    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it("offline, will not queue a completion when the checklist was never confirmed on this phone", async () => {
    mockOnline = false;
    m(api.getWorkOrderChecklist).mockRejectedValue(new Error("Network request failed"));
    const utils = renderScreen();
    await reachCompletion(utils);
    await waitFor(() => expect(utils.getByTestId("wo-blocker-checklistUnverified")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-offline-block")).toBeTruthy());
    expect(utils.getByTestId("wo-complete-confirm").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it("offline, still queues a completion once the checklist is confirmed clear", async () => {
    mockOnline = false;
    withChecklist([clItem("a1", { is_required: true, is_done: true })]);
    const utils = renderScreen();
    await reachCompletion(utils);
    await waitFor(() => expect(utils.getByTestId("wo-readiness-checklist")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() => expect(enqueueAction).toHaveBeenCalledWith("work_order", "complete", { resolution_code_id: "res-1", verification_result: "passed" }, "wo-1", expect.anything()));
    expect(utils.queryByTestId("wo-completion-result")).toBeNull();
  });

  it("does not let open required steps stop a failed test from being recorded", async () => {
    withChecklist([clItem("a1", { is_required: true })]);
    m(api.completeWorkOrder).mockRejectedValue(Object.assign(new Error("Repair verification failed. The work order remains in progress."), { status: 409 }));
    const utils = renderScreen();
    await waitFor(() => expect(utils.getByTestId("wo-review-completion")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-review-completion"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-sheet")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-toggle"));
    await waitFor(() => expect(utils.getByTestId("wo-cx-resolution-replaced_part")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-cx-resolution-replaced_part"));
    fireEvent.press(utils.getByTestId("wo-verify-failed"));
    fireEvent.changeText(utils.getByTestId("wo-verification-notes"), "Still warm");
    await waitFor(() => expect(utils.queryByTestId("wo-blocker-checklist")).toBeNull());
    fireEvent.press(utils.getByTestId("wo-complete-review"));
    await waitFor(() => expect(utils.getByTestId("wo-complete-confirm")).toBeTruthy());
    fireEvent.press(utils.getByTestId("wo-complete-confirm"));
    await waitFor(() => expect(utils.getByTestId("wo-outcome-failed")).toBeTruthy());
  });
});

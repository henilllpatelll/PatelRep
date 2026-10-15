import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StyleSheet } from "react-native";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { APPEARANCE_STORAGE_KEY } from "@/lib/theme/appearance";
import { darkTheme, lightTheme } from "@/components/shared/tokens";

const mockSetMyRooms = jest.fn();

type TestRoom = Record<string, unknown> & { id: string; room_number: string; status: string };

function makeRoom(id: string, overrides: Record<string, unknown> = {}): TestRoom {
  return {
    id: `room-${id}`,
    room_number: id,
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    // a verified checkout, so a departure is workable (not "checkout not verified")
    actual_checkout_at: new Date(Date.now() - 3600_000).toISOString(),
    ...overrides,
  };
}

const mockRooms: TestRoom[] = [
  makeRoom("108", { status: "IN_PROGRESS", guest_name: "Guest still in" }),
  makeRoom("112"),
  makeRoom("115", { risk_level: "HIGH", guest_name: "Mr. Bell", vip_flag: true, checkin_time: "2026-05-26T15:00:00.000Z" }),
  makeRoom("101", { status: "INSPECTED" }),
];

// The real locale files, so a missing key shows up as a raw key in an assertion.
let mockLanguage: "en" | "es" = "en";
// The saved profile preference can lag the language the person just picked in Profile.
let mockLanguagePref: "en" | "es" | null = null;
jest.mock("react-i18next", () => {
  const { makeTranslator } = require("../helpers/i18n");
  const t = makeTranslator(() => mockLanguage);
  return {
    useTranslation: () => ({ t, i18n: { language: mockLanguage, resolvedLanguage: mockLanguage } }),
  };
});

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useFocusEffect: () => undefined,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

let mockRoomsForRequest: TestRoom[] = mockRooms;
let mockRoomsRequestFails = false;
let mockCachedRooms: TestRoom[] = mockRooms;
const endedShiftRow = () => ({
  data: {
    id: "shift-1",
    status: "ended",
    started_at: new Date(Date.now() - 3600_000).toISOString(),
    ended_at: new Date().toISOString(),
    on_break_since: null,
    break_seconds: 0,
  },
});
const mockEndShift = jest.fn(() => Promise.resolve(endedShiftRow()));
let mockShiftCurrentFails = false;
let mockBreakOn = false;
const mockShiftBreak = jest.fn((path: string, body: { action: "start" | "end" }) => {
  mockBreakOn = body.action === "start";
  return Promise.resolve({
    data: {
      id: "shift-1",
      status: mockBreakOn ? "on_break" : "active",
      started_at: new Date(Date.now() - 3600_000).toISOString(),
      ended_at: null,
      on_break_since: mockBreakOn ? new Date().toISOString() : null,
      break_seconds: 0,
    },
  });
});
const mockStartShift = jest.fn().mockResolvedValue({ data: { id: "shift-new", status: "active", started_at: new Date().toISOString() } });
let mockShiftCurrent: { data: unknown; meta?: unknown } = { data: null, meta: { last_ended: null } };

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn((path: string) => {
      if (path.startsWith("/shifts/current")) {
        return mockShiftCurrentFails ? Promise.reject(new Error("network down")) : Promise.resolve(mockShiftCurrent);
      }
      if (path.startsWith("/clean-sessions")) return Promise.resolve({ data: null });
      if (mockRoomsRequestFails) return Promise.reject(new Error("server down"));
      return Promise.resolve({ data: mockRoomsForRequest });
    }),
    post: jest.fn((path: string, body?: { action: "start" | "end" }) => {
      if (path.startsWith("/shifts/break")) return mockShiftBreak(path, body as { action: "start" | "end" });
      if (path.startsWith("/shifts/start")) return mockStartShift(path);
      if (path.startsWith("/shifts/end")) return mockEndShift();
      return Promise.reject(new Error("ai offline"));
    }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

const mockListNotifications = jest.fn().mockResolvedValue({ data: [] });
const mockMarkRead = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/api/notifications", () => ({
  listNotifications: (...args: unknown[]) => mockListNotifications(...args),
  markRead: (...args: unknown[]) => mockMarkRead(...args),
}));

jest.mock("@/lib/offline/db", () => ({
  getRooms: jest.fn(() => Promise.resolve(mockCachedRooms)),
  getRoomsByDate: jest.fn().mockResolvedValue([]),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  getSyncQueueSummary: jest.fn().mockResolvedValue([]),
}));

const mockEnqueueAction = jest.fn().mockResolvedValue(undefined);
const mockRefreshRooms = jest.fn().mockResolvedValue(undefined);
let mockStoreRooms: TestRoom[] = mockRooms;
let mockIsOnline = true;
let mockUnread = 0;

function mockAppState() {
  return {
    user: { id: "user-1", tenant_id: "hotel-1", full_name: "Maria Vega", role: "housekeeper", language_pref: mockLanguagePref ?? mockLanguage },
    isOnline: mockIsOnline,
    myRooms: mockStoreRooms,
    pendingActions: [],
    unreadCount: mockUnread,
    setMyRooms: mockSetMyRooms,
    refreshRooms: mockRefreshRooms,
    enqueueAction: mockEnqueueAction,
    dropQueuedRoomStatus: jest.fn().mockResolvedValue(undefined),
  };
}

jest.mock("@/stores/appStore", () => {
  const useAppStore = (selector?: (state: ReturnType<typeof mockAppState>) => unknown) => {
    const state = mockAppState();
    return selector ? selector(state) : state;
  };
  useAppStore.getState = () => mockAppState();
  return { useAppStore };
});

import HousekeeperHomeScreen from "@/app/(app)/home";
import { resetRoomsRequestState } from "@/lib/housekeeping/roomsRequest";
import { resetRoomsStatus } from "@/stores/roomsStatusStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import type { ChecklistItem, LocalCleanSession } from "@/lib/housekeeping/cleanSession";

function seedSession(roomId: string, checked: boolean, overrides: Partial<LocalCleanSession> = {}): void {
  const checklist: ChecklistItem[] = [
    { item_id: "i1", section: "Bedroom", label: "Make bed", is_required: true, checked, checked_at: checked ? "2026-10-08T10:00:00Z" : null },
    { item_id: "i2", section: "Bathroom", label: "Clean bathroom", is_required: true, checked, checked_at: checked ? "2026-10-08T10:01:00Z" : null },
    { item_id: "i3", section: "General", label: "Vacuum", is_required: false, checked: false, checked_at: null },
  ];
  const record: LocalCleanSession = {
    roomId,
    sessionId: "sess-" + roomId,
    cleanType: "LIGHT",
    startedAt: "2026-10-08T09:30:00Z",
    entryAcknowledged: true,
    checklist,
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: "2026-10-08T10:01:00Z",
    ...overrides,
  };
  useCleanSessionStore.setState({ scope: "hotel-1:user-1", sessions: { [roomId]: record } });
}

const activeShift = (overrides: Record<string, unknown> = {}) => ({
  id: "shift-1",
  status: "active",
  started_at: new Date(Date.now() - 3600_000).toISOString(),
  ended_at: null,
  on_break_since: null,
  break_seconds: 0,
  ...overrides,
});

function setRooms(rooms: TestRoom[]): void {
  mockStoreRooms = rooms;
  mockRoomsForRequest = rooms;
  mockCachedRooms = rooms;
}

function renderHome() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <HousekeeperHomeScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** Position of each testID in document order, so a test can assert reading order. */
function order(screen: ReturnType<typeof renderHome>, ids: string[]): number[] {
  const seen: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const { props, children } = node as { props?: { testID?: string }; children?: unknown[] | null };
    if (props?.testID) seen.push(props.testID);
    (children ?? []).forEach(walk);
  };
  const tree = screen.toJSON();
  (Array.isArray(tree) ? tree : [tree]).forEach(walk);
  return ids.map((id) => seen.indexOf(id));
}

const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe("HousekeeperHomeScreen — My Shift dashboard", () => {
  beforeEach(() => {
    resetRoomsStatus();
    resetRoomsRequestState();
    mockLanguage = "en";
    mockRoomsRequestFails = false;
    setRooms(mockRooms);
    mockIsOnline = true;
    mockUnread = 0;
    mockShiftCurrent = { data: activeShift(), meta: { last_ended: null } };
    mockStartShift.mockClear();
    mockShiftBreak.mockClear();
    mockBreakOn = false;
    mockEndShift.mockReset().mockImplementation(() => Promise.resolve(endedShiftRow()));
    mockShiftCurrentFails = false;
    mockListNotifications.mockReset().mockResolvedValue({ data: [] });
    mockMarkRead.mockReset().mockResolvedValue(undefined);
    mockRefreshRooms.mockClear();
    useCleanSessionStore.getState().reset();
    void AsyncStorage.clear();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("expo-router").router.push.mockClear();
  });

  /* ─── State 3: cleaning in progress ──────────────────────────────────────── */

  describe("cleaning in progress", () => {
    const startedMinutesAgo = (minutes: number, seconds = 0) =>
      new Date(Date.now() - (minutes * 60 + seconds) * 1000).toISOString();

    it("leads with the open room: real timer, real checklist, one strong primary action", async () => {
      seedSession("room-108", false, { startedAt: startedMinutesAgo(18, 24) });
      const screen = renderHome();
      const { getByTestId, getByText, getByLabelText } = screen;

      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(getByText("Right now — in progress")).toBeTruthy();
      expect(getByTestId("current-room-number").props.children).toBe("108");
      expect(getByText("Cleaning checklist: 0 of 3")).toBeTruthy();
      // 18:24 (±a few seconds of test runtime), not a made-up number
      expect(getByTestId("current-room-elapsed").props.children).toMatch(/^18:(2[4-9]|3\d)$/);

      const primary = getByLabelText("Continue cleaning, room 108");
      expect(primary.props.accessibilityRole).toBe("button");
      expect(flat(primary.props.style).minHeight).toBeGreaterThanOrEqual(48);

      // The open room comes before the progress card, attention and everything else.
      const [focus, progress, attention] = order(screen, ["focus-card", "shift-progress-card", "needs-attention"]);
      expect(focus).toBeGreaterThan(-1);
      expect(focus).toBeLessThan(progress);
      expect(progress).toBeLessThan(attention);
    });

    it("never invents a timer from a session start that is not believable", async () => {
      seedSession("room-108", false); // started days ago in the fixture
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(queryByTestId("current-room-elapsed")).toBeNull();
    });

    it("opens the existing room workflow from the primary action, once per tap burst", async () => {
      seedSession("room-108", false, { startedAt: startedMinutesAgo(5) });
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-primary")).toBeTruthy());

      fireEvent.press(getByTestId("focus-primary"));
      fireEvent.press(getByTestId("focus-primary"));
      fireEvent.press(getByTestId("focus-primary"));

      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-108");
    });

    it("is a recovery state, not a fake timer, when the room is in progress but this phone has no session", async () => {
      const { getByTestId, getByText, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("current-room-recovery")).toBeTruthy());
      expect(getByText("Right now — needs recovery")).toBeTruthy();
      expect(queryByTestId("current-room-elapsed")).toBeNull();
      expect(queryByTestId("focus-mark-clean")).toBeNull();
    });

    it("shows what has not reached the server instead of 'All changes synced'", async () => {
      seedSession("room-108", false, {
        startedAt: startedMinutesAgo(5),
        pendingItems: { i1: { item_id: "i1", section: "Bedroom", label: "Make bed", is_required: true, checked: true, checked_at: null } },
      });
      const { getByTestId, getByText, queryByText } = renderHome();
      await waitFor(() => expect(getByText("Saved on this phone")).toBeTruthy());
      expect(getByTestId("home-sync-line").props.accessibilityLabel).toMatch(/saved on this phone, not sent yet/);
      expect(queryByText(/All changes synced/)).toBeNull();
    });

    it("keeps the protected Mark Clean: the sheet is gated on the session's required items", async () => {
      seedSession("room-108", false, { startedAt: startedMinutesAgo(5) });
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("focus-mark-clean")).toBeTruthy());
      fireEvent.press(getByTestId("focus-mark-clean"));

      // Required items still open on the server-snapshotted checklist: the sheet says what is unfinished
      // and routes to the detail screen instead of exposing a shortcut around the gate.
      await waitFor(() => expect(getByTestId("mark-clean-blocked-checklist_incomplete")).toBeTruthy());
      expect(getByText(/0 of 2 done/)).toBeTruthy();
      expect(getByTestId("mark-clean-missing")).toBeTruthy();
      expect(queryByTestId("mark-clean-hold")).toBeNull();
      expect(queryByTestId("mark-clean-tap")).toBeNull();

      fireEvent.press(getByTestId("mark-clean-open-room"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-108");
    });

    it("offers the hold-to-confirm and its tap alternative once every required checklist item is done", async () => {
      seedSession("room-108", true, { startedAt: startedMinutesAgo(5) });
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("focus-mark-clean")).toBeTruthy());
      fireEvent.press(getByTestId("focus-mark-clean"));

      await waitFor(() => expect(getByTestId("mark-clean-hold")).toBeTruthy());
      expect(getByText("2 of 2 required items")).toBeTruthy();
      expect(getByTestId("mark-clean-new-status")).toBeTruthy();
      expect(getByTestId("mark-clean-tap")).toBeTruthy();
      expect(queryByTestId("mark-clean-open-room")).toBeNull();
    });

    it("does not offer the quick Mark Clean for a departure clean", async () => {
      setRooms([makeRoom("108", { status: "IN_PROGRESS", clean_type: "DEP" }), makeRoom("112")]);
      seedSession("room-108", true, { startedAt: startedMinutesAgo(5), cleanType: "DEP" });
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(queryByTestId("focus-mark-clean")).toBeNull();
    });
  });

  /* ─── State 2: started, no active room ───────────────────────────────────── */

  describe("started, no active room", () => {
    beforeEach(() => {
      setRooms([
        makeRoom("112", { clean_type: "DEP", floor: 2, sequence_order: 1 }),
        makeRoom("115", { clean_type: "LIGHT", sequence_order: 2 }),
        makeRoom("101", { status: "INSPECTED" }),
      ]);
    });

    it("recommends the first eligible room and starts nothing by itself", async () => {
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(getByText("Right now — recommended")).toBeTruthy();
      expect(getByTestId("current-room-number").props.children).toBe("112");
      expect(getByText("Departure · Floor 2")).toBeTruthy();

      fireEvent.press(getByTestId("focus-primary"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-112");
      expect(mockStartShift).not.toHaveBeenCalled();
    });

    it("explains the recommendation in a drawer, from verified facts only", async () => {
      const { getByTestId, getByText, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-why")).toBeTruthy());
      expect(queryByTestId("why-sheet")).toBeNull();

      fireEvent.press(getByTestId("focus-why"));
      expect(getByTestId("why-sheet")).toBeTruthy();
      expect(getByText("Why Room 112 next?")).toBeTruthy();
      expect(getByText("Stop 1 in your supervisor's route.")).toBeTruthy();
      // an estimate, labelled as one: never a promise
      expect(getByText(/an estimate, not a deadline/)).toBeTruthy();
      // no invented proximity, scores or rule names
      expect(queryByTestId("why-changed")).toBeNull();

      fireEvent.press(getByTestId("why-open-room"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-112");
    });

    it("shows a rush room first with its priority and deadline", async () => {
      const neededBy = new Date(Date.now() + 2 * 3600_000).toISOString();
      setRooms([
        makeRoom("112"),
        makeRoom("118", { priority: 1, priority_reason: "vip", priority_needed_by: neededBy }),
      ]);
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("current-room-headline")).toBeTruthy());
      expect(getByTestId("current-room-number").props.children).toBe("118");
      expect(getByTestId("current-room-headline").props.children).toMatch(/VIP · Needed by \d{1,2}:\d{2}/);
    });

    it("never recommends a Do Not Disturb room, and says why it is waiting", async () => {
      setRooms([
        makeRoom("214", { dnd_flag: true, status: "OCCUPIED", dnd_retry_at: new Date(Date.now() + 3600_000).toISOString() }),
        makeRoom("215"),
      ]);
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(getByTestId("current-room-number").props.children).toBe("215");
      expect(getByText("Room 214 · DND")).toBeTruthy();
      expect(getByText(/Retry at \d{1,2}:\d{2}/)).toBeTruthy();
    });

    it("shows up next without repeating the lead room, and routes to My Rooms", async () => {
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("up-next")).toBeTruthy());
      expect(getByText("Room 115")).toBeTruthy();

      fireEvent.press(getByTestId("up-next-route"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms");
    });

    it("hides Up Next when no other eligible room exists", async () => {
      setRooms([makeRoom("112")]);
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(queryByTestId("up-next")).toBeNull();
    });

    it("counts progress from the shared model: the inspected room is complete, nothing is double counted", async () => {
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("shift-progress-card")).toBeTruthy());
      expect(getByText("1 of 3 completed")).toBeTruthy();
      expect(getByTestId("progress-to-clean").props.accessibilityLabel).toBe("2 To clean");
      expect(getByTestId("progress-in-progress").props.accessibilityLabel).toBe("0 In progress");
      expect(getByTestId("progress-attention").props.accessibilityLabel).toBe("0 Need attention");
    });

    it("never counts an out-of-service room as cleaned", async () => {
      setRooms([makeRoom("112"), makeRoom("113", { status: "OOO" }), makeRoom("114", { status: "OUT_OF_SERVICE" })]);
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("shift-progress-card")).toBeTruthy());
      expect(getByText("0 of 1 completed")).toBeTruthy();
      expect(getByText("2 out of service")).toBeTruthy();
    });

    it("opens the shift details drawer from the progress card, and the rows reconcile", async () => {
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("shift-progress-card")).toBeTruthy());
      expect(queryByTestId("progress-sheet")).toBeNull();

      fireEvent.press(getByTestId("progress-details"));
      expect(getByTestId("progress-sheet")).toBeTruthy();
      expect(getByTestId("progress-value-assigned").props.children).toBe(3);
      const sum = ["completed", "toClean", "inProgress", "needsAttention", "unavailable"]
        .map((key) => getByTestId(`progress-value-${key}`).props.children as number)
        .reduce((a, b) => a + b, 0);
      expect(sum).toBe(3);
    });
  });

  /* ─── State 4: room submitted ────────────────────────────────────────────── */

  describe("room submitted", () => {
    it("says a queued completion is saved, not confirmed, and suggests the next room", async () => {
      setRooms([makeRoom("108", { status: "IN_PROGRESS" }), makeRoom("112")]);
      seedSession("room-108", true, { completeRequestedAt: new Date().toISOString() });
      const { getByTestId, getByText, queryByText } = renderHome();

      await waitFor(() => expect(getByTestId("submission-banner")).toBeTruthy());
      expect(getByText("Room 108 finished")).toBeTruthy();
      expect(getByText(/not sent yet\. It isn't confirmed until it sends/)).toBeTruthy();
      expect(queryByText(/Room 108 submitted/)).toBeNull();
      expect(getByTestId("current-room-number").props.children).toBe("112");
      // not counted as complete until the server says so
      expect(getByText("0 of 2 completed")).toBeTruthy();
    });

    it("distinguishes a confirmed submission, and lets the person dismiss it", async () => {
      setRooms([makeRoom("108", { status: "CLEAN" }), makeRoom("112")]);
      const finishedAt = new Date(Date.now() - 60_000).toISOString();
      seedSession("room-108", true, { completionConfirmed: true, completeRequestedAt: finishedAt, endedAt: finishedAt });
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByText("Room 108 submitted")).toBeTruthy());
      expect(getByText(/Confirmed and counted as Clean/)).toBeTruthy();
      expect(getByText("1 of 2 completed")).toBeTruthy();

      fireEvent.press(getByTestId("submission-dismiss"));
      expect(queryByTestId("submission-banner")).toBeNull();
    });

    it("keeps a passed inspection separate from the person's own submission", async () => {
      setRooms([makeRoom("108", { status: "INSPECTED" }), makeRoom("112")]);
      const finishedAt = new Date(Date.now() - 60_000).toISOString();
      seedSession("room-108", true, { completionConfirmed: true, completeRequestedAt: finishedAt, endedAt: finishedAt });
      const { getByText } = renderHome();
      await waitFor(() => expect(getByText("Room 108 inspected")).toBeTruthy());
    });
  });

  /* ─── State 5: needs attention ───────────────────────────────────────────── */

  describe("needs attention", () => {
    it("leads with the issues when there is nothing left to start", async () => {
      setRooms([makeRoom("214", { dnd_flag: true, status: "OCCUPIED", dnd_retry_at: new Date(Date.now() + 3600_000).toISOString() })]);
      const screen = renderHome();
      await waitFor(() => expect(screen.getByTestId("needs-attention")).toBeTruthy());
      expect(screen.queryByTestId("focus-card")).toBeNull();
      expect(screen.getByText("Room 214 · DND")).toBeTruthy();
    });

    it("shows a reclean as work to do, with its corrections", async () => {
      setRooms([makeRoom("310", { reclean_requested_at: new Date().toISOString(), reclean_corrections: ["Bathroom mirror", "Under bed"] }), makeRoom("112")]);
      const { getByTestId, getAllByText } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(getAllByText(/2 corrections requested/).length).toBeGreaterThan(0);
    });

    it("previews a few items, counts the rest, and sends View All to the Attention Center", async () => {
      setRooms([
        makeRoom("211", { dnd_flag: true, status: "OCCUPIED" }),
        makeRoom("212", { dnd_flag: true, status: "OCCUPIED" }),
        makeRoom("213", { dnd_flag: true, status: "OCCUPIED" }),
        makeRoom("214", { dnd_flag: true, status: "OCCUPIED" }),
        makeRoom("112"),
      ]);
      const { getByTestId, getByText, queryByText } = renderHome();
      await waitFor(() => expect(getByTestId("needs-attention")).toBeTruthy());
      expect(getByText("Room 211 · DND")).toBeTruthy();
      expect(getByText("Room 212 · DND")).toBeTruthy();
      expect(queryByText("Room 213 · DND")).toBeNull();
      expect(getByText("View all (4)")).toBeTruthy();
      expect(getByTestId("attention-view-all").props.accessibilityLabel).toBe("View all, 2 more need attention");

      fireEvent.press(getByTestId("attention-view-all"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/attention");
    });

    it("explains a restricted room in the issue drawer first, and never offers to start it", async () => {
      setRooms([makeRoom("214", { dnd_flag: true, status: "OCCUPIED" }), makeRoom("112")]);
      const { getByTestId, queryByText, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("attention-room:room-214:dnd")).toBeTruthy());
      fireEvent.press(getByTestId("attention-room:room-214:dnd"));

      expect(getByTestId("issue-sheet")).toBeTruthy();
      expect(getByTestId("issue-headline").props.children).toBe("Do not disturb");
      expect(getByTestId("issue-wait-notice")).toBeTruthy();
      expect(queryByText(/start cleaning/i)).toBeNull();
      expect(queryByTestId("focus-primary")).toBeTruthy(); // Home's own lead card is for room 112, not 214

      fireEvent.press(getByTestId("issue-view-room"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-214");
    });

    it("surfaces an unread supervisor message and marks it read (nothing more) on 'Mark as read'", async () => {
      setRooms([makeRoom("112"), makeRoom("115")]);
      mockListNotifications.mockResolvedValue({
        data: [
          {
            id: "note-1",
            type: "direct_message",
            title: "Message from supervisor",
            body: "Skip the deep clean on 105 — take 115 straight after 108.",
            data: {},
            is_read: false,
            created_at: "2026-05-26T09:12:00.000Z",
          },
        ],
      });
      const { getByText, getByTestId, queryByText } = renderHome();

      await waitFor(() => expect(getByTestId("attention-message:note-1")).toBeTruthy());
      expect(getByText("Message from supervisor")).toBeTruthy();
      expect(getByText("Skip the deep clean on 105 — take 115 straight after 108.")).toBeTruthy();

      // once the server has recorded it, the unread list no longer returns it
      mockMarkRead.mockImplementationOnce(async () => {
        mockListNotifications.mockResolvedValue({ data: [] });
      });
      fireEvent.press(getByTestId("attention-mark-read"));
      expect(mockMarkRead).toHaveBeenCalledWith("note-1");
      // the write resolves asynchronously, then the list is re-read; let both settle
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(queryByText("Message from supervisor")).toBeNull();
    });

    it("keeps the message unread and says so when marking it read fails", async () => {
      setRooms([makeRoom("112"), makeRoom("115")]);
      mockMarkRead.mockRejectedValue(new Error("server down"));
      mockListNotifications.mockResolvedValue({
        data: [
          { id: "note-1", type: "direct_message", title: "Message from supervisor", body: "Do 115 first.", data: {}, is_read: false, created_at: "2026-05-26T09:12:00.000Z" },
        ],
      });
      const { getByTestId, getByText } = renderHome();

      // quick action on the preview: the message stays
      await waitFor(() => expect(getByTestId("attention-mark-read")).toBeTruthy());
      fireEvent.press(getByTestId("attention-mark-read"));
      await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("note-1"));
      await waitFor(() => expect(getByTestId("attention-message:note-1")).toBeTruthy());

      // in the drawer: the failure is stated and the message is still unread
      fireEvent.press(getByTestId("attention-message:note-1"));
      fireEvent.press(getByTestId("message-mark-read"));
      await waitFor(() => expect(getByTestId("message-error")).toBeTruthy());
      expect(getByText(/still unread/)).toBeTruthy();
      expect(getByTestId("message-sheet")).toBeTruthy();
      expect(getByTestId("attention-message:note-1")).toBeTruthy();
    });

    it("opens the full message in a drawer: real time, no invented sender, link only when verifiable", async () => {
      setRooms([makeRoom("112"), makeRoom("115")]);
      mockListNotifications.mockResolvedValue({
        data: [
          { id: "note-1", type: "direct_message", title: "Message from supervisor", body: "Finish 112, then do 115.", data: { room_id: "room-115" }, is_read: false, created_at: "2026-05-26T14:15:00.000Z" },
        ],
      });
      const { getByTestId, queryByText } = renderHome();
      await waitFor(() => expect(getByTestId("attention-message:note-1")).toBeTruthy());

      fireEvent.press(getByTestId("attention-message:note-1"));
      expect(getByTestId("message-sheet")).toBeTruthy();
      expect(getByTestId("message-body").props.children).toBe("Finish 112, then do 115.");
      expect(getByTestId("message-meta").props.children).toMatch(/^Sent /);
      expect(queryByText(/From /)).toBeNull();

      fireEvent.press(getByTestId("message-open-link"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-115");
    });

    it("offers no room link when the referenced room is not on this person's list", async () => {
      setRooms([makeRoom("112")]);
      mockListNotifications.mockResolvedValue({
        data: [
          { id: "note-2", type: "direct_message", title: "Message from supervisor", body: "Look at 999.", data: { room_id: "room-999" }, is_read: false, created_at: "2026-05-26T14:15:00.000Z" },
        ],
      });
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("attention-message:note-2")).toBeTruthy());
      fireEvent.press(getByTestId("attention-message:note-2"));
      expect(getByTestId("message-sheet")).toBeTruthy();
      expect(queryByTestId("message-open-link")).toBeNull();
    });
  });

  /* ─── State 1: before the shift ──────────────────────────────────────────── */

  describe("before the shift", () => {
    beforeEach(() => {
      mockShiftCurrent = { data: null, meta: { last_ended: null } };
      setRooms([makeRoom("112"), makeRoom("115"), makeRoom("120", { priority: 1, priority_reason: "vip", priority_needed_by: new Date(Date.now() + 3 * 3600_000).toISOString() })]);
    });

    it("never starts a shift when Home opens — Start shift is an explicit tap", async () => {
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("shift-start")).toBeTruthy());
      expect(getByText("Ready for your shift?")).toBeTruthy();
      expect(getByText("3 rooms assigned today")).toBeTruthy();
      expect(getByText("1 rush room")).toBeTruthy();
      expect(mockStartShift).not.toHaveBeenCalled();
      expect(queryByTestId("focus-card")).toBeNull();

      fireEvent.press(getByTestId("shift-start"));
      await waitFor(() => expect(mockStartShift).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(queryByTestId("shift-start")).toBeNull());
      await waitFor(() => expect(getByTestId("shift-control-active")).toBeTruthy());
    });

    it("offers Review assignments, which opens My Rooms without starting the shift", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("shift-review")).toBeTruthy());
      fireEvent.press(getByTestId("shift-review"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms");
      expect(mockStartShift).not.toHaveBeenCalled();
    });

    it("offers no Start Shift while offline: the server cannot confirm it, and the shift is not guessed", async () => {
      mockIsOnline = false;
      mockShiftCurrentFails = true;
      const { getByTestId, queryByTestId, queryByText } = renderHome();
      await waitFor(() => expect(getByTestId("shift-control-unknown")).toBeTruthy());
      expect(queryByTestId("shift-start")).toBeNull();
      expect(queryByText("Ready for your shift?")).toBeNull();
      expect(mockStartShift).not.toHaveBeenCalled();
    });

    it("explains why Start Shift is unavailable when the shift is known but the phone is offline", async () => {
      const { getByTestId, getByText, rerender } = renderHome();
      await waitFor(() => expect(getByTestId("shift-start")).toBeTruthy());
      mockIsOnline = false;
      rerender(
        <ThemeProvider>
          <ToastProvider>
            <HousekeeperHomeScreen />
          </ToastProvider>
        </ThemeProvider>,
      );
      await waitFor(() => expect(getByText("You need a connection to do that.")).toBeTruthy());
      fireEvent.press(getByTestId("shift-start"));
      expect(mockStartShift).not.toHaveBeenCalled();
    });

    it("still reaches the room already open when the shift was never started, with a quiet Start Shift", async () => {
      seedSession("room-112", false, { startedAt: new Date(Date.now() - 60_000).toISOString() });
      setRooms([makeRoom("112", { status: "IN_PROGRESS" }), makeRoom("115")]);
      const { getByTestId, queryByText } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(getByTestId("shift-start-nudge")).toBeTruthy();
      expect(queryByText("Ready for your shift?")).toBeNull();
    });
  });

  /* ─── State 6 / 7: no assignments, offline, failed ───────────────────────── */

  describe("no assignments, failed and offline data", () => {
    it("shows a calm empty state only when the server confirmed zero rooms", async () => {
      setRooms([]);
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("board-empty")).toBeTruthy());
      expect(getByText("No rooms assigned yet")).toBeTruthy();
      expect(queryByTestId("shift-progress-card")).toBeNull();
      expect(queryByTestId("board-unavailable")).toBeNull();
      expect(getByTestId("empty-my-rooms")).toBeTruthy();
    });

    it("Refresh assignments asks the server again, once per tap burst", async () => {
      setRooms([]);
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("empty-refresh")).toBeTruthy());
      const { api } = require("@/lib/api/client");
      api.get.mockClear();

      fireEvent.press(getByTestId("empty-refresh"));
      fireEvent.press(getByTestId("empty-refresh"));
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      const roomRequests = api.get.mock.calls.filter(([path]: [string]) => !path.startsWith("/shifts") && !path.startsWith("/clean-sessions"));
      expect(roomRequests.length).toBeLessThanOrEqual(2);
    });

    it("says 'Couldn't load your shift' — never 'no assignments' — when the request fails with no cache", async () => {
      mockStoreRooms = [];
      mockCachedRooms = [];
      mockRoomsRequestFails = true;
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("board-unavailable")).toBeTruthy());
      expect(getByText("Couldn't load your shift.")).toBeTruthy();
      expect(queryByTestId("board-empty")).toBeNull();
      expect(queryByTestId("focus-card")).toBeNull();
      expect(getByTestId("unavailable-retry")).toBeTruthy();
    });

    it("keeps the cached work visible when offline, and says it is offline", async () => {
      mockIsOnline = false;
      setRooms([makeRoom("112"), makeRoom("115")]);
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(getByTestId("home-notice-offline")).toBeTruthy();
      expect(getByText("You're offline")).toBeTruthy();
      expect(getByTestId("home-sync-line").props.accessibilityLabel).toMatch(/^Offline/);
      expect(queryByTestId("board-unavailable")).toBeNull();
    });

    it("tells a failed refresh apart from being offline, and keeps the cached work", async () => {
      setRooms([makeRoom("112"), makeRoom("115")]);
      mockRoomsRequestFails = true;
      const { getByTestId, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      await waitFor(() => expect(getByTestId("home-notice-refresh_failed")).toBeTruthy());
      expect(queryByTestId("home-notice-offline")).toBeNull();
    });

    it("does not guess when the shift cannot be read — no clock-in, no clock-out", async () => {
      mockShiftCurrentFails = true;
      const { getByTestId, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("shift-control-unknown")).toBeTruthy());
      expect(queryByTestId("shift-start")).toBeNull();
      expect(mockStartShift).not.toHaveBeenCalled();
      expect(mockEndShift).not.toHaveBeenCalled();
      // the work is still reachable
      expect(getByTestId("focus-card")).toBeTruthy();
    });
  });

  /* ─── State 8: on break ──────────────────────────────────────────────────── */

  describe("on break", () => {
    it("takes a break and resumes through the shifts API, with no work offered meanwhile", async () => {
      const { getByTestId, queryByTestId, getByText } = renderHome();

      await waitFor(() => expect(getByTestId("shift-break")).toBeTruthy());
      fireEvent.press(getByTestId("shift-break"));
      await waitFor(() => expect(getByTestId("shift-resume")).toBeTruthy());
      expect(queryByTestId("shift-break")).toBeNull();
      expect(getByText("You're on break.")).toBeTruthy();
      expect(queryByTestId("focus-card")).toBeNull();
      expect(queryByTestId("up-next")).toBeNull();
      expect(getByTestId("break-summary")).toBeTruthy();

      fireEvent.press(getByTestId("shift-resume"));
      await waitFor(() => expect(getByTestId("shift-break")).toBeTruthy());
      expect(mockShiftBreak).toHaveBeenCalledTimes(2);
    });

    it("shows the real break start, never an invented duration", async () => {
      mockShiftCurrent = {
        data: activeShift({ status: "on_break", on_break_since: new Date(Date.now() - 300_000).toISOString() }),
        meta: { last_ended: null },
      };
      const { getByTestId, queryByText } = renderHome();
      await waitFor(() => expect(getByTestId("break-since")).toBeTruthy());
      expect(getByTestId("break-since").props.children).toMatch(/^On break since \d{1,2}:\d{2}/);
      expect(queryByText(/minutes? left|remaining/i)).toBeNull();
    });
  });

  /* ─── State 9: clocked out and the end of the shift ──────────────────────── */

  describe("end of shift and clocked out", () => {
    const doneRooms = () => [makeRoom("108", { status: "CLEAN" }), makeRoom("101", { status: "INSPECTED" })];

    async function openReview(screen: ReturnType<typeof renderHome>) {
      await waitFor(() => expect(screen.getByTestId("all-handled")).toBeTruthy());
      fireEvent.press(screen.getByTestId("review-shift"));
      await waitFor(() => expect(screen.getByTestId("finish-shift-sheet")).toBeTruthy());
    }

    it("offers the review when every room is handled, and clocks out through the shifts API only from inside it", async () => {
      setRooms(doneRooms());
      const screen = renderHome();
      const { getByTestId, getByText, queryByTestId } = screen;

      await waitFor(() => expect(getByTestId("all-handled")).toBeTruthy());
      // Home itself never clocks anyone out.
      expect(queryByTestId("clock-out-button")).toBeNull();
      expect(mockEndShift).not.toHaveBeenCalled();
      // Completed (submitted + inspected) — not claimed as "cleaned by you".
      expect(getByText("2 rooms completed")).toBeTruthy();

      await openReview(screen);
      expect(getByTestId("review-completed")).toBeTruthy();
      expect(mockEndShift).not.toHaveBeenCalled();

      fireEvent.press(getByTestId("finish-shift-clock-out"));
      await waitFor(() => expect(mockEndShift).toHaveBeenCalled());
      await waitFor(() => expect(getByTestId("shift-control-ended")).toBeTruthy());
      expect(getByText("Shift complete")).toBeTruthy();
      expect(getByTestId("clocked-out-summary-open")).toBeTruthy();
    });

    it("sends one clock-out for a double tap and only claims success after the server confirms", async () => {
      setRooms(doneRooms());
      type EndRow = ReturnType<typeof endedShiftRow>;
      let resolveEnd: (value: EndRow) => void = () => undefined;
      mockEndShift.mockImplementationOnce(() => new Promise<EndRow>((resolve) => { resolveEnd = resolve; }));

      const screen = renderHome();
      const { getByTestId, getByText, queryByText, queryByTestId } = screen;
      await openReview(screen);

      fireEvent.press(getByTestId("finish-shift-clock-out"));
      fireEvent.press(getByTestId("finish-shift-clock-out"));

      await waitFor(() => expect(mockEndShift).toHaveBeenCalledTimes(1));
      // Still waiting on the server: not clocked out yet.
      expect(queryByText("Shift complete")).toBeNull();
      expect(queryByTestId("shift-control-ended")).toBeNull();

      await act(async () => {
        resolveEnd(endedShiftRow());
      });
      await waitFor(() => expect(getByText("Shift complete")).toBeTruthy());
      expect(mockEndShift).toHaveBeenCalledTimes(1);
    });

    it("keeps the shift open, says so, and offers clock-out again when the server rejects it", async () => {
      setRooms(doneRooms());
      mockEndShift.mockRejectedValueOnce(new Error("server error"));

      const screen = renderHome();
      const { getByTestId, queryByText } = screen;
      await openReview(screen);

      fireEvent.press(getByTestId("finish-shift-clock-out"));

      await waitFor(() => expect(mockEndShift).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getByTestId("finish-shift-error")).toBeTruthy());
      expect(getByTestId("finish-shift-clock-out").props.accessibilityState?.disabled).not.toBe(true);
      expect(queryByText("Shift complete")).toBeNull();

      // A safe retry succeeds.
      fireEvent.press(getByTestId("finish-shift-clock-out"));
      await waitFor(() => expect(getByTestId("shift-control-ended")).toBeTruthy());
      expect(mockEndShift).toHaveBeenCalledTimes(2);
    });

    it("does not clock out while offline (the server cannot confirm it) and says why", async () => {
      setRooms(doneRooms());
      mockIsOnline = false;

      const screen = renderHome();
      const { getByTestId } = screen;
      await openReview(screen);

      expect(getByTestId("finish-shift-offline")).toBeTruthy();
      fireEvent.press(getByTestId("finish-shift-clock-out"));
      expect(mockEndShift).not.toHaveBeenCalled();
    });

    it("is a stable Shift Complete after clock-out — reopening Home never starts another shift", async () => {
      setRooms(doneRooms());
      const endedAt = new Date().toISOString();
      mockShiftCurrent = {
        data: null,
        meta: { last_ended: activeShift({ id: "shift-0", status: "ended", started_at: new Date(Date.now() - 3600_000).toISOString(), ended_at: endedAt }) },
      };

      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("shift-control-ended")).toBeTruthy());
      expect(getByText("Shift complete")).toBeTruthy();
      expect(getByText(/Clocked out at \d{1,2}:\d{2}/)).toBeTruthy();
      expect(getByText("2 rooms completed")).toBeTruthy();
      expect(queryByTestId("shift-start")).toBeNull();
      expect(queryByTestId("focus-card")).toBeNull();
      expect(queryByTestId("all-handled")).toBeNull();
      expect(mockStartShift).not.toHaveBeenCalled();
      // Starting again is possible, but only on purpose.
      expect(getByTestId("shift-start-new")).toBeTruthy();

      fireEvent.press(getByTestId("clocked-out-rooms"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms");
    });

    it("opens the shift summary from the clocked-out Home, with no AI request made for it", async () => {
      setRooms(doneRooms());
      mockShiftCurrent = {
        data: null,
        meta: { last_ended: activeShift({ id: "shift-0", status: "ended", started_at: new Date(Date.now() - 3600_000).toISOString(), ended_at: new Date().toISOString() }) },
      };
      const { api } = require("@/lib/api/client");
      const { getByTestId, getByText, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("clocked-out-summary-open")).toBeTruthy());
      api.post.mockClear();

      fireEvent.press(getByTestId("clocked-out-summary-open"));
      await waitFor(() => expect(getByTestId("shift-summary-sheet")).toBeTruthy());
      expect(getByTestId("summary-clock-in")).toBeTruthy();
      expect(getByTestId("summary-clock-out")).toBeTruthy();
      expect(getByTestId("summary-submitted")).toBeTruthy();
      expect(getByText("Add AI recap")).toBeTruthy();
      expect(queryByTestId("summary-recap")).toBeNull();
      // Opening Home or its summary never buys a recap.
      expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining("/ai/"), expect.anything());
    });
  });

  /* ─── Header, notifications, localisation, theme, accessibility ──────────── */

  describe("header and notifications", () => {
    it("shows the hotel-local date and part of day, a greeting by first name, and the real shift status", async () => {
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("home-header")).toBeTruthy());
      expect(getByText(/^[A-Z]+, [A-Z]{3} \d{1,2} · (MORNING|AFTERNOON|EVENING)$/)).toBeTruthy();
      expect(getByText(/Good (morning|afternoon|evening), Maria\./)).toBeTruthy();
      expect(getByTestId("home-shift-status").props.children).toBe("Your shift is underway.");
    });

    it("opens the notifications route from the bell and shows the real unread count", async () => {
      mockUnread = 3;
      const { getByTestId, getByLabelText } = renderHome();
      await waitFor(() => expect(getByTestId("home-notifications")).toBeTruthy());
      expect(getByTestId("home-notifications-badge")).toBeTruthy();
      const bell = getByLabelText("Notifications, 3 unread");
      expect(bell.props.accessibilityRole).toBe("button");
      expect(flat(bell.props.style).minHeight ?? flat(bell.props.style).height).toBeGreaterThanOrEqual(48);

      fireEvent.press(bell);
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/notifications");
    });

    it("has no badge when nothing is unread", async () => {
      const { getByTestId, queryByTestId, getByLabelText } = renderHome();
      await waitFor(() => expect(getByTestId("home-notifications")).toBeTruthy());
      expect(queryByTestId("home-notifications-badge")).toBeNull();
      expect(getByLabelText("Notifications")).toBeTruthy();
    });

    it("says 'All changes synced' only when nothing waits and the list is fresh", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("home-sync-line").props.accessibilityLabel).toMatch(/^All changes synced · \d{1,2}:\d{2}/));
    });
  });

  describe("localisation, theme and accessibility", () => {
    it("renders in Spanish, including the new cards", async () => {
      mockLanguage = "es";
      seedSession("room-108", false, { startedAt: new Date(Date.now() - 60_000).toISOString() });
      const { getByText, getByTestId, queryByText } = renderHome();

      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      expect(getByText("Ahora mismo — en curso")).toBeTruthy();
      expect(getByText("Continuar limpieza")).toBeTruthy();
      expect(getByText("Tu progreso")).toBeTruthy();
      expect(getByText(/Lista de limpieza: 0 de 3/)).toBeTruthy();
      expect(getByText(/Tu turno está en curso\./)).toBeTruthy();
      // no English left behind and no raw key
      expect(queryByText(/Continue cleaning|Your progress|Right now/)).toBeNull();
      expect(queryByText(/^home\./)).toBeNull();
    });

    it("follows the language picked in the app, not a stale saved preference", async () => {
      mockLanguage = "es";
      mockLanguagePref = "en";
      seedSession("room-108", false, { startedAt: new Date(Date.now() - 60_000).toISOString() });
      const { getByText, getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-card")).toBeTruthy());
      // the date line and the cards agree: Spanish both
      expect(getByText(/^(LUNES|MARTES|MIÉRCOLES|JUEVES|VIERNES|SÁBADO|DOMINGO),/i)).toBeTruthy();
      expect(getByText("Continuar limpieza")).toBeTruthy();
    });

    it("keeps a notice's own buttons reachable by assistive tech instead of swallowing them in one group", async () => {
      mockIsOnline = false;
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("home-notice-offline")).toBeTruthy());
      const notice = getByTestId("home-notice-offline");
      expect(notice.props.accessible).not.toBe(true);
      expect(notice.props.accessibilityRole).toBe("alert");
      expect(getByTestId("notice-sync-status").props.accessibilityRole).toBe("button");
    });

    it("never says it is checking the shift when the shift could not be read", async () => {
      mockShiftCurrentFails = true;
      const { getByTestId, queryByText } = renderHome();
      await waitFor(() => expect(getByTestId("shift-control-unknown")).toBeTruthy());
      expect(queryByText(/Checking your shift/)).toBeNull();
    });

    it("renders the before-shift and empty states in Spanish", async () => {
      mockLanguage = "es";
      mockShiftCurrent = { data: null, meta: { last_ended: null } };
      setRooms([makeRoom("112"), makeRoom("115")]);
      const { getByText, getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("shift-start")).toBeTruthy());
      expect(getByText("¿Listo para tu turno?")).toBeTruthy();
      expect(getByText("2 cuartos asignados hoy")).toBeTruthy();
      expect(getByText("Revisar asignaciones")).toBeTruthy();
    });

    it("uses theme tokens: dark mode swaps the semantic text colour, light is untouched", async () => {
      setRooms([makeRoom("112"), makeRoom("101", { status: "INSPECTED" })]);
      const light = renderHome();
      await waitFor(() => expect(light.getByText("1 of 2 completed")).toBeTruthy());
      expect(flat(light.getByText("1 of 2 completed").props.style).color).toBe(lightTheme.textPrimary);
      light.unmount();

      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
      const dark = renderHome();
      await waitFor(() => expect(flat(dark.getByText("1 of 2 completed").props.style).color).toBe(darkTheme.textPrimary));
    });

    it("lets text scale up to a ceiling and exposes roles and states for assistive tech", async () => {
      setRooms([makeRoom("112"), makeRoom("101", { status: "INSPECTED" })]);
      const { getByText, getByTestId, getByLabelText } = renderHome();
      await waitFor(() => expect(getByTestId("shift-progress-card")).toBeTruthy());

      expect(getByText(/Good (morning|afternoon|evening), Maria\./).props.maxFontSizeMultiplier).toBe(1.6);
      expect(getByText("1 of 2 completed").props.maxFontSizeMultiplier).toBe(1.6);

      const bar = getByLabelText("1 of 2 completed", { exact: true });
      expect(bar.props.accessibilityRole).toBe("progressbar");
      expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 2, now: 1 });

      const why = getByTestId("focus-why");
      expect(why.props.accessibilityRole).toBe("button");
      expect(why.props.accessibilityLabel).toBe("Why room 112 is recommended");
      const more = getByTestId("focus-more");
      expect(more.props.accessibilityRole).toBe("button");
      expect(more.props.accessibilityLabel).toBe("More actions for room 112");
      expect(flat(more.props.style).minHeight).toBeGreaterThanOrEqual(48);
    });

    it("keeps the shift briefing in a drawer, out of the way of the work and free until asked", async () => {
      const { api } = require("@/lib/api/client");
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("briefing-open")).toBeTruthy());
      // Nothing competes with the room to clean on Home, and nothing is bought by looking.
      expect(queryByTestId("ai-briefing-card")).toBeNull();
      expect(queryByTestId("briefing-toggle")).toBeNull();
      expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining("/ai/"), expect.anything());

      fireEvent.press(getByTestId("briefing-open"));
      await waitFor(() => expect(getByTestId("briefing-sheet")).toBeTruthy());
      expect(getByTestId("briefing-source")).toBeTruthy();
      expect(getByTestId("briefing-new")).toBeTruthy();
      expect(getByTestId("briefing-ask-ai")).toBeTruthy();
      expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining("/ai/"), expect.anything());
    });

    it("leaves room under the content for the floating Copilot", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("home-scroll")).toBeTruthy());
      expect(flat(getByTestId("home-scroll").props.contentContainerStyle).paddingBottom).toBeGreaterThanOrEqual(100);
    });
  });

  /* ─── Phase 3: drawers ───────────────────────────────────────────────────── */

  describe("room actions drawer", () => {
    const { router } = require("expo-router");

    beforeEach(() => {
      // a started shift with nothing open: Home leads with the recommended room 112
      setRooms([makeRoom("112"), makeRoom("115"), makeRoom("101", { status: "INSPECTED" })]);
    });

    it("opens from More on the recommended room and lists navigation apart from forms", async () => {
      const { getByTestId, getByText, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-more")).toBeTruthy());
      expect(queryByTestId("room-actions-sheet")).toBeNull();

      fireEvent.press(getByTestId("focus-more"));
      expect(getByTestId("room-actions-sheet")).toBeTruthy();
      expect(getByText("Room 112")).toBeTruthy();
      // the same room facts Home shows: type (when known), floor, and the status as the room screen words it
      expect(within(getByTestId("room-actions-sheet")).getByText("Floor 1 · Vacant Dirty")).toBeTruthy();
      ["open", "info", "note", "issue", "supplies", "exception"].forEach((id) => expect(getByTestId(`room-action-${id}`)).toBeTruthy());
      expect(within(getByTestId("room-action-open")).getByText("Open room")).toBeTruthy();
      expect(getByText(/Nothing is sent until you submit it there/)).toBeTruthy();
    });

    it("opens the room screen for the room it was opened for", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(getByTestId("focus-more"));
      fireEvent.press(getByTestId("room-action-open"));
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-112");
    });

    it("hands a form to the existing room screen with the right room, without sending anything", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(getByTestId("focus-more"));
      const { api } = require("@/lib/api/client");
      api.post.mockClear();
      api.patch.mockClear();
      fireEvent.press(getByTestId("room-action-supplies"));
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-112?action=supplies&from=home");
      expect(api.post).not.toHaveBeenCalled();
      expect(api.patch).not.toHaveBeenCalled();
    });

    it("says 'Continue cleaning' only for the open session, from the active card's More", async () => {
      setRooms([makeRoom("108", { status: "IN_PROGRESS" }), makeRoom("112")]);
      seedSession("room-108", false, { startedAt: new Date(Date.now() - 300_000).toISOString() });
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(getByTestId("focus-more"));
      expect(getByText("Room 108")).toBeTruthy();
      expect(within(getByTestId("room-action-open")).getByText("Continue cleaning")).toBeTruthy();
      // already inside: the pre-entry access form says why it is unavailable
      expect(getByText("Not available once cleaning has started")).toBeTruthy();
    });

    it("is one drawer at a time: opening another replaces it", async () => {
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(getByTestId("focus-more"));
      expect(getByTestId("room-actions-sheet")).toBeTruthy();
      fireEvent.press(getByTestId("focus-why"));
      // The first drawer slides away before the second appears, so two native modals never overlap.
      await waitFor(() => expect(getByTestId("why-sheet")).toBeTruthy());
      expect(queryByTestId("room-actions-sheet")).toBeNull();
    });

    it("dismissing a drawer changes nothing: no navigation, no writes, no shift change", async () => {
      const { getByTestId, getAllByLabelText } = renderHome();
      await waitFor(() => expect(getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(getByTestId("focus-more"));
      const { api } = require("@/lib/api/client");
      api.post.mockClear();
      api.patch.mockClear();
      router.push.mockClear();
      fireEvent.press(getAllByLabelText("Close")[0]);
      expect(router.push).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
      expect(mockStartShift).not.toHaveBeenCalled();
      expect(mockMarkRead).not.toHaveBeenCalled();
    });
  });

  describe("shift progress drawer", () => {
    beforeEach(() => {
      setRooms([makeRoom("112"), makeRoom("115"), makeRoom("101", { status: "INSPECTED" })]);
    });

    it("shows the shift start from the real shift record and the reconciling room rows", async () => {
      mockShiftCurrent = { data: activeShift({ started_at: "2026-10-14T13:00:00.000Z" }), meta: { last_ended: null } };
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("progress-details")).toBeTruthy());
      fireEvent.press(getByTestId("progress-details"));
      expect(getByTestId("progress-sheet-started").props.children).toMatch(/^Shift started /);
      expect(getByTestId("progress-sheet-headline").props.children).toBe("1 of 3 completed");
    });

    it("offers My Rooms for the detail, and closing it leaves Home as it was", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("progress-details")).toBeTruthy());
      fireEvent.press(getByTestId("progress-details"));
      fireEvent.press(getByTestId("progress-open-my-rooms"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms");
    });
  });


  describe("drawers: dismissal, language, theme and accessibility", () => {
    const { Modal, AccessibilityInfo } = require("react-native");

    beforeEach(() => {
      setRooms([makeRoom("112"), makeRoom("115"), makeRoom("101", { status: "INSPECTED" })]);
    });

    it("closes on the Android back button and on the backdrop, and animates out before it unmounts", async () => {
      const screen = renderHome();
      await waitFor(() => expect(screen.getByTestId("focus-more")).toBeTruthy());

      fireEvent.press(screen.getByTestId("focus-more"));
      act(() => {
        screen.UNSAFE_getByType(Modal).props.onRequestClose();
      });
      await waitFor(() => expect(screen.queryByTestId("room-actions-sheet")).toBeNull());

      fireEvent.press(screen.getByTestId("focus-more"));
      expect(screen.getByTestId("room-actions-sheet")).toBeTruthy();
      fireEvent.press(screen.getAllByLabelText("Close")[0]);
      await waitFor(() => expect(screen.queryByTestId("room-actions-sheet")).toBeNull());
    });

    it("has an explicit Close control and a labelled header for assistive tech", async () => {
      const screen = renderHome();
      await waitFor(() => expect(screen.getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(screen.getByTestId("focus-more"));
      const sheet = screen.getByTestId("room-actions-sheet");
      expect(sheet.props.accessibilityViewIsModal).toBe(true);
      expect(within(sheet).getAllByRole("header").length).toBeGreaterThan(0);
      expect(within(sheet).getByLabelText("Close").props.accessibilityRole).toBe("button");
    });

    it("drops the slide animation when the person prefers reduced motion", async () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
      const screen = renderHome();
      await waitFor(() => expect(screen.getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(screen.getByTestId("focus-more"));
      await waitFor(() => expect(screen.UNSAFE_getByType(Modal).props.animationType).toBe("none"));
      jest.restoreAllMocks();
    });

    it("keeps drawer text scalable up to the same ceiling as Home", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("progress-details")).toBeTruthy());
      fireEvent.press(getByTestId("progress-details"));
      expect(getByTestId("progress-sheet-headline").props.maxFontSizeMultiplier).toBe(1.6);
      expect(getByTestId("progress-value-completed").props.maxFontSizeMultiplier).toBe(1.6);
    });

    it("follows dark mode in the drawers", async () => {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("progress-details")).toBeTruthy());
      fireEvent.press(getByTestId("progress-details"));
      await waitFor(() => expect(flat(getByTestId("progress-sheet-headline").props.style).color).toBe(darkTheme.textPrimary));
    });

    it("speaks Spanish in the drawers", async () => {
      mockLanguage = "es";
      const { getByTestId, getByText } = renderHome();
      await waitFor(() => expect(getByTestId("focus-more")).toBeTruthy());
      fireEvent.press(getByTestId("focus-more"));
      expect(getByText("Habitación 112")).toBeTruthy();
      expect(getByText("Reportar problema de acceso")).toBeTruthy();
      fireEvent.press(getByTestId("focus-why"));
      await waitFor(() => expect(getByText("¿Por qué la habitación 112 sigue?")).toBeTruthy());
    });
  });

});

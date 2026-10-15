import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StyleSheet } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
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
    user: { id: "user-1", tenant_id: "hotel-1", full_name: "Maria Vega", role: "housekeeper", language_pref: mockLanguage },
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

      // Required items still open on the server-snapshotted checklist: the sheet routes to the
      // detail screen instead of exposing a shortcut around the gate.
      await waitFor(() => expect(getByTestId("hold-confirm-open-room")).toBeTruthy());
      expect(getByText("Checklist 0 of 2")).toBeTruthy();
      expect(queryByTestId("hold-confirm-button")).toBeNull();

      fireEvent.press(getByTestId("hold-confirm-open-room"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-108");
    });

    it("enables the hold-to-confirm button once every required checklist item is done", async () => {
      seedSession("room-108", true, { startedAt: startedMinutesAgo(5) });
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("focus-mark-clean")).toBeTruthy());
      fireEvent.press(getByTestId("focus-mark-clean"));

      await waitFor(() => expect(getByTestId("hold-confirm-button")).toBeTruthy());
      expect(getByText("Checklist 2 of 2")).toBeTruthy();
      expect(queryByTestId("hold-confirm-open-room")).toBeNull();
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

    it("explains the recommendation inline from verified facts", async () => {
      const { getByTestId, getByText, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("focus-why")).toBeTruthy());
      expect(queryByTestId("focus-why-panel")).toBeNull();

      fireEvent.press(getByTestId("focus-why"));
      expect(getByTestId("focus-why-panel")).toBeTruthy();
      expect(getByText("Stop 1 in your supervisor's route.")).toBeTruthy();
      // an estimate, labelled as one: never a promise
      expect(getByText(/an estimate, not a deadline/)).toBeTruthy();
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

    it("hides 'View shift details' until its destination exists (no dead button)", async () => {
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("shift-progress-card")).toBeTruthy());
      expect(queryByTestId("progress-details")).toBeNull();
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

    it("previews a few items, counts the rest, and sends View All to My Rooms until the Attention Center exists", async () => {
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
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms");
    });

    it("opens the room behind an attention row", async () => {
      setRooms([makeRoom("214", { dnd_flag: true, status: "OCCUPIED" }), makeRoom("112")]);
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("attention-room:room-214:dnd")).toBeTruthy());
      fireEvent.press(getByTestId("attention-room:room-214:dnd"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/room-214");
    });

    it("surfaces an unread supervisor message and acknowledges it on 'Got it'", async () => {
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

      fireEvent.press(getByTestId("attention-got-it"));
      expect(mockMarkRead).toHaveBeenCalledWith("note-1");
      await waitFor(() => expect(queryByText("Message from supervisor")).toBeNull());
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

    it("shows the end-of-shift state with real stats and clocks out through the shifts API", async () => {
      setRooms(doneRooms());
      const { getByTestId, getByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("end-of-shift-state")).toBeTruthy());
      expect(getByText("That's a wrap — every room handled. Be proud of today.")).toBeTruthy();
      // Completed (submitted + inspected) — not claimed as "cleaned by you".
      expect(getByText("2 rooms completed")).toBeTruthy();
      expect(queryByTestId("board-empty")).toBeNull();

      await waitFor(() => expect(getByTestId("clock-out-button")).toBeTruthy());
      fireEvent.press(getByTestId("clock-out-button"));

      await waitFor(() => expect(mockEndShift).toHaveBeenCalled());
      await waitFor(() => expect(getByTestId("shift-control-ended")).toBeTruthy());
      expect(getByText("Shift complete")).toBeTruthy();
      expect(getByText("Clocked out. Nice work today.")).toBeTruthy();
      expect(queryByTestId("clock-out-button")).toBeNull();
    });

    it("sends one clock-out for a double tap and only claims success after the server confirms", async () => {
      setRooms(doneRooms());
      type EndRow = ReturnType<typeof endedShiftRow>;
      let resolveEnd: (value: EndRow) => void = () => undefined;
      mockEndShift.mockImplementationOnce(() => new Promise<EndRow>((resolve) => { resolveEnd = resolve; }));

      const { getByTestId, getByText, queryByText, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("clock-out-button")).toBeTruthy());
      fireEvent.press(getByTestId("clock-out-button"));
      fireEvent.press(getByTestId("clock-out-button"));

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

    it("keeps the shift open and offers clock-out again when the server rejects it", async () => {
      setRooms(doneRooms());
      mockEndShift.mockRejectedValueOnce(new Error("server error"));

      const { getByTestId, queryByText } = renderHome();

      await waitFor(() => expect(getByTestId("clock-out-button")).toBeTruthy());
      fireEvent.press(getByTestId("clock-out-button"));

      await waitFor(() => expect(mockEndShift).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getByTestId("clock-out-button")).toBeTruthy());
      expect(queryByText("Shift complete")).toBeNull();
    });

    it("does not offer clock-out while offline (the server cannot confirm it)", async () => {
      setRooms(doneRooms());
      mockIsOnline = false;

      const { getByTestId, queryByTestId } = renderHome();

      await waitFor(() => expect(getByTestId("end-of-shift-state")).toBeTruthy());
      expect(queryByTestId("clock-out-button")).toBeNull();
      expect(getByTestId("clock-out-hint")).toBeTruthy();
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
      expect(getByText(/Shift ended at \d{1,2}:\d{2}/)).toBeTruthy();
      expect(getByText("2 rooms completed")).toBeTruthy();
      expect(queryByTestId("shift-start")).toBeNull();
      expect(queryByTestId("focus-card")).toBeNull();
      expect(mockStartShift).not.toHaveBeenCalled();
      // Starting again is possible, but only on purpose.
      expect(getByTestId("shift-start-new")).toBeTruthy();

      fireEvent.press(getByTestId("clocked-out-rooms"));
      const { router } = require("expo-router");
      expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms");
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
      expect(why.props.accessibilityState).toMatchObject({ expanded: false });
      fireEvent.press(why);
      expect(getByTestId("focus-why").props.accessibilityState).toMatchObject({ expanded: true });
    });

    it("keeps the AI briefing available but out of the way of the work", async () => {
      const { getByTestId, queryByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("briefing-toggle")).toBeTruthy());
      expect(queryByTestId("ai-briefing-card")).toBeNull();
      fireEvent.press(getByTestId("briefing-toggle"));
      expect(getByTestId("ai-briefing-card")).toBeTruthy();
      expect(getByTestId("briefing-refresh")).toBeTruthy();
      expect(getByTestId("briefing-ask-ai")).toBeTruthy();
    });

    it("leaves room under the content for the floating Copilot", async () => {
      const { getByTestId } = renderHome();
      await waitFor(() => expect(getByTestId("home-scroll")).toBeTruthy());
      expect(flat(getByTestId("home-scroll").props.contentContainerStyle).paddingBottom).toBeGreaterThanOrEqual(100);
    });
  });
});

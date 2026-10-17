import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchHotelDepartments: jest.fn(),
  createShiftNote: jest.fn(),
  sendTeamBroadcast: jest.fn(),
  sendDirectMessage: jest.fn(),
}));
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));

import i18n from "@/i18n";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import ShiftNoteModal from "@/components/supervisor/ShiftNoteModal";
import BroadcastModal from "@/components/supervisor/BroadcastModal";
import DirectMessageModal from "@/components/supervisor/DirectMessageModal";
import { StaffPickerSheet } from "@/components/supervisor/StaffPickerSheet";
import { StaffQuickViewSheet } from "@/components/supervisor/StaffQuickViewSheet";
import { createShiftNote, fetchHotelDepartments, sendDirectMessage, sendTeamBroadcast } from "@/lib/api/housekeepingSupervisor";
import type { AssignableStaff, FloorRoom } from "@/lib/housekeeping/supervisor";
import type { Derived, SourceState } from "@/lib/housekeeping/supervisorSources";
import { buildTeamPulse, normalizeRoster, type RosterEntry, type TeamPulse } from "@/lib/housekeeping/supervisorTeam";

const departments = fetchHotelDepartments as jest.Mock;
const createNote = createShiftNote as jest.Mock;
const broadcast = sendTeamBroadcast as jest.Mock;
const direct = sendDirectMessage as jest.Mock;

const HK_DEPTS = [
  { id: "dept-hk", name: "Housekeeping", code: "HK" },
  { id: "dept-eng", name: "Engineering", code: "ENG" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function disabled(el: { props: { accessibilityState?: { disabled?: boolean } } }) {
  return Boolean(el.props.accessibilityState?.disabled);
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  departments.mockResolvedValue(HK_DEPTS);
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

/* ─── Shift note ──────────────────────────────────────────────────────────── */

describe("Shift note drawer", () => {
  function renderNote(overrides: Partial<React.ComponentProps<typeof ShiftNoteModal>> = {}) {
    const onClose = jest.fn();
    const screen = wrap(<ShiftNoteModal visible tenantId="hotel-1" isOnline onClose={onClose} {...overrides} />);
    return { ...screen, onClose };
  }

  it("shows nothing until opened, and the design's header, description and footer when open", async () => {
    const closed = wrap(<ShiftNoteModal visible={false} tenantId="hotel-1" isOnline onClose={jest.fn()} />);
    expect(closed.queryByTestId("shift-note-sheet")).toBeNull();
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    expect(screen.getByText("Add shift note")).toBeTruthy();
    expect(screen.getByText("Record an important update for your team or the next shift.")).toBeTruthy();
    expect(screen.getByTestId("shift-note-input").props.accessibilityLabel).toBe("Note");
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(screen.getByText("Save note")).toBeTruthy();
    expect(screen.getByTestId("shift-note-department")).toHaveTextContent("Filed under Housekeeping");
  });

  it("cannot save an empty or blank note", async () => {
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    expect(disabled(screen.getByTestId("shift-note-save"))).toBe(true);
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "   ");
    fireEvent.press(screen.getByTestId("shift-note-save"));
    expect(createNote).not.toHaveBeenCalled();
  });

  it("looks up the hotel's departments and saves with the Housekeeping department id", async () => {
    createNote.mockResolvedValue(undefined);
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    expect(departments).toHaveBeenCalledWith("hotel-1");
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Room 308 needs inspection");
    fireEvent.press(screen.getByTestId("shift-note-save"));
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith("dept-hk", "Room 308 needs inspection");
  });

  it("on success: confirms, closes, and leaves no draft behind", async () => {
    createNote.mockResolvedValue(undefined);
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Hello");
    fireEvent.press(screen.getByTestId("shift-note-save"));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalledTimes(1));
    expect(mockToast.success).toHaveBeenCalledWith("Shift note saved.");
    // Opened again, the note starts empty.
    screen.unmount();
    const again = renderNote();
    await waitFor(() => again.getByTestId("shift-note-department"));
    expect(again.getByTestId("shift-note-input").props.value).toBe("");
  });

  it("blocks and explains when the hotel has no Housekeeping department — never files under another one", async () => {
    departments.mockResolvedValue([{ id: "dept-eng", name: "Engineering", code: "ENG" }]);
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department-notice"));
    expect(screen.getByTestId("shift-note-department-notice")).toHaveTextContent(/no Housekeeping department/);
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Hello");
    expect(disabled(screen.getByTestId("shift-note-save"))).toBe(true);
    fireEvent.press(screen.getByTestId("shift-note-save"));
    expect(createNote).not.toHaveBeenCalled();
  });

  it("blocks when two departments look like Housekeeping", async () => {
    departments.mockResolvedValue([{ id: "a", name: "Housekeeping", code: "HK" }, { id: "b", name: "Housekeeping", code: "HK2" }]);
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department-notice"));
    expect(screen.getByTestId("shift-note-department-notice")).toHaveTextContent(/more than one Housekeeping/);
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Hello");
    expect(disabled(screen.getByTestId("shift-note-save"))).toBe(true);
  });

  it("explains a failed department lookup, offers retry, and can recover", async () => {
    departments.mockRejectedValueOnce(new Error("down"));
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department-notice"));
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Hello");
    expect(disabled(screen.getByTestId("shift-note-save"))).toBe(true);
    fireEvent.press(screen.getByTestId("shift-note-department-retry"));
    await waitFor(() => screen.getByTestId("shift-note-department"));
    expect(disabled(screen.getByTestId("shift-note-save"))).toBe(false);
  });

  it("without a hotel it cannot be filed", async () => {
    const screen = renderNote({ tenantId: null });
    await waitFor(() => screen.getByTestId("shift-note-department-notice"));
    expect(departments).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Hello");
    expect(disabled(screen.getByTestId("shift-note-save"))).toBe(true);
  });

  it("on failure: keeps the note, shows an error, no success, and allows a retry", async () => {
    createNote.mockRejectedValueOnce(Object.assign(new Error("bad"), { status: 422 })).mockResolvedValueOnce(undefined);
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Keep me");
    fireEvent.press(screen.getByTestId("shift-note-save"));
    await waitFor(() => screen.getByTestId("shift-note-error"));
    expect(screen.getByTestId("shift-note-error")).toHaveTextContent(/couldn't accept this/);
    expect(screen.getByTestId("shift-note-input").props.value).toBe("Keep me");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.onClose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("shift-note-save"));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledTimes(2);
  });

  it("a request that got no answer says it may have gone through", async () => {
    createNote.mockRejectedValue(new Error("Request timed out. Please try again."));
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Maybe sent");
    fireEvent.press(screen.getByTestId("shift-note-save"));
    await waitFor(() => screen.getByTestId("shift-note-error"));
    expect(screen.getByTestId("shift-note-error")).toHaveTextContent(/may already have been sent/);
    expect(screen.getByTestId("shift-note-input").props.value).toBe("Maybe sent");
  });

  it("repeated taps send one request", async () => {
    const pending = deferred<void>();
    createNote.mockReturnValue(pending.promise);
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Once");
    fireEvent.press(screen.getByTestId("shift-note-save"));
    fireEvent.press(screen.getByTestId("shift-note-save"));
    fireEvent.press(screen.getByTestId("shift-note-save"));
    expect(createNote).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.onClose).toHaveBeenCalledTimes(1));
  });

  it("cannot be dismissed while saving", async () => {
    const pending = deferred<void>();
    createNote.mockReturnValue(pending.promise);
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Once");
    fireEvent.press(screen.getByTestId("shift-note-save"));
    fireEvent.press(screen.getByTestId("shift-note-cancel"));
    expect(screen.onClose).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
  });

  it("offline: says so, keeps the draft and does not send", async () => {
    const screen = renderNote({ isOnline: false });
    await waitFor(() => screen.getByTestId("shift-note-department"));
    fireEvent.changeText(screen.getByTestId("shift-note-input"), "Draft");
    expect(screen.getByTestId("shift-note-offline")).toBeTruthy();
    expect(disabled(screen.getByTestId("shift-note-save"))).toBe(true);
    fireEvent.press(screen.getByTestId("shift-note-save"));
    expect(createNote).not.toHaveBeenCalled();
    expect(screen.getByTestId("shift-note-input").props.value).toBe("Draft");
  });

  it("closes an untouched drawer straight away, but asks before throwing away a draft", async () => {
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    fireEvent.press(screen.getByTestId("shift-note-cancel"));
    expect(screen.onClose).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();

    const typed = renderNote();
    await waitFor(() => typed.getAllByTestId("shift-note-department"));
    fireEvent.changeText(typed.getAllByTestId("shift-note-input")[0], "Important");
    fireEvent.press(typed.getAllByTestId("shift-note-cancel")[0]);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(typed.onClose).not.toHaveBeenCalled();
  });

  it("limits the note to what the API accepts", async () => {
    const screen = renderNote();
    await waitFor(() => screen.getByTestId("shift-note-department"));
    expect(screen.getByTestId("shift-note-input").props.maxLength).toBe(4000);
  });
});

/* ─── Team message ────────────────────────────────────────────────────────── */

describe("Message team drawer", () => {
  function renderBroadcast(overrides: Partial<React.ComponentProps<typeof BroadcastModal>> = {}) {
    const onClose = jest.fn();
    const screen = wrap(<BroadcastModal visible isOnline onClose={onClose} {...overrides} />);
    return { ...screen, onClose };
  }

  it("states its audience honestly: housekeeper accounts, not 'on shift'", () => {
    const screen = renderBroadcast();
    const audience = screen.getByTestId("broadcast-audience");
    expect(audience).toHaveTextContent(/All active housekeeper accounts at this hotel/);
    expect(audience).toHaveTextContent(/isn't limited to who is clocked in/);
    expect(audience).not.toHaveTextContent(/on shift|read it by/i);
    expect(screen.getByText("Message team")).toBeTruthy();
  });

  it("offers editable quick messages", () => {
    const screen = renderBroadcast();
    fireEvent.press(screen.getByTestId("broadcast-template-priority"));
    expect(screen.getByTestId("broadcast-input").props.value).toBe("Please review priority rooms.");
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Please review priority rooms. 308 first.");
    expect(screen.getByTestId("broadcast-input").props.value).toBe("Please review priority rooms. 308 first.");
    for (const key of ["assignments", "priority", "shift", "checkOut"]) expect(screen.getByTestId(`broadcast-template-${key}`)).toBeTruthy();
  });

  it("cannot send an empty message", () => {
    const screen = renderBroadcast();
    expect(disabled(screen.getByTestId("broadcast-send"))).toBe(true);
    fireEvent.press(screen.getByTestId("broadcast-send"));
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "  ");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("sends through the broadcast helper and reports the server's real count", async () => {
    broadcast.mockResolvedValue({ kind: "delivered", count: 8 });
    const screen = renderBroadcast();
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Shift reminder.");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalledTimes(1));
    expect(broadcast).toHaveBeenCalledWith("Shift reminder.");
    expect(mockToast.success).toHaveBeenCalledWith("Message added to 8 housekeeper inboxes.");
  });

  it("uses the singular for one inbox, and never claims reads, pushes or acknowledgements", async () => {
    broadcast.mockResolvedValue({ kind: "delivered", count: 1 });
    const screen = renderBroadcast();
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Hi");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    const text = String(mockToast.success.mock.calls[0][0]);
    expect(text).toBe("Message added to 1 housekeeper inbox.");
    expect(text).not.toMatch(/read|push|deliver|online|acknowledg/i);
  });

  it("does not claim a count the server did not give", async () => {
    broadcast.mockResolvedValue({ kind: "unknown" });
    const screen = renderBroadcast();
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Hi");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(String(mockToast.success.mock.calls[0][0])).toMatch(/didn't report how many/);
    expect(String(mockToast.success.mock.calls[0][0])).not.toMatch(/\d/);
  });

  it("a zero-recipient answer is not a success: nothing was sent, the draft stays", async () => {
    broadcast.mockResolvedValue({ kind: "nobody" });
    const screen = renderBroadcast();
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Hello team");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    await waitFor(() => screen.getByTestId("broadcast-nobody"));
    expect(screen.getByTestId("broadcast-nobody")).toHaveTextContent(/nothing was sent/);
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("broadcast-input").props.value).toBe("Hello team");
  });

  it("a failed send keeps the draft and can be retried", async () => {
    broadcast.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 403 })).mockResolvedValueOnce({ kind: "delivered", count: 2 });
    const screen = renderBroadcast();
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Keep this");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    await waitFor(() => screen.getByTestId("broadcast-error"));
    expect(screen.getByTestId("broadcast-error")).toHaveTextContent(/isn't allowed/);
    expect(screen.getByTestId("broadcast-input").props.value).toBe("Keep this");
    expect(mockToast.success).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("broadcast-send"));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalled());
  });

  it("after a timeout it does not retry on its own and says the message may have gone out", async () => {
    broadcast.mockRejectedValue(new Error("Request timed out. Please try again."));
    const screen = renderBroadcast();
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Hi");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    await waitFor(() => screen.getByTestId("broadcast-error"));
    expect(screen.getByTestId("broadcast-error")).toHaveTextContent(/may already have been sent/);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("repeated taps send one request", async () => {
    const pending = deferred<{ kind: "delivered"; count: number }>();
    broadcast.mockReturnValue(pending.promise);
    const screen = renderBroadcast();
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Once");
    fireEvent.press(screen.getByTestId("broadcast-send"));
    fireEvent.press(screen.getByTestId("broadcast-send"));
    expect(broadcast).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ kind: "delivered", count: 3 }));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalledTimes(1));
  });

  it("offline: cannot send, keeps the draft, says why", () => {
    const screen = renderBroadcast({ isOnline: false });
    fireEvent.changeText(screen.getByTestId("broadcast-input"), "Draft");
    expect(screen.getByTestId("broadcast-offline")).toBeTruthy();
    expect(disabled(screen.getByTestId("broadcast-send"))).toBe(true);
    fireEvent.press(screen.getByTestId("broadcast-send"));
    expect(broadcast).not.toHaveBeenCalled();
    expect(screen.getByTestId("broadcast-input").props.value).toBe("Draft");
  });
});

/* ─── Direct message ──────────────────────────────────────────────────────── */

describe("Direct message drawer", () => {
  function renderDm(props: Partial<React.ComponentProps<typeof DirectMessageModal>> = {}) {
    const onClose = jest.fn();
    const element = (p: Partial<React.ComponentProps<typeof DirectMessageModal>>) => (
      <ThemeProvider>
        <DirectMessageModal visible recipientId="hk-1" recipientName="Maria R" recipientMeta="Housekeeper · On shift" isOnline onClose={onClose} {...p} />
      </ThemeProvider>
    );
    const screen = render(element(props));
    // Object.assign keeps the live queries; a spread would freeze them to the first render.
    return Object.assign(screen, { onClose, rerenderWith: (next: Partial<React.ComponentProps<typeof DirectMessageModal>>) => screen.rerender(element({ ...props, ...next })) });
  }

  it("shows who the message is for", () => {
    const screen = renderDm();
    expect(screen.getByText("Message staff member")).toBeTruthy();
    expect(screen.getByTestId("dm-recipient-name")).toHaveTextContent("Maria R");
    expect(screen.getByTestId("dm-recipient-meta")).toHaveTextContent("Housekeeper · On shift");
  });

  it("cannot send without a recipient", () => {
    const screen = renderDm({ recipientId: null, recipientName: null, recipientMeta: null });
    expect(screen.getByTestId("dm-no-recipient")).toBeTruthy();
    expect(screen.queryByTestId("dm-recipient")).toBeNull();
    fireEvent.changeText(screen.getByTestId("dm-input"), "Hi");
    expect(disabled(screen.getByTestId("dm-send"))).toBe(true);
    fireEvent.press(screen.getByTestId("dm-send"));
    expect(direct).not.toHaveBeenCalled();
  });

  it("sends to the selected employee only", async () => {
    direct.mockResolvedValue(undefined);
    const screen = renderDm({ recipientId: "hk-2", recipientName: "James L" });
    fireEvent.changeText(screen.getByTestId("dm-input"), "Start 310 first");
    fireEvent.press(screen.getByTestId("dm-send"));
    await waitFor(() => expect(screen.onClose).toHaveBeenCalledTimes(1));
    expect(direct).toHaveBeenCalledTimes(1);
    expect(direct).toHaveBeenCalledWith("hk-2", "Start 310 first");
    expect(mockToast.success).toHaveBeenCalledWith("Message sent to James L.");
  });

  it("a draft written for one person never reaches another", async () => {
    direct.mockResolvedValue(undefined);
    const screen = renderDm({ recipientId: "hk-1", recipientName: "Maria R" });
    fireEvent.changeText(screen.getByTestId("dm-input"), "Private note for Maria");
    screen.rerenderWith({ recipientId: "hk-2", recipientName: "James L" });
    expect(screen.getByTestId("dm-input").props.value).toBe("");
    expect(screen.getByTestId("dm-recipient-name")).toHaveTextContent("James L");
    expect(disabled(screen.getByTestId("dm-send"))).toBe(true);
    fireEvent.changeText(screen.getByTestId("dm-input"), "For James");
    fireEvent.press(screen.getByTestId("dm-send"));
    await waitFor(() => expect(direct).toHaveBeenCalledWith("hk-2", "For James"));
    expect(direct).not.toHaveBeenCalledWith("hk-2", expect.stringContaining("Maria"));
  });

  it("a failed send keeps the message", async () => {
    direct.mockRejectedValue(Object.assign(new Error("Recipient not found"), { status: 404 }));
    const screen = renderDm();
    fireEvent.changeText(screen.getByTestId("dm-input"), "Keep me");
    fireEvent.press(screen.getByTestId("dm-send"));
    await waitFor(() => screen.getByTestId("dm-error"));
    expect(screen.getByTestId("dm-input").props.value).toBe("Keep me");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.onClose).not.toHaveBeenCalled();
  });

  it("repeated taps send one request", async () => {
    const pending = deferred<void>();
    direct.mockReturnValue(pending.promise);
    const screen = renderDm();
    fireEvent.changeText(screen.getByTestId("dm-input"), "Once");
    fireEvent.press(screen.getByTestId("dm-send"));
    fireEvent.press(screen.getByTestId("dm-send"));
    fireEvent.press(screen.getByTestId("dm-send"));
    expect(direct).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.onClose).toHaveBeenCalledTimes(1));
  });

  it("offline: cannot send and keeps the draft", () => {
    const screen = renderDm({ isOnline: false });
    fireEvent.changeText(screen.getByTestId("dm-input"), "Draft");
    expect(screen.getByTestId("dm-offline")).toBeTruthy();
    expect(disabled(screen.getByTestId("dm-send"))).toBe(true);
    fireEvent.press(screen.getByTestId("dm-send"));
    expect(direct).not.toHaveBeenCalled();
  });

  it("never claims the message was read", () => {
    const screen = renderDm();
    expect(screen.getByText(/You won't see whether they've read it/)).toBeTruthy();
  });
});

/* ─── Staff picker and quick view ─────────────────────────────────────────── */

const NOW = Date.parse("2026-10-16T17:00:00Z");
const STAFF: AssignableStaff[] = [
  { userId: "sup-1", name: "Sam Super", role: "housekeeping_supervisor" },
  { userId: "hk-1", name: "María Rodríguez", role: "housekeeper" },
  { userId: "hk-2", name: "James Lee", role: "housekeeper" },
];

function room(id: string, status: string, assignedTo: string | null, extra: Partial<FloorRoom> = {}): FloorRoom {
  return {
    roomId: `r-${id}`, roomNumber: id, floor: 1, roomType: null, baseCleanMinutes: 30, status, foStatus: null, dnd: false, vip: false,
    assignedTo, assignmentId: null, cleanType: null, cleanTypeLabel: null, latestNote: null, openWorkOrderId: null, openWorkOrder: null,
    openWorkOrderStatus: null, highRisk: false, checkinTime: null, checkoutTime: null, ...extra,
  };
}

const ROOMS = [
  room("101", "INSPECTED", "hk-1"),
  room("102", "CLEAN", "hk-1"),
  room("104", "IN_PROGRESS", "hk-1"),
  room("110", "DIRTY", "hk-1", { vip: true }),
  room("201", "DIRTY", "hk-2"),
];

function teamOf(rosterState: SourceState<RosterEntry[]>): Derived<TeamPulse> {
  return { status: "available", value: buildTeamPulse(ROOMS, STAFF, rosterState, "sup-1"), fetchedAt: NOW, failure: null };
}
const rosterOk: SourceState<RosterEntry[]> = {
  status: "available",
  fetchedAt: NOW,
  data: normalizeRoster([{ user_id: "hk-1", status: "active", started_at: "2026-10-16T13:00:00Z" }], NOW),
};
const rosterDown: SourceState<RosterEntry[]> = { status: "failed", failure: { kind: "forbidden", status: 403 } };
const staffOk: SourceState<AssignableStaff[]> = { status: "available", data: STAFF, fetchedAt: NOW };

describe("Staff picker", () => {
  function renderPicker(props: Partial<React.ComponentProps<typeof StaffPickerSheet>> = {}) {
    const onSelect = jest.fn();
    const onRetry = jest.fn();
    const onClose = jest.fn();
    const screen = wrap(
      <StaffPickerSheet visible staff={staffOk} team={teamOf(rosterOk)} viewerId="sup-1" onSelect={onSelect} onRetry={onRetry} onClose={onClose} {...props} />,
    );
    return { ...screen, onSelect, onRetry, onClose };
  }

  it("lists the hotel's authorized staff, never the viewer, with verified status", () => {
    const screen = renderPicker();
    expect(screen.queryByTestId("picker-sup-1")).toBeNull();
    expect(screen.getByTestId("picker-hk-1")).toHaveTextContent(/María Rodríguez/);
    expect(screen.getByTestId("picker-hk-1")).toHaveTextContent(/On shift/);
    expect(screen.getByTestId("picker-hk-2")).toHaveTextContent(/Not clocked in/);
  });

  it("shows availability as unknown — not off shift — when the roster is unavailable", () => {
    const screen = renderPicker({ team: teamOf(rosterDown) });
    expect(screen.getByTestId("picker-hk-1")).toHaveTextContent(/Availability unknown/);
    expect(screen.getByTestId("picker-hk-1")).not.toHaveTextContent(/Not clocked in|Clocked out/);
  });

  it("searches by name, ignoring case and accents", () => {
    const screen = renderPicker();
    fireEvent.changeText(screen.getByTestId("picker-search"), "maria");
    expect(screen.getByTestId("picker-hk-1")).toBeTruthy();
    expect(screen.queryByTestId("picker-hk-2")).toBeNull();
    fireEvent.changeText(screen.getByTestId("picker-search"), "zzz");
    expect(screen.getByTestId("picker-no-results")).toHaveTextContent('No one matches "zzz".');
  });

  it("selects exactly one person", () => {
    const screen = renderPicker();
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    expect(screen.onSelect).toHaveBeenCalledTimes(1);
    expect(screen.onSelect).toHaveBeenCalledWith(expect.objectContaining({ userId: "hk-2", name: "James Lee" }));
  });

  it("handles loading, an empty list and a failed list", () => {
    expect(renderPicker({ staff: { status: "loading" } }).getByTestId("picker-loading")).toBeTruthy();
    expect(renderPicker({ staff: { status: "empty", fetchedAt: NOW } }).getByTestId("picker-empty")).toBeTruthy();
    const onlyMe = renderPicker({ staff: { status: "available", data: [STAFF[0]], fetchedAt: NOW } });
    expect(onlyMe.getByTestId("picker-empty")).toBeTruthy();
    const failed = renderPicker({ staff: { status: "failed", failure: { kind: "error", status: 500 } } });
    expect(failed.getByTestId("picker-failed")).toHaveTextContent("Couldn't load your staff list.");
    fireEvent.press(failed.getByTestId("picker-retry"));
    expect(failed.onRetry).toHaveBeenCalledTimes(1);
  });

  it("explains a permission failure instead of offering a pointless retry", () => {
    const screen = renderPicker({ staff: { status: "failed", failure: { kind: "forbidden", status: 403 } } });
    expect(screen.getByTestId("picker-failed")).toHaveTextContent(/can't see the staff list/);
    expect(screen.queryByTestId("picker-retry")).toBeNull();
  });

  it("keeps the last good list on screen when a refresh fails", () => {
    const screen = renderPicker({ staff: { status: "stale", data: STAFF, fetchedAt: NOW, reason: "refresh_failed", failure: null } });
    expect(screen.getByTestId("picker-hk-1")).toBeTruthy();
  });

  it("is absent until opened", () => {
    expect(renderPicker({ visible: false }).queryByTestId("staff-picker-sheet")).toBeNull();
  });
});

describe("Staff quick view", () => {
  function renderQuick(props: Partial<React.ComponentProps<typeof StaffQuickViewSheet>> = {}) {
    const onMessage = jest.fn();
    const onViewAssignments = jest.fn();
    const onClose = jest.fn();
    const screen = wrap(
      <StaffQuickViewSheet userId="hk-1" team={teamOf(rosterOk)} isOnline onMessage={onMessage} onViewAssignments={onViewAssignments} onClose={onClose} {...props} />,
    );
    return { ...screen, onMessage, onViewAssignments, onClose };
  }

  it("shows the person's real assignment progress, split into cleaned and inspected", () => {
    const screen = renderQuick();
    expect(screen.getByText("María Rodríguez")).toBeTruthy();
    expect(screen.getByTestId("staff-quick-role")).toHaveTextContent("Housekeeper");
    expect(screen.getByTestId("staff-quick-status")).toHaveTextContent("On shift");
    expect(screen.getByTestId("staff-quick-progress")).toHaveTextContent("2 of 4 rooms cleaned");
    expect(screen.getByTestId("staff-quick-cleaned")).toHaveTextContent(/^2Cleaned$/);
    expect(screen.getByTestId("staff-quick-inspected")).toHaveTextContent(/^1Passed inspection$/);
    expect(screen.getByTestId("staff-quick-awaiting")).toHaveTextContent(/^1Awaiting inspection$/);
    expect(screen.getByTestId("staff-quick-remaining")).toHaveTextContent(/^2Remaining$/);
  });

  it("lists remaining rooms with their recorded status, in-progress first, and flags VIP", () => {
    const screen = renderQuick();
    expect(screen.getByTestId("staff-quick-room-r-104")).toHaveTextContent(/104.*Cleaning now/);
    expect(screen.getByTestId("staff-quick-room-r-110")).toHaveTextContent(/110.*To clean.*VIP/);
    expect(screen.queryByTestId("staff-quick-room-r-101")).toBeNull(); // already cleaned
    expect(screen.queryByTestId("staff-quick-room-r-201")).toBeNull(); // someone else's
  });

  it("says unknown when the roster could not be read, and never 'off shift'", () => {
    const screen = renderQuick({ team: teamOf(rosterDown) });
    expect(screen.getByTestId("staff-quick-status")).toHaveTextContent("Availability unknown");
    expect(screen.getByTestId("staff-quick-roster-note")).toHaveTextContent(/couldn't be confirmed/);
    expect(screen.queryByText(/Not clocked in|Clocked out/)).toBeNull();
  });

  it("a person with no clock-in record is 'Not clocked in' only because the roster was read", () => {
    const screen = renderQuick({ userId: "hk-2" });
    expect(screen.getByTestId("staff-quick-status")).toHaveTextContent("Not clocked in");
  });

  it("Message hands the right person to the composer; View all assignments navigates", () => {
    const screen = renderQuick();
    fireEvent.press(screen.getByTestId("staff-quick-message"));
    expect(screen.onMessage).toHaveBeenCalledWith(expect.objectContaining({ userId: "hk-1", name: "María Rodríguez", role: "housekeeper" }));
    fireEvent.press(screen.getByTestId("staff-quick-assignments"));
    expect(screen.onViewAssignments).toHaveBeenCalledTimes(1);
  });

  it("offline: Message is unavailable and says why", () => {
    const screen = renderQuick({ isOnline: false });
    expect(disabled(screen.getByTestId("staff-quick-message"))).toBe(true);
    expect(screen.getByTestId("staff-quick-offline")).toBeTruthy();
  });

  it("has no reassign controls — assignments stay in the Team workflow", () => {
    const screen = renderQuick();
    expect(screen.queryByText(/reassign|assign room|remove/i)).toBeNull();
  });

  it("a person who is no longer on the list reads as gone, with no actions", () => {
    const screen = renderQuick({ userId: "ghost" });
    expect(screen.getByTestId("staff-quick-gone")).toBeTruthy();
    expect(screen.queryByTestId("staff-quick-message")).toBeNull();
  });

  it("is closed when no person is chosen", () => {
    expect(renderQuick({ userId: null }).queryByTestId("staff-quick-sheet")).toBeNull();
  });

  it("handles a person with no rooms", () => {
    const screen = renderQuick({ team: { ...teamOf(rosterOk), value: buildTeamPulse([], STAFF, rosterOk, "sup-1") } });
    expect(screen.getByTestId("staff-quick-norooms")).toHaveTextContent("No rooms assigned today.");
  });
});

/* ─── Translations ────────────────────────────────────────────────────────── */

describe("English and Spanish", () => {
  const en = require("@/i18n/locales/en.json").supervisorComms;
  const es = require("@/i18n/locales/es.json").supervisorComms;

  function keys(node: unknown, prefix = ""): string[] {
    if (typeof node === "string") return [prefix];
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  }

  it("has the same keys in both languages", () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });

  it("keeps every interpolation placeholder in the Spanish copy", () => {
    const placeholders = (text: string) => (text.match(/{{\s*\w+\s*}}/g) ?? []).sort();
    const flat = (node: unknown, prefix = ""): Record<string, string> =>
      typeof node === "string" ? { [prefix]: node } : Object.assign({}, ...Object.entries(node as object).map(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)));
    const enFlat = flat(en);
    const esFlat = flat(es);
    for (const key of Object.keys(enFlat)) expect({ key, found: placeholders(esFlat[key]) }).toEqual({ key, found: placeholders(enFlat[key]) });
  });

  it("renders Spanish labels with no raw keys", async () => {
    await i18n.changeLanguage("es");
    try {
      const screen = wrap(<BroadcastModal visible isOnline onClose={jest.fn()} />);
      expect(screen.getByText("Mensaje al equipo")).toBeTruthy();
      expect(screen.getByTestId("broadcast-audience")).toHaveTextContent(/camareras/);
      expect(screen.queryByText(/supervisorComms\./)).toBeNull();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("gives every control an accessible name", async () => {
    const screen = wrap(<StaffQuickViewSheet userId="hk-1" team={teamOf(rosterOk)} isOnline onMessage={jest.fn()} onViewAssignments={jest.fn()} onClose={jest.fn()} />);
    for (const id of ["staff-quick-message", "staff-quick-assignments"]) expect(screen.getByTestId(id).props.accessibilityLabel).toBeTruthy();
    const note = wrap(<ShiftNoteModal visible tenantId="hotel-1" isOnline onClose={jest.fn()} />);
    await waitFor(() => note.getByTestId("shift-note-department"));
    expect(note.getByTestId("shift-note-input").props.accessibilityLabel).toBe("Note");
    expect(note.getByTestId("shift-note-save").props.accessibilityLabel).toBeTruthy();
  });
});

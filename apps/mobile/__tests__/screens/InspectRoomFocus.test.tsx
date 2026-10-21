import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

let mockParams: Record<string, string | undefined> = {};
const mockParamListeners = new Set<() => void>();
const mockSetParams = jest.fn((next: Record<string, string | undefined>) => {
  mockParams = Object.fromEntries(Object.entries({ ...mockParams, ...next }).filter(([, value]) => value !== undefined));
  mockParamListeners.forEach((listener) => listener());
});

jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
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
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({ subscribeSupervisorRealtime: jest.fn(() => jest.fn()) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));
// The hook's strict queue read and the pre-send re-check read the same server queue.
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

import { router as mockRouter } from "expo-router";
import { api } from "@/lib/api/client";
import { fetchInspectionRecords, fetchOpenCorrections, listInspectionTemplates, submitInspection } from "@/lib/api/inspections";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider, ToastViewport } from "@/lib/theme/ToastProvider";
import { useAppStore } from "@/stores/appStore";
import InspectScreen from "@/app/(app)/inspect";

const mockGet = api.get as jest.Mock;
const mockRecords = fetchInspectionRecords as jest.Mock;
const mockTemplates = listInspectionTemplates as jest.Mock;
const mockSubmit = submitInspection as jest.Mock;
const t = makeTranslator("en");

const room = (n: string) => ({ room_id: `room-${n}`, room_number: n, floor: 1, cleaned_by: `Cleaner ${n}`, cleaned_at: null, housekeeper_id: null, clean_type: null });
/** A checklist as the API returns it: the property default with at least one item (an empty checklist can approve nothing). */
const standard = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Standard",
  room_type_id: null,
  is_default: true,
  is_active: true,
  items: [{ id: `${id}-bed`, section: "General", description: "Bed made", is_required: true }],
  ...extra,
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** The ordinary path: tap the queue card, which hands that room (by id) to the room-specific controls. */
async function openRoom(screen: ReturnType<typeof renderScreen>, number: string) {
  if (!screen.queryByTestId(`inspect-${number}`)) {
    await act(async () => fireEvent.press(screen.getByTestId(`queue-card-room-${number}`)));
    await flush();
  }
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

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockQueue.mockResolvedValue([room("103"), room("203")]);
  mockGet.mockResolvedValue({});
  mockRecords.mockResolvedValue([]);
  (fetchOpenCorrections as jest.Mock).mockResolvedValue({ rows: [], truncated: false });
  mockTemplates.mockResolvedValue({ data: [standard("t1")] });
  mockSubmit.mockResolvedValue({ id: "insp-1" });
  useAppStore.setState({ hotelTimezone: "America/Chicago", isOnline: true, user: { id: "sup-1", tenant_id: "hotel-1", role: "housekeeping_supervisor" } as never });
});

describe("room-specific inspection", () => {
  it("opens that room's controls by its id, ahead of the queue, and submits nothing on its own", async () => {
    mockParams = { roomId: "room-203", roomNumber: "203" };
    const screen = renderScreen();
    await flush();
    expect(screen.getByText("Inspecting Room 203")).toBeTruthy();
    expect(screen.getByTestId("inspect-focus")).toBeTruthy();
    // the focused room is not repeated in the list below it
    expect(screen.getAllByTestId("inspect-203")).toHaveLength(1);
    expect(screen.queryByTestId("queue-card-room-203")).toBeNull();
    expect(screen.getByTestId("queue-card-room-103")).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText("Pass Room 203?")).toBeNull();
  });

  it("resolves by id, never by the label: a mismatched number still opens the room the id names", async () => {
    mockParams = { roomId: "room-103", roomNumber: "999" };
    const screen = renderScreen();
    await flush();
    expect(screen.getByText("Inspecting Room 103")).toBeTruthy();
  });

  it("a room that is no longer queued says so and offers the way back and the queue", async () => {
    mockParams = { roomId: "room-555", roomNumber: "555" };
    const screen = renderScreen();
    await flush();
    expect(screen.getByText("Room 555 is no longer awaiting inspection.")).toBeTruthy();
    expect(screen.queryByTestId("inspect-focus")).toBeNull();
    fireEvent.press(screen.getByTestId("inspect-focus-back"));
    expect(mockRouter.back).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("inspect-focus-queue"));
    expect(mockSetParams).toHaveBeenCalledWith({ roomId: undefined, roomNumber: undefined });
    // the ordinary queue is still there
    expect(screen.getByTestId("queue-card-room-103")).toBeTruthy();
  });

  it("an invalid id selects nothing", async () => {
    mockParams = { roomId: "../../x" };
    const screen = renderScreen();
    await flush();
    expect(screen.getByText("That room link isn't valid.")).toBeTruthy();
  });

  it("when the queue cannot be loaded the room is not judged missing; there is a retry", async () => {
    mockParams = { roomId: "room-203", roomNumber: "203" };
    mockQueue.mockRejectedValueOnce(new Error("offline"));
    const screen = renderScreen();
    await flush();
    expect(screen.getByText("Couldn't load the inspection queue, so the room can't be confirmed.")).toBeTruthy();
    expect(screen.queryByText(/no longer awaiting/)).toBeNull();
    mockQueue.mockResolvedValue([room("203")]);
    await act(async () => fireEvent.press(screen.getByTestId("inspect-focus-retry")));
    await flush();
    expect(screen.getByText("Inspecting Room 203")).toBeTruthy();
  });

  it("without a roomId the generic Inspect tab works unchanged", async () => {
    const screen = renderScreen();
    await flush();
    expect(screen.queryByTestId("inspect-focus")).toBeNull();
    expect(screen.queryByTestId("inspect-focus-notice")).toBeNull();
    expect(screen.getByTestId("queue-card-room-103")).toBeTruthy();
    expect(screen.getByTestId("queue-card-room-203")).toBeTruthy();
    // the queue itself carries no outcome controls
    expect(screen.queryByTestId("inspect-103")).toBeNull();
    expect(screen.queryAllByLabelText("Confirm Pass")).toHaveLength(0);
  });
});

describe("safety before an inspection is sent", () => {
  async function startPass(screen: ReturnType<typeof renderScreen>) {
    await openRoom(screen, "203");
    await act(async () => fireEvent.press(within(screen.getByTestId("inspect-203")).getByLabelText("Confirm Pass")));
    await flush();
  }
  const confirmButton = (screen: ReturnType<typeof renderScreen>) => {
    const all = screen.getAllByLabelText("Confirm Pass");
    return all[all.length - 1];
  };

  it("sends once, however often Confirm is tapped, after re-checking the queue and the checklist", async () => {
    mockParams = { roomId: "room-203", roomNumber: "203" };
    let resolve: (value: unknown) => void = () => undefined;
    mockSubmit.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const screen = renderScreen();
    await flush();
    await startPass(screen);
    expect(screen.getByText("Pass Room 203?")).toBeTruthy();
    mockQueue.mockClear();
    await act(async () => {
      fireEvent.press(confirmButton(screen));
      fireEvent.press(confirmButton(screen));
    });
    await flush();
    expect(mockQueue).toHaveBeenCalled();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ room_id: "room-203", overall_result: "passed", template_id: "t1" }));
    await act(async () => resolve({ id: "insp-1" }));
  });

  it("if another supervisor already inspected the room, nothing is sent and the screen says so", async () => {
    mockParams = { roomId: "room-203", roomNumber: "203" };
    const screen = renderScreen();
    await flush();
    await startPass(screen);
    mockQueue.mockResolvedValue([room("103")]);
    await act(async () => fireEvent.press(confirmButton(screen)));
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("inspect-focus-notice")).toBeTruthy();
    expect(screen.getByText("Room 203 is no longer awaiting inspection.")).toBeTruthy();
  });

  it("opened from a queue card, the same race says so in the room block and sends nothing", async () => {
    const screen = renderScreen();
    await flush();
    await openRoom(screen, "203");
    await act(async () => fireEvent.press(within(screen.getByTestId("inspect-203")).getByLabelText("Confirm Pass")));
    await flush();
    mockQueue.mockResolvedValue([room("103")]);
    const all = screen.getAllByLabelText("Confirm Pass");
    await act(async () => fireEvent.press(all[all.length - 1]));
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("inspect-focus-notice")).toBeTruthy();
    expect(screen.getByText("Room 203 is no longer awaiting inspection.")).toBeTruthy();
    expect(screen.queryByTestId("queue-card-room-203")).toBeNull();
  });

  it("a server 409 on write is reported the same way and the queue reloads", async () => {
    mockParams = { roomId: "room-203", roomNumber: "203" };
    mockSubmit.mockRejectedValueOnce(Object.assign(new Error("Room must be clean before it can be inspected"), { status: 409 }));
    const screen = renderScreen();
    await flush();
    await startPass(screen);
    await act(async () => fireEvent.press(confirmButton(screen)));
    await flush();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Room 203 is no longer awaiting inspection.")).toBeTruthy();
  });

  it("when the check itself cannot run, nothing is sent", async () => {
    mockParams = { roomId: "room-203", roomNumber: "203" };
    const screen = renderScreen();
    await flush();
    await startPass(screen);
    mockQueue.mockRejectedValue(new Error("offline"));
    await act(async () => fireEvent.press(confirmButton(screen)));
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("a changed checklist stops the send", async () => {
    mockParams = { roomId: "room-203", roomNumber: "203" };
    const screen = renderScreen();
    await flush();
    await startPass(screen);
    mockTemplates.mockResolvedValue({ data: [standard("t2")] });
    await act(async () => fireEvent.press(confirmButton(screen)));
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("a failed inspection still offers the existing re-clean step", async () => {
    mockParams = {};
    mockSubmit.mockResolvedValueOnce({ id: "insp-9" });
    const screen = renderScreen();
    await flush();
    await openRoom(screen, "103");
    await act(async () => fireEvent.press(within(screen.getByTestId("inspect-103")).getByLabelText("Confirm Fail")));
    await flush();
    const confirm = screen.getAllByLabelText("Confirm Fail");
    await act(async () => fireEvent.press(confirm[confirm.length - 1]));
    await flush();
    await waitFor(() => expect(screen.getByText("Send Back")).toBeTruthy());
    expect(t("inspect.reclean.confirm")).toBe("Send Back");
  });
});

describe("hotel date", () => {
  it("requests the queue and today's records for the hotel's business date, not the phone's", async () => {
    const spy = jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-17T02:30:00Z"));
    try {
      const screen = renderScreen();
      await flush();
      expect(mockQueue).toHaveBeenCalledWith("2026-10-16");
      expect(mockRecords).toHaveBeenCalledWith("2026-10-16");
      expect(screen.getByTestId("queue-card-room-103")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("which checklist a room gets", () => {
  const typedRoom = (n: string, typeId: string | null) => ({ ...room(n), room_type_id: typeId });
  const press = async (screen: ReturnType<typeof renderScreen>, testId: string, label: string) => {
    await openRoom(screen, testId.replace("inspect-", ""));
    await act(async () => fireEvent.press(within(screen.getByTestId(testId)).getByLabelText(label)));
    await flush();
  };
  /** A room whose checklist is known to be unusable never reaches the outcome controls: the card says why. */
  const tapBlockedCard = async (screen: ReturnType<typeof renderScreen>, number: string) => {
    await act(async () => fireEvent.press(screen.getByTestId(`queue-card-room-${number}`)));
    await flush();
  };
  const confirmPass = async (screen: ReturnType<typeof renderScreen>) => {
    const all = screen.getAllByLabelText("Confirm Pass");
    await act(async () => fireEvent.press(all[all.length - 1]));
    await flush();
  };

  it("uses the checklist configured for the room's own type, not whichever the server listed first", async () => {
    mockQueue.mockResolvedValue([typedRoom("203", "type-suite")]);
    mockTemplates.mockResolvedValue({
      data: [
        standard("t-default"),
        standard("t-king", { name: "King", is_default: false, room_type_id: "type-king" }),
        standard("t-suite", { name: "Suite", is_default: false, room_type_id: "type-suite" }),
      ],
    });
    const screen = renderScreen();
    await flush();
    await press(screen, "inspect-203", "Confirm Pass");
    await confirmPass(screen);
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ room_id: "room-203", template_id: "t-suite" }));
  });

  it("falls back to the property default when nothing matches the room type", async () => {
    mockQueue.mockResolvedValue([typedRoom("203", "type-suite")]);
    mockTemplates.mockResolvedValue({ data: [standard("t-king", { is_default: false, room_type_id: "type-king" }), standard("t-default")] });
    const screen = renderScreen();
    await flush();
    await press(screen, "inspect-203", "Confirm Pass");
    await confirmPass(screen);
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ template_id: "t-default" }));
  });

  it("with no usable checklist it says why and does not open a sheet that could send a result", async () => {
    mockQueue.mockResolvedValue([typedRoom("203", "type-suite")]);
    mockTemplates.mockResolvedValue({ data: [standard("t-default", { is_active: false })] });
    const screen = renderScreen();
    await flush();
    await tapBlockedCard(screen, "203");
    expect(screen.queryByTestId("inspect-203")).toBeNull();
    expect(screen.queryByText("Pass Room 203?")).toBeNull();
    expect(screen.getByTestId("queue-card-blocked-room-203").props.children).toBe(t("inspect.template.no_usable_template")); // on the card...
    expect(screen.getAllByText(t("inspect.template.no_usable_template")).length).toBeGreaterThanOrEqual(2); // ...and as the toast
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("does not guess when the room type is unknown and a type-specific checklist exists", async () => {
    mockQueue.mockResolvedValue([typedRoom("203", null)]);
    mockTemplates.mockResolvedValue({ data: [standard("t-default"), standard("t-suite", { is_default: false, room_type_id: "type-suite" })] });
    const screen = renderScreen();
    await flush();
    await tapBlockedCard(screen, "203");
    expect(screen.queryByTestId("inspect-203")).toBeNull();
    expect(screen.queryByText("Pass Room 203?")).toBeNull();
    expect(screen.getByTestId("queue-card-blocked-room-203").props.children).toBe(t("inspect.template.room_type_unknown")); // on the card...
    expect(screen.getAllByText(t("inspect.template.room_type_unknown")).length).toBeGreaterThanOrEqual(2); // ...and as the toast
  });

  it("when the checklists could not be loaded it says so instead of 'no checklist'", async () => {
    mockTemplates.mockRejectedValue(new Error("offline"));
    const screen = renderScreen();
    await flush();
    await press(screen, "inspect-203", "Confirm Pass");
    expect(screen.queryByText("Pass Room 203?")).toBeNull();
    expect(screen.getByText(t("inspect.template.unavailable"))).toBeTruthy();
  });

  it("a checklist edited while the sheet was open (same id, new digest) stops the send", async () => {
    mockTemplates.mockResolvedValue({ data: [standard("t1", { fingerprint: "fp-1" })] });
    const screen = renderScreen();
    await flush();
    await press(screen, "inspect-203", "Confirm Pass");
    mockTemplates.mockResolvedValue({ data: [standard("t1", { fingerprint: "fp-2" })] });
    await confirmPass(screen);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(t("inspect.guard.templateChanged"))).toBeTruthy();
  });
});

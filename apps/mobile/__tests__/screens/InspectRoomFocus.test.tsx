import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

let mockParams: Record<string, string | undefined> = {};

jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("expo-router", () => ({
  router: { setParams: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));
jest.mock("@/lib/api/inspections", () => ({
  listInspectionTemplates: jest.fn(),
  submitInspection: jest.fn(),
  fetchReadyForInspection: jest.fn(),
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({ triggerReclean: jest.fn() }));

import { router as mockRouter } from "expo-router";
import { api } from "@/lib/api/client";
import { fetchReadyForInspection, listInspectionTemplates, submitInspection } from "@/lib/api/inspections";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { useAppStore } from "@/stores/appStore";
import InspectScreen from "@/app/(app)/inspect";

const mockGet = api.get as jest.Mock;
const mockQueue = fetchReadyForInspection as jest.Mock;
const mockTemplates = listInspectionTemplates as jest.Mock;
const mockSubmit = submitInspection as jest.Mock;
const t = makeTranslator("en");

const room = (n: string) => ({ room_id: `room-${n}`, room_number: n, floor: 1, cleaned_by: `Cleaner ${n}`, cleaned_at: null, housekeeper_id: null, clean_type: null });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function renderScreen() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <InspectScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockQueue.mockResolvedValue([room("103"), room("203")]);
  mockGet.mockResolvedValue({ data: [] });
  mockTemplates.mockResolvedValue({ data: [{ id: "t1", name: "Standard", items: [] }] });
  mockSubmit.mockResolvedValue({ id: "insp-1" });
  useAppStore.setState({ hotelTimezone: "America/Chicago" } as never);
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
    expect(screen.getByTestId("inspect-103")).toBeTruthy();
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
    expect(mockRouter.setParams).toHaveBeenCalledWith({ roomId: undefined, roomNumber: undefined });
    // the ordinary queue is still there
    expect(screen.getByTestId("inspect-103")).toBeTruthy();
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
    expect(screen.getByTestId("inspect-103")).toBeTruthy();
    expect(screen.getByTestId("inspect-203")).toBeTruthy();
  });
});

describe("safety before an inspection is sent", () => {
  async function startPass(screen: ReturnType<typeof renderScreen>) {
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

  it("from the generic queue the same race shows the notice in place and sends nothing", async () => {
    const screen = renderScreen();
    await flush();
    await act(async () => fireEvent.press(within(screen.getByTestId("inspect-203")).getByLabelText("Confirm Pass")));
    await flush();
    mockQueue.mockResolvedValue([room("103")]);
    const all = screen.getAllByLabelText("Confirm Pass");
    await act(async () => fireEvent.press(all[all.length - 1]));
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("inspect-stale-notice")).toBeTruthy();
    expect(screen.queryByTestId("inspect-203")).toBeNull();
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
    mockTemplates.mockResolvedValue({ data: [{ id: "t2", name: "New", items: [] }] });
    await act(async () => fireEvent.press(confirmButton(screen)));
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("a failed inspection still offers the existing re-clean step", async () => {
    mockParams = {};
    mockSubmit.mockResolvedValueOnce({ id: "insp-9" });
    const screen = renderScreen();
    await flush();
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
      expect(mockGet).toHaveBeenCalledWith("/housekeeping/inspections?date_from=2026-10-16&date_to=2026-10-16");
      expect(screen.getByTestId("inspect-103")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});

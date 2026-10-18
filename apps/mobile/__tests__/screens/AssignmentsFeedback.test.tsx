import React from "react";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/supabase", () => ({
  supabase: { channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnValue({}) }), removeChannel: jest.fn() },
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoard: jest.fn(),
  fetchAssignableStaff: jest.fn(),
  fetchLateCheckouts: jest.fn(),
  saveAssignments: jest.fn(),
  removeAssignment: jest.fn(),
  suggestAssignments: jest.fn(),
}));
const mockAppState = { isOnline: true, user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" } };
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { Alert } from "react-native";
import { fetchAssignableStaff, fetchBoard, fetchLateCheckouts, removeAssignment, saveAssignments } from "@/lib/api/housekeepingSupervisor";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const save = saveAssignments as jest.Mock;
const tr = makeTranslator("en");
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
const ui = () => (
  <ThemeProvider>
    <AssignmentsScreen />
  </ThemeProvider>
);

// The first render of the file pays the cold module-load cost; a slow machine must not read that as a failure.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  jest.clearAllMocks();
  mockAppState.isOnline = true;
  (fetchBoard as jest.Mock).mockResolvedValue(hotelBoard());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  (fetchLateCheckouts as jest.Mock).mockResolvedValue([]);
  save.mockResolvedValue(undefined);
  (removeAssignment as jest.Mock).mockResolvedValue(undefined);
});

async function openPicker(roomNumber = "101") {
  const screen = render(ui());
  await waitFor(() => expect(screen.getByTestId(`unassigned-${roomNumber}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`unassigned-${roomNumber}`));
  return screen;
}

describe("Assignments — truthful feedback (existing picker, unchanged one-tap flow)", () => {
  it("announces an assignment only after the server accepted it", async () => {
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await openPicker();
    await act(async () => {
      fireEvent.press(screen.getByTestId("picker-hk-2"));
    });
    // The request is still in flight: no success yet, and a second tap does not send a second request.
    expect(mockToast.success).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId("picker-hk-1"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toEqual([expect.objectContaining({ housekeeper_id: "hk-2", expect_unassigned: true })]);
    await act(async () => finish());
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("a failed save is an error, not 'assigned', and the picker stays open to retry", async () => {
    save.mockRejectedValueOnce(apiError(403, "Forbidden"));
    const screen = await openPicker();
    await act(async () => {
      fireEvent.press(screen.getByTestId("picker-hk-2"));
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(tr("roomBoard.assign.error.permission"));
    expect(screen.getByTestId("picker-hk-2")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId("picker-hk-2"));
    });
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
  });

  it("assigns a whole floor with one request and one honest message", async () => {
    (fetchBoard as jest.Mock).mockResolvedValue([rawRoom("101", "DIRTY"), rawRoom("102", "DIRTY"), rawRoom("103", "DIRTY")]);
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("assign-floor-1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assign-floor-1"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("picker-hk-3"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    const rooms = (save.mock.calls[0][1] as Array<{ room_id: string; housekeeper_id: string }>);
    expect(rooms).toHaveLength(3);
    expect(rooms.every((room) => room.housekeeper_id === "hk-3")).toBe(true);
    expect(mockToast.success).toHaveBeenCalledWith("3 rooms assigned to Cara Reyes.");
  });

  it("reassign and remove from the room menu report their real outcome", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    try {
      (fetchBoard as jest.Mock).mockResolvedValue([rawRoom("102", "OCCUPIED", { assigned_to: "hk-1", assignment_id: "as-102" })]);
      (removeAssignment as jest.Mock).mockRejectedValueOnce(apiError(404, "Assignment not found"));
      const screen = render(ui());
      await waitFor(() => expect(screen.getByTestId("load-card-hk-1")).toBeTruthy());
      // Drive the menu directly: the room row calls Alert with Reassign / Remove.
      fireEvent.press(screen.getByText("102"));
      const buttons = alertSpy.mock.calls[0]?.[2] as Array<{ text: string; onPress?: () => void | Promise<void> }> | undefined;
      const removeButton = buttons?.find((button) => button.text === tr("assignments.removeAssignment"));
      expect(removeButton).toBeTruthy();
      await act(async () => {
        await removeButton?.onPress?.();
      });
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockToast.error).toHaveBeenCalledWith(tr("roomBoard.assign.error.conflict"));

      await act(async () => {
        await removeButton?.onPress?.();
      });
      expect(mockToast.success).toHaveBeenCalledWith("Room 102 is now unassigned.");
    } finally {
      alertSpy.mockRestore();
    }
  });
});

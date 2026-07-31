import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { FloorRoom } from "@/lib/housekeeping/supervisor";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

const mockT = (key: string) => key;

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/components/shared/evening", () => ({
  StatusPill: ({ status }: { status: string }) => {
    const { Text } = require("react-native");
    return <Text>{status}</Text>;
  },
}));
jest.mock("@/components/shared/mobileHandoff", () => ({
  Avatar: () => null,
}));
jest.mock("@/lib/theme/useToast", () => ({
  useToast: () => mockToast,
}));
jest.mock("@/lib/api/client", () => ({
  api: { post: jest.fn() },
}));

import { api } from "@/lib/api/client";
import { RoomDetailSheet } from "@/components/supervisor/RoomDetailSheet";

const mockApiPost = api.post as jest.Mock;

function makeRoom(overrides: Partial<FloorRoom> = {}): FloorRoom {
  return {
    roomId: "room-101",
    roomNumber: "101",
    floor: 1,
    roomType: "King",
    baseCleanMinutes: 30,
    status: "DIRTY",
    foStatus: "VAC",
    dnd: true,
    vip: false,
    assignedTo: "housekeeper-1",
    assignmentId: "assignment-1",
    cleanType: null,
    cleanTypeLabel: null,
    latestNote: null,
    openWorkOrderId: null,
    openWorkOrder: null,
    openWorkOrderStatus: null,
    highRisk: false,
    checkinTime: null,
    checkoutTime: null,
    ...overrides,
  };
}

function renderSheet(room = makeRoom()) {
  return render(
    <ThemeProvider>
      <RoomDetailSheet
        room={room}
        assigneeName="Avery Housekeeper"
        locale="en"
        saving={false}
        onAssign={jest.fn()}
        onRemoveAssignment={jest.fn()}
        onClose={jest.fn()}
      />
    </ThemeProvider>,
  );
}

function alertButtons(alertSpy: jest.SpyInstance, callIndex: number) {
  return alertSpy.mock.calls[callIndex][2] as Array<{ text: string; onPress?: () => void | Promise<void> }>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApiPost.mockResolvedValue({ data: {} });
});

describe("RoomDetailSheet", () => {
  it("keeps remove-assignment and DND override as blocking confirmations", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());

    try {
      const { getByText } = renderSheet();

      fireEvent.press(getByText("roomBoard.sheet.removeAssignment"));
      fireEvent.press(getByText("roomBoard.sheet.dndOverride"));

      expect(alertSpy).toHaveBeenCalledTimes(2);
      expect(alertSpy).toHaveBeenNthCalledWith(
        1,
        "roomBoard.sheet.removeConfirmTitle",
        "roomBoard.sheet.removeConfirmBody",
        expect.any(Array),
      );
      expect(alertSpy).toHaveBeenNthCalledWith(
        2,
        "roomBoard.sheet.dndOverrideTitle",
        "roomBoard.sheet.dndOverrideBody",
        expect.any(Array),
      );
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("reports DND override outcomes with toasts after preserving the task request", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());

    try {
      const { getByText } = renderSheet();

      fireEvent.press(getByText("roomBoard.sheet.dndOverride"));
      await act(async () => {
        await alertButtons(alertSpy, 0)[1].onPress?.();
      });

      expect(mockApiPost).toHaveBeenCalledWith("/tasks", {
        title: "Supervisor wellness check — Room 101",
        task_type: "housekeeping",
        priority: "high",
        room_id: "room-101",
      });
      expect(mockToast.success).toHaveBeenCalledWith("roomBoard.sheet.dndOverrideCreated");
      expect(alertSpy).toHaveBeenCalledTimes(1);

      mockApiPost.mockRejectedValueOnce(new Error("offline"));
      fireEvent.press(getByText("roomBoard.sheet.dndOverride"));
      await act(async () => {
        await alertButtons(alertSpy, 1)[1].onPress?.();
      });

      expect(mockToast.error).toHaveBeenCalledWith("roomBoard.sheet.dndOverrideError");
      expect(alertSpy).toHaveBeenCalledTimes(2);
    } finally {
      alertSpy.mockRestore();
    }
  });
});

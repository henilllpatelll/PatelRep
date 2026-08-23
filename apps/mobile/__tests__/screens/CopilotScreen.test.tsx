import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockApiPost = jest.fn();
const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
const mockUseLocalSearchParams = jest.fn(() => ({} as { prefill?: string }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    start: jest.fn(),
    stop: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));
jest.mock("@/lib/api/client", () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ user: { role: "housekeeper" } }),
}));
jest.mock("@/lib/theme/useToast", () => ({
  useToast: () => mockToast,
}));

import CopilotScreen from "@/app/(app)/copilot";

type PreviewCase = {
  name: string;
  previewKey: "task_preview" | "work_order_preview" | "guest_request_preview";
  preview: Record<string, string>;
  endpoint: string;
  expectedPayload: Record<string, string | boolean>;
  successKey: string;
};

const previewCases: PreviewCase[] = [
  {
    name: "task",
    previewKey: "task_preview",
    preview: {
      title: "Bring towels to 214",
      task_type: "guest_request",
      priority: "high",
      room_number: "214",
    },
    endpoint: "/ai/tasks/confirm",
    expectedPayload: {
      title: "Bring towels to 214",
      task_type: "guest_request",
      priority: "high",
      room_number: "214",
      use_ai: true,
    },
    successKey: "copilot.taskCreated",
  },
  {
    name: "work order",
    previewKey: "work_order_preview",
    preview: {
      title: "Repair sink in 305",
      category: "plumbing",
      priority: "urgent",
      room_number: "305",
    },
    endpoint: "/work-orders",
    expectedPayload: {
      title: "Repair sink in 305",
      category: "plumbing",
      priority: "urgent",
      room_number: "305",
    },
    successKey: "copilot.workOrderCreated",
  },
  {
    name: "guest request",
    previewKey: "guest_request_preview",
    preview: {
      request_type: "amenity",
      description: "Deliver a crib",
      room_number: "412",
    },
    endpoint: "/ai/guest-requests/confirm",
    expectedPayload: {
      request_type: "amenity",
      description: "Deliver a crib",
      room_number: "412",
    },
    successKey: "copilot.guestRequestCreated",
  },
];

function renderScreen() {
  return render(
    <ThemeProvider>
      <CopilotScreen />
    </ThemeProvider>,
  );
}

async function openPreview(previewCase: PreviewCase) {
  mockApiPost.mockImplementation((path: string) => {
    if (path === "/ai/copilot/chat") {
      return Promise.resolve({
        message: "Draft ready",
        intent: previewCase.name,
        [previewCase.previewKey]: previewCase.preview,
      });
    }
    return Promise.resolve({});
  });

  const screen = renderScreen();
  fireEvent.press(screen.getByText("copilot.quickActions.reportIssue"));
  await waitFor(() => expect(screen.getByText("copilot.create")).toBeTruthy());
  return screen;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe.each(previewCases)("CopilotScreen $name confirmation", (previewCase) => {
  it("preserves the create request and reports success with a toast", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());

    try {
      const screen = await openPreview(previewCase);
      fireEvent.press(screen.getByText("copilot.create"));

      await waitFor(() =>
        expect(mockApiPost).toHaveBeenCalledWith(
          previewCase.endpoint,
          previewCase.expectedPayload,
        ),
      );
      expect(mockToast.success).toHaveBeenCalledWith(previewCase.successKey);
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
    }
  });

  it("reports the create error with a toast", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    const screen = await openPreview(previewCase);
    mockApiPost.mockRejectedValueOnce(new Error("offline"));

    try {
      fireEvent.press(screen.getByText("copilot.create"));

      await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("offline"));
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
    }
  });
});

describe("CopilotScreen prefill deep-link", () => {
  it("auto-sends the prefill param as the opening message exactly once", async () => {
    mockUseLocalSearchParams.mockReturnValueOnce({ prefill: "Reassign 313, 314" });
    mockApiPost.mockResolvedValue({ message: "Done", intent: "general" });

    const screen = renderScreen();

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/ai/copilot/chat", {
        message: "Reassign 313, 314",
        context: { source: "mobile", role: "housekeeper" },
      }),
    );
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reassign 313, 314")).toBeTruthy();
  });

  it("does not send anything when there is no prefill param", async () => {
    renderScreen();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

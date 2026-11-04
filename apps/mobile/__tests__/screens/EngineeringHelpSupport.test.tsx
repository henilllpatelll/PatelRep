import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";

let mockLanguage: "en" | "es" = "en";
let mockRole = "engineer";
let mockTopic: string | undefined;
let mockNet: { isConnected: boolean } | Error = { isConnected: true };
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockContacts = jest.fn();
const mockList = jest.fn();
const mockShare = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage), i18n: { language: mockLanguage } }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require("react-native");
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ topic: mockTopic }),
}));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: () => (mockNet instanceof Error ? Promise.reject(mockNet) : Promise.resolve(mockNet)) },
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() }, ApiError: class ApiError extends Error {} }));
jest.mock("@/lib/api/support", () => ({
  ...jest.requireActual("@/lib/api/support"),
  listMyReports: (...a: unknown[]) => mockList(...a),
  getSupportContacts: (...a: unknown[]) => mockContacts(...a),
}));
jest.mock("@/lib/support/useDiagnostics", () => ({
  useDiagnostics: () => {
    const { buildDiagnostics } = jest.requireActual("@/lib/support/diagnostics");
    return {
      ready: true,
      entries: buildDiagnostics({ appVersion: "2.0.1", build: "45", platform: "android", osVersion: "15", role: mockRole, language: mockLanguage, online: true, pending: 3, failed: 1, syncStatus: "attention" }),
    };
  },
}));
jest.mock("@/stores/appStore", () => {
  const state = () => ({
    user: { id: "user-1", tenant_id: "hotel-1", role: mockRole, language_pref: "en" },
    isOnline: true,
    hotelTimezone: null,
    myRooms: [],
  });
  return { useAppStore: Object.assign((selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state()), { getState: state }) };
});

import HelpScreen from "@/app/(app)/profile/help";
import FaqScreen from "@/app/(app)/profile/faq";
import DiagnosticsScreen from "@/app/(app)/profile/diagnostics";
import ReportScreen from "@/app/(app)/profile/report";
import MyReportsScreen from "@/app/(app)/profile/my-reports";
import { Share } from "react-native";

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockRole = "engineer";
  mockTopic = undefined;
  mockNet = { isConnected: true };
  mockList.mockResolvedValue([]);
  mockContacts.mockResolvedValue({ hotel: { name: "Lone Star Inn", phone: null }, contacts: [{ name: "Maria Lopez", role: "chief_engineer" }] });
  jest.spyOn(Share, "share").mockImplementation((...a: unknown[]) => {
    mockShare(...a);
    return Promise.resolve({ action: "sharedAction" } as never);
  });
});

describe.each(["engineer", "chief_engineer"])("Help & Support landing (%s)", (role) => {
  it("shows Quick help topics, assistance, your support and troubleshooting, and opens each", () => {
    mockRole = role;
    const { getByTestId, getByText } = render(<HelpScreen />);
    expect(getByTestId("settings-title").props.children).toBe("Help & Support");
    expect(getByText("Find answers or get assistance")).toBeTruthy();
    for (const heading of ["Quick help", "Get assistance", "Your support", "Troubleshooting"]) expect(getByText(heading)).toBeTruthy();
    for (const topic of ["workOrders", "pm", "roomsAssets", "offlineSync", "account"]) {
      fireEvent.press(getByTestId(`row-topic-${topic}`));
      expect(mockPush).toHaveBeenLastCalledWith(`/(app)/profile/faq?topic=${topic}`);
    }
    for (const [id, route] of [
      ["row-faq", "/(app)/profile/faq"],
      ["row-report", "/(app)/profile/report"],
      ["row-my-reports", "/(app)/profile/my-reports"],
      ["row-diagnostics", "/(app)/profile/diagnostics"],
    ] as const) {
      fireEvent.press(getByTestId(id));
      expect(mockPush).toHaveBeenLastCalledWith(route);
    }
  });

  it("renders the topic names and section headings in Spanish", () => {
    mockRole = role;
    mockLanguage = "es";
    const { getByText } = render(<HelpScreen />);
    expect(getByText("Órdenes de trabajo")).toBeTruthy();
    expect(getByText("Sin conexión y sincronización")).toBeTruthy();
    expect(getByText("Obtener ayuda")).toBeTruthy();
  });

  it("opens Contact Supervisor with the hotel's real people and no invented number", async () => {
    mockRole = role;
    const { getByTestId, findByText, queryByTestId } = render(<HelpScreen />);
    fireEvent.press(getByTestId("row-contact"));
    expect(await findByText("Maria Lopez")).toBeTruthy();
    expect(queryByTestId("contact-call")).toBeNull();
  });
});

describe("Help & Support for other roles", () => {
  it("keeps the original layout, with no topic rows", () => {
    mockRole = "housekeeper";
    const { getByTestId, queryByTestId, getByText } = render(<HelpScreen />);
    expect(getByText("Need help? Find an answer or report a problem.")).toBeTruthy();
    expect(queryByTestId("row-topic-workOrders")).toBeNull();
    fireEvent.press(getByTestId("row-faq"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/profile/faq");
  });
});

describe("Engineering FAQ", () => {
  it("groups questions under topic headings with accessible expand and collapse", () => {
    const { getByTestId, queryByTestId } = render(<FaqScreen />);
    for (const topic of ["workOrders", "pm", "roomsAssets", "offlineSync", "account"]) expect(getByTestId(`faq-topic-${topic}`)).toBeTruthy();
    const q = getByTestId("faq-engConflict");
    expect(q.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(q);
    expect(getByTestId("faq-engConflict").props.accessibilityState).toEqual({ expanded: true });
    expect(within(getByTestId("faq-engConflict-answer")).getByText(/did not accept it/)).toBeTruthy();
    fireEvent.press(getByTestId("faq-engConflict"));
    expect(queryByTestId("faq-engConflict-answer")).toBeNull();
  });

  it("shows only the requested topic, with a way back to all topics", () => {
    mockTopic = "pm";
    const { getByTestId, queryByTestId } = render(<FaqScreen />);
    expect(getByTestId("faq-topic-pm")).toBeTruthy();
    expect(queryByTestId("faq-topic-workOrders")).toBeNull();
    fireEvent.press(getByTestId("faq-all-topics"));
    expect(mockReplace).toHaveBeenCalledWith("/(app)/profile/faq");
  });

  it("falls back to every topic, and says so, when the topic is unknown", () => {
    mockTopic = "bogus";
    const { getByTestId } = render(<FaqScreen />);
    expect(getByTestId("faq-unknown-topic")).toBeTruthy();
    expect(getByTestId("faq-topic-workOrders")).toBeTruthy();
  });

  it("opens the Sync Center, not the Settings sync screen, from a sync answer", () => {
    const { getByTestId } = render(<FaqScreen />);
    fireEvent.press(getByTestId("faq-engRetrySync"));
    fireEvent.press(getByTestId("faq-engRetrySync-action"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/engineering-sync");
    fireEvent.press(getByTestId("faq-syncChanges"));
    fireEvent.press(getByTestId("faq-syncChanges-action"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/engineering-sync");
  });

  it("sends an equipment fault to Report an Issue, not the app-support form", () => {
    const { getByTestId } = render(<FaqScreen />);
    fireEvent.press(getByTestId("faq-engEquipmentProblem"));
    fireEvent.press(getByTestId("faq-engEquipmentProblem-action"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/work-orders/new");
  });

  it("does not show engineering topics to a housekeeper, and ignores a topic parameter for them", () => {
    mockRole = "housekeeper";
    mockTopic = "pm";
    const { queryByTestId } = render(<FaqScreen />);
    expect(queryByTestId("faq-topic-pm")).toBeNull();
    expect(queryByTestId("faq-engPmFind")).toBeNull();
    expect(queryByTestId("faq-hkReclean")).toBeTruthy();
    expect(queryByTestId("faq-unknown-topic")).toBeNull();
  });

  it("works in Spanish", () => {
    mockLanguage = "es";
    const { getByText } = render(<FaqScreen />);
    expect(getByText("¿Qué es un conflicto de sincronización?")).toBeTruthy();
  });
});

describe("Report a Problem (engineering)", () => {
  it("points maintenance faults to Report an Issue and lists only engineering areas", () => {
    const { getByTestId, queryByTestId } = render(<ReportScreen />);
    expect(getByTestId("report-maintenance-note")).toBeTruthy();
    fireEvent.press(getByTestId("report-maintenance-action"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/work-orders/new");
    expect(queryByTestId("report-area-housekeeping")).toBeNull();
  });

  it("shows no maintenance note to other roles", () => {
    mockRole = "housekeeper";
    expect(render(<ReportScreen />).queryByTestId("report-maintenance-note")).toBeNull();
  });
});

describe("My Reports (engineering)", () => {
  it("shows the empty state with a working Report a Problem action", async () => {
    const { findByTestId } = render(<MyReportsScreen />);
    fireEvent.press(await findByTestId("reports-empty-action"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/profile/report");
  });

  it("shows a load failure with Retry", async () => {
    mockList.mockRejectedValueOnce(new Error("offline"));
    const r = render(<MyReportsScreen />);
    fireEvent.press(await r.findByTestId("reports-retry"));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});

describe("Diagnostics (engineering)", () => {
  it("shows the real values and opens the Sync Center and Report a Problem", () => {
    const { getByTestId } = render(<DiagnosticsScreen />);
    expect(within(getByTestId("diagnostic-app_version")).getByText("2.0.1")).toBeTruthy();
    expect(within(getByTestId("diagnostic-pending_changes")).getByText("3")).toBeTruthy();
    fireEvent.press(getByTestId("diagnostics-open-sync"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/engineering-sync");
    fireEvent.press(getByTestId("diagnostics-report"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/profile/report");
  });

  it("opens the Settings sync screen for other roles", () => {
    mockRole = "housekeeper";
    const { getByTestId } = render(<DiagnosticsScreen />);
    fireEvent.press(getByTestId("diagnostics-open-sync"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/profile/sync");
  });

  it("checks the connection on request and reports the result in words", async () => {
    const { getByTestId, findByTestId } = render(<DiagnosticsScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("diagnostics-check-connection"));
    });
    expect((await findByTestId("diagnostics-check-result")).props.children).toBe("This phone has a connection.");
    mockNet = { isConnected: false };
    await act(async () => {
      fireEvent.press(getByTestId("diagnostics-check-connection"));
    });
    expect((await findByTestId("diagnostics-check-result")).props.children).toMatch(/no connection/);
    mockNet = new Error("boom");
    await act(async () => {
      fireEvent.press(getByTestId("diagnostics-check-connection"));
    });
    expect((await findByTestId("diagnostics-check-result")).props.children).toMatch(/Couldn't check/);
  });

  it("shares only the previewed fields, and only when asked", async () => {
    const { getByTestId } = render(<DiagnosticsScreen />);
    expect(mockShare).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("diagnostics-open-share"));
    await act(async () => {
      fireEvent.press(getByTestId("diagnostics-share"));
    });
    const message: string = mockShare.mock.calls[0][0].message;
    expect(message).toContain("App version: 2.0.1");
    expect(message.toLowerCase()).not.toMatch(/token|password|tenant|hotel-1|user-1/);
  });
});

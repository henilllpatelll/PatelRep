import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";

let mockLanguage: "en" | "es" = "en";
let mockRole = "housekeeper";
let mockOnline = true;
let mockReady = true;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSubmit = jest.fn();
const mockList = jest.fn();
const mockContacts = jest.fn();
const mockShare = jest.fn();
const mockOpenURL = jest.fn().mockResolvedValue(undefined);

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
  useLocalSearchParams: () => ({ from: "/(app)/tasks" }),
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));
jest.mock("@/lib/api/support", () => ({
  ...jest.requireActual("@/lib/api/support"),
  submitProblemReport: (...a: unknown[]) => mockSubmit(...a),
  listMyReports: (...a: unknown[]) => mockList(...a),
  getSupportContacts: (...a: unknown[]) => mockContacts(...a),
}));
jest.mock("@/lib/support/useDiagnostics", () => ({
  useDiagnostics: () => {
    const { buildDiagnostics } = jest.requireActual("@/lib/support/diagnostics");
    return {
      ready: mockReady,
      entries: buildDiagnostics({ appVersion: "2.0.1", build: "45", platform: "ios", osVersion: "18.0", role: mockRole, language: mockLanguage, online: mockOnline, pending: 2, failed: 0, syncStatus: "waiting" }),
    };
  },
}));
jest.mock("@/stores/appStore", () => {
  const state = () => ({
    user: { id: "user-1", tenant_id: "hotel-1", role: mockRole, language_pref: "en" },
    isOnline: mockOnline,
    hotelTimezone: null,
    myRooms: [],
  });
  return {
    useAppStore: Object.assign((selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state()), { getState: state }),
  };
});

import HelpScreen from "@/app/(app)/profile/help";
import FaqScreen from "@/app/(app)/profile/faq";
import ReportScreen from "@/app/(app)/profile/report";
import MyReportsScreen from "@/app/(app)/profile/my-reports";
import DiagnosticsScreen from "@/app/(app)/profile/diagnostics";
import { ApiError } from "@/lib/api/client";
import { Linking, Share } from "react-native";

const LONG = "The task list never loads after I open it.";

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockLanguage = "en";
  mockRole = "housekeeper";
  mockOnline = true;
  mockReady = true;
  mockSubmit.mockResolvedValue({ id: "abcd1234-0000-4000-8000-000000000000", status: "open", created_at: "2026-10-15T12:00:00Z", replayed: false });
  mockList.mockResolvedValue([]);
  mockContacts.mockResolvedValue({ hotel: { name: "Lone Star Inn", phone: "(512) 555-0100" }, contacts: [{ name: "Ana Ruiz", role: "housekeeping_supervisor" }] });
  jest.spyOn(Linking, "openURL").mockImplementation((...a: unknown[]) => mockOpenURL(...a) as never);
  jest.spyOn(Share, "share").mockImplementation((...a: unknown[]) => {
    mockShare(...a);
    return Promise.resolve({ action: "sharedAction" } as never);
  });
});

describe("Help & Support home", () => {
  it("shows the five destinations and opens each", () => {
    const { getByTestId, getByText } = render(<HelpScreen />);
    expect(getByTestId("settings-title").props.children).toBe("Help & Support");
    expect(getByText("Need help? Find an answer or report a problem.")).toBeTruthy();
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

  it("renders in Spanish", () => {
    mockLanguage = "es";
    const { getByText } = render(<HelpScreen />);
    expect(getByText("Preguntas frecuentes")).toBeTruthy();
    expect(getByText("Reportar un problema")).toBeTruthy();
  });

  it("opens the supervisor sheet with the hotel's real people and phone", async () => {
    const { getByTestId, findByText } = render(<HelpScreen />);
    fireEvent.press(getByTestId("row-contact"));
    expect(await findByText("Ana Ruiz")).toBeTruthy();
    expect(await findByText("HK Supervisor")).toBeTruthy();
    fireEvent.press(getByTestId("contact-call"));
    expect(mockOpenURL).toHaveBeenCalledWith("tel:5125550100");
  });

  it("says plainly when the hotel has set up no contact, and never invents one", async () => {
    mockContacts.mockResolvedValue({ hotel: { name: "Lone Star Inn", phone: null }, contacts: [] });
    const { getByTestId, findByTestId, queryByTestId, findByText } = render(<HelpScreen />);
    fireEvent.press(getByTestId("row-contact"));
    expect(await findByTestId("contact-none")).toBeTruthy();
    expect(await findByText("Your hotel hasn't added a support contact yet.")).toBeTruthy();
    expect(queryByTestId("contact-call")).toBeNull();
  });

  it("does not offer a call button for an unusable phone value", async () => {
    mockContacts.mockResolvedValue({ hotel: { name: "x", phone: "ask front desk" }, contacts: [{ name: "Pat", role: "gm" }] });
    const { getByTestId, findByText, queryByTestId } = render(<HelpScreen />);
    fireEvent.press(getByTestId("row-contact"));
    await findByText("Pat");
    expect(queryByTestId("contact-call")).toBeNull();
  });

  it("offers a retry when contacts cannot load", async () => {
    mockContacts.mockRejectedValueOnce(new Error("offline"));
    const { getByTestId, findByTestId } = render(<HelpScreen />);
    fireEvent.press(getByTestId("row-contact"));
    fireEvent.press(await findByTestId("contact-retry"));
    await waitFor(() => expect(mockContacts).toHaveBeenCalledTimes(2));
  });
});

describe("FAQ", () => {
  it("expands and collapses a question with accessible state", () => {
    const { getByTestId, queryByTestId } = render(<FaqScreen />);
    const q = getByTestId("faq-refreshWork");
    expect(q.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(q);
    expect(getByTestId("faq-refreshWork").props.accessibilityState).toEqual({ expanded: true });
    expect(within(getByTestId("faq-refreshWork-answer")).getByText(/Pull down on a list/)).toBeTruthy();
    fireEvent.press(getByTestId("faq-refreshWork"));
    expect(queryByTestId("faq-refreshWork-answer")).toBeNull();
  });

  it("shows only one answer at a time", () => {
    const { getByTestId, queryByTestId } = render(<FaqScreen />);
    fireEvent.press(getByTestId("faq-refreshWork"));
    fireEvent.press(getByTestId("faq-useOffline"));
    expect(queryByTestId("faq-refreshWork-answer")).toBeNull();
    expect(getByTestId("faq-useOffline-answer")).toBeTruthy();
  });

  it("shows role questions only for that role", () => {
    const hk = render(<FaqScreen />);
    expect(hk.queryByTestId("faq-hkReclean")).toBeTruthy();
    expect(hk.queryByTestId("faq-gmAdmin")).toBeNull();
    hk.unmount();
    mockRole = "gm";
    const gm = render(<FaqScreen />);
    expect(gm.queryByTestId("faq-gmAdmin")).toBeTruthy();
    expect(gm.queryByTestId("faq-hkReclean")).toBeNull();
  });

  it("opens existing destinations from an answer", () => {
    const { getByTestId } = render(<FaqScreen />);
    fireEvent.press(getByTestId("faq-syncChanges"));
    fireEvent.press(getByTestId("faq-syncChanges-action"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/sync");
    fireEvent.press(getByTestId("faq-changeLanguage"));
    fireEvent.press(getByTestId("faq-changeLanguage-action"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/profile/language");
  });

  it("works with no network and in Spanish", () => {
    mockOnline = false;
    mockLanguage = "es";
    const { getByText, getByTestId } = render(<FaqScreen />);
    expect(getByText("¿Cómo actualizo mi trabajo?")).toBeTruthy();
    fireEvent.press(getByTestId("faq-refreshWork"));
    expect(getByText(/Desliza hacia abajo en una lista/)).toBeTruthy();
    expect(mockContacts).not.toHaveBeenCalled();
  });
});

describe("Report a Problem", () => {
  const fill = (r: ReturnType<typeof render>, text = LONG) => {
    fireEvent.press(r.getByTestId("report-area-tasks"));
    fireEvent.changeText(r.getByTestId("report-message"), text);
  };

  it("only lists areas for the role", () => {
    const hk = render(<ReportScreen />);
    expect(hk.queryByTestId("report-area-tasks")).toBeTruthy();
    expect(hk.queryByTestId("report-area-work_orders")).toBeNull();
    hk.unmount();
    mockRole = "engineer";
    const eng = render(<ReportScreen />);
    expect(eng.queryByTestId("report-area-work_orders")).toBeTruthy();
    expect(eng.queryByTestId("report-area-housekeeping")).toBeNull();
  });

  it("rejects an empty report, a short one, and a missing category, without calling the server", async () => {
    const r = render(<ReportScreen />);
    fireEvent.press(r.getByTestId("report-submit"));
    expect(r.getByText("Please describe what happened.")).toBeTruthy();
    fireEvent.changeText(r.getByTestId("report-message"), "short");
    fireEvent.press(r.getByTestId("report-submit"));
    expect(r.getByText(/at least 10 characters/)).toBeTruthy();
    fireEvent.changeText(r.getByTestId("report-message"), LONG);
    fireEvent.press(r.getByTestId("report-submit"));
    expect(r.getByText("Choose what the problem is about.")).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("marks the chosen category with a check, not only colour", () => {
    const r = render(<ReportScreen />);
    fireEvent.press(r.getByTestId("report-area-sync"));
    expect(r.getByTestId("report-area-sync").props.accessibilityState).toEqual({ selected: true });
    expect(r.getByTestId("report-area-tasks").props.accessibilityState).toEqual({ selected: false });
    expect(within(r.getByTestId("report-area-sync")).getByTestId("icon-checkmark")).toBeTruthy();
  });

  it("sends the report, waits for the server, then shows the real reference and clears the draft", async () => {
    const r = render(<ReportScreen />);
    fill(r);
    await act(async () => {
      fireEvent.press(r.getByTestId("report-submit"));
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit.mock.calls[0][0]).toMatchObject({ area: "tasks", message: LONG, blocking: false, sourceScreen: "/(app)/tasks" });
    expect(mockSubmit.mock.calls[0][0].diagnostics).toBeUndefined();
    expect(r.getByTestId("report-success")).toBeTruthy();
    expect(r.getByText("Reference: ABCD1234")).toBeTruthy();
    expect(await AsyncStorage.getItem("@patelrep/mobile/report-draft:hotel-1:user-1")).toBeNull();
  });

  it("does not file twice when Submit is pressed again while it is sending", async () => {
    let finish!: (v: unknown) => void;
    mockSubmit.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const r = render(<ReportScreen />);
    fill(r);
    fireEvent.press(r.getByTestId("report-submit"));
    fireEvent.press(r.getByTestId("report-submit"));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: "abcd1234-0000", status: "open", created_at: "x", replayed: false }));
  });

  it("keeps everything the person wrote when the server fails, and retries with the same request id", async () => {
    mockSubmit.mockRejectedValueOnce(new Error("Network request failed"));
    const r = render(<ReportScreen />);
    fill(r);
    await act(async () => {
      fireEvent.press(r.getByTestId("report-submit"));
    });
    expect(r.queryByTestId("report-success")).toBeNull();
    expect(r.getByTestId("report-problem")).toBeTruthy();
    expect(r.getByTestId("report-message").props.value).toBe(LONG);
    expect(r.getByTestId("report-area-tasks").props.accessibilityState).toEqual({ selected: true });
    expect(await AsyncStorage.getItem("@patelrep/mobile/report-draft:hotel-1:user-1")).toContain(LONG);

    await act(async () => {
      fireEvent.press(r.getByTestId("report-submit"));
    });
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(mockSubmit.mock.calls[1][0].clientRequestId).toBe(mockSubmit.mock.calls[0][0].clientRequestId);
    expect(r.getByTestId("report-success")).toBeTruthy();
  });

  it("explains a rate limit without claiming success", async () => {
    mockSubmit.mockRejectedValueOnce(new ApiError("Too many", 429));
    const r = render(<ReportScreen />);
    fill(r);
    await act(async () => {
      fireEvent.press(r.getByTestId("report-submit"));
    });
    expect(r.getByText(/several reports recently/)).toBeTruthy();
    expect(r.queryByTestId("report-success")).toBeNull();
  });

  it("offline: sends nothing, says so, and keeps an unsent draft", async () => {
    mockOnline = false;
    const r = render(<ReportScreen />);
    fill(r);
    await act(async () => {
      fireEvent.press(r.getByTestId("report-submit"));
    });
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(r.getByText(/You're offline, so the report can't be sent yet/)).toBeTruthy();
    expect(r.queryByTestId("report-success")).toBeNull();
    expect(await AsyncStorage.getItem("@patelrep/mobile/report-draft:hotel-1:user-1")).toContain(LONG);
  });

  it("restores this person's unsent draft and lets them discard it after confirming", async () => {
    await AsyncStorage.setItem(
      "@patelrep/mobile/report-draft:hotel-1:user-1",
      JSON.stringify({ area: "sync", message: "Saved earlier but never sent", blocking: true, includeDiagnostics: false, requestId: "req-9" }),
    );
    const r = render(<ReportScreen />);
    await waitFor(() => expect(r.getByTestId("report-message").props.value).toBe("Saved earlier but never sent"));
    expect(r.getByTestId("report-draft-note")).toBeTruthy();
    fireEvent.press(r.getByTestId("report-discard"));
    fireEvent.press(r.getByTestId("report-discard-keep"));
    expect(r.getByTestId("report-message").props.value).toBe("Saved earlier but never sent");
    fireEvent.press(r.getByTestId("report-discard"));
    await act(async () => {
      fireEvent.press(r.getByTestId("report-discard-confirm"));
    });
    expect(r.getByTestId("report-message").props.value).toBe("");
    expect(await AsyncStorage.getItem("@patelrep/mobile/report-draft:hotel-1:user-1")).toBeNull();
  });

  it("never loads another person's draft", async () => {
    await AsyncStorage.setItem(
      "@patelrep/mobile/report-draft:hotel-1:user-2",
      JSON.stringify({ area: "sync", message: "Somebody else's words", blocking: false, includeDiagnostics: false, requestId: "req-2" }),
    );
    const r = render(<ReportScreen />);
    await act(async () => undefined);
    expect(r.getByTestId("report-message").props.value).toBe("");
  });

  it("attaches diagnostics only when asked, after a preview of exactly those fields", async () => {
    const r = render(<ReportScreen />);
    expect(r.queryByTestId("report-view-diagnostics")).toBeNull();
    fireEvent.press(r.getByTestId("report-diagnostics"));
    fireEvent.press(r.getByTestId("report-view-diagnostics"));
    expect(r.getByTestId("diagnostic-app_version")).toBeTruthy();
    expect(r.getByTestId("diagnostic-pending_changes")).toBeTruthy();
    expect(r.queryByTestId("diagnostic-access_token")).toBeNull();
    fireEvent.press(r.getByTestId("diagnostics-cancel"));
    fill(r);
    await act(async () => {
      fireEvent.press(r.getByTestId("report-submit"));
    });
    expect(mockSubmit.mock.calls[0][0].diagnostics).toMatchObject({ app_version: "2.0.1", platform: "ios", pending_changes: 2 });
    expect(Object.keys(mockSubmit.mock.calls[0][0].diagnostics)).not.toContain("guest_name");
  });

  it("flags a report as blocking only when the person says so", async () => {
    const r = render(<ReportScreen />);
    fireEvent.press(r.getByTestId("report-blocking"));
    fill(r);
    await act(async () => {
      fireEvent.press(r.getByTestId("report-submit"));
    });
    expect(mockSubmit.mock.calls[0][0].blocking).toBe(true);
  });

  it("is available in Spanish", () => {
    mockLanguage = "es";
    const r = render(<ReportScreen />);
    expect(r.getByTestId("settings-title").props.children).toBe("Reportar un problema");
    expect(r.getByText("Enviar reporte")).toBeTruthy();
  });
});

describe("My Reports", () => {
  it("shows an honest empty state with a way to report", async () => {
    const r = render(<MyReportsScreen />);
    expect(await r.findByTestId("reports-empty")).toBeTruthy();
    fireEvent.press(r.getByTestId("reports-empty-action"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/report");
  });

  it("lists real reports with their real server status as words, and opens a detail", async () => {
    mockList.mockResolvedValue([
      { id: "1", category: "bug", area: "tasks", severity: "blocking", message: "Tasks never load", status: "reviewing", source: "mobile", created_at: "2026-10-14T12:00:00Z", updated_at: null },
      { id: "2", category: "other", area: null, severity: "annoying", message: "Odd colours", status: "closed", source: "mobile", created_at: "2026-10-10T12:00:00Z", updated_at: null },
    ]);
    const r = render(<MyReportsScreen />);
    const rows = await r.findAllByTestId("report-row");
    expect(rows).toHaveLength(2);
    expect(r.getByText("In review")).toBeTruthy();
    expect(r.getByText("Closed")).toBeTruthy();
    fireEvent.press(rows[0]);
    expect(r.getByTestId("report-detail-message").props.children).toBe("Tasks never load");
    expect(r.getByText("No reply has been added to this report.")).toBeTruthy();
    expect(r.getByText(/Marked as stopping work/)).toBeTruthy();
  });

  it("shows a retry when the list cannot load", async () => {
    mockList.mockRejectedValueOnce(new Error("offline"));
    const r = render(<MyReportsScreen />);
    fireEvent.press(await r.findByTestId("reports-retry"));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});

describe("App Diagnostics", () => {
  it("shows only the allowlisted fields and what is never included", () => {
    const r = render(<DiagnosticsScreen />);
    for (const key of ["app_version", "platform", "os_version", "online", "pending_changes", "failed_changes", "sync_status"]) {
      expect(r.getByTestId(`diagnostic-${key}`)).toBeTruthy();
    }
    expect(r.getByTestId("diagnostic-sync_status").props.accessibilityLabel).toBe("Sync status: Waiting");
    expect(r.getByTestId("diagnostic-online").props.accessibilityLabel).toBe("Connected: Yes");
    expect(r.getByText(/Your password or sign-in details, guest names/)).toBeTruthy();
    expect(r.queryByTestId("diagnostic-access_token")).toBeNull();
  });

  it("shares only after the person previews it and chooses Share", async () => {
    const r = render(<DiagnosticsScreen />);
    expect(mockShare).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId("diagnostics-open-share"));
    expect(r.getByTestId("diagnostics-sheet")).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(r.getByTestId("diagnostics-share"));
    });
    expect(mockShare).toHaveBeenCalledTimes(1);
    const message = mockShare.mock.calls[0][0].message as string;
    expect(message).toContain("App version: 2.0.1");
    expect(message).not.toMatch(/token|password|guest/i);
  });

  it("says when sync details are still being checked", () => {
    mockReady = false;
    const r = render(<DiagnosticsScreen />);
    expect(r.getByTestId("diagnostics-checking-note")).toBeTruthy();
  });

  it("is available in Spanish", () => {
    mockLanguage = "es";
    const r = render(<DiagnosticsScreen />);
    expect(r.getByTestId("settings-title").props.children).toBe("Diagnóstico de la app");
    expect(r.getByTestId("diagnostic-online").props.accessibilityLabel).toBe("Con conexión: Sí");
  });
});

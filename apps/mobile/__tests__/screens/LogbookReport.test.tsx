import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

const mockParams: { entryId?: string } = { entryId: "e1" };
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({ fetchLogbookReport: jest.fn() }));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ hotelTimezone: "America/Chicago", user: { language_pref: "en" } }),
}));

import { router } from "expo-router";
import i18n from "@/i18n";
import LogbookReportScreen from "@/app/(app)/logbook/[entryId]";
import { fetchLogbookReport } from "@/lib/api/housekeepingSupervisor";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const load = fetchLogbookReport as jest.Mock;

const wrap = () =>
  render(
    <ThemeProvider>
      <LogbookReportScreen />
    </ThemeProvider>,
  );

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  jest.clearAllMocks();
  mockParams.entryId = "e1";
});

describe("Saved logbook report", () => {
  it("shows the saved handoff text with who saved it", async () => {
    load.mockResolvedValue({ id: "e1", content: "Housekeeping shift handoff for 2026-10-16", entryDate: "2026-10-16", createdAt: "2026-10-16T21:00:00Z", authorName: "Sam", departmentName: "Housekeeping" });
    const screen = wrap();
    expect(await screen.findByTestId("logbook-report-content")).toHaveTextContent("Housekeeping shift handoff for 2026-10-16");
    expect(screen.getByTestId("logbook-report-byline")).toHaveTextContent(/Housekeeping · Sam/);
    expect(load).toHaveBeenCalledWith("e1");
  });

  it("says so for a report that is not there, instead of showing anything else", async () => {
    load.mockRejectedValue(Object.assign(new Error("Entry not found"), { status: 404 }));
    const screen = wrap();
    expect(await screen.findByText("Report not found")).toBeTruthy();
    expect(screen.queryByTestId("logbook-report-content")).toBeNull();
  });

  it("offers a retry on other failures", async () => {
    load.mockRejectedValueOnce(new Error("Network request failed"));
    const screen = wrap();
    expect(await screen.findByText("Couldn't load this report.")).toBeTruthy();
    load.mockResolvedValueOnce({ id: "e1", content: "Back", entryDate: null, createdAt: null, authorName: null, departmentName: null });
    fireEvent.press(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("logbook-report-content")).toHaveTextContent("Back"));
  });

  it("treats a missing id as not found without calling the server", async () => {
    mockParams.entryId = undefined;
    const screen = wrap();
    expect(await screen.findByText("Report not found")).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
  });

  it("goes back", async () => {
    load.mockResolvedValue({ id: "e1", content: "x", entryDate: null, createdAt: null, authorName: null, departmentName: null });
    const screen = wrap();
    await screen.findByTestId("logbook-report-content");
    fireEvent.press(screen.getByTestId("logbook-report-back"));
    expect(router.back).toHaveBeenCalled();
  });
});

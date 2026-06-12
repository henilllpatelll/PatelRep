import React from "react";
import { render, waitFor } from "@testing-library/react-native";

const EN: Record<string, string> = {
  "inspect.kicker": "Quality gate",
  "inspect.title": "Inspections",
  "inspect.summary": "{{waiting}} waiting · {{passed}} passed today",
  "inspect.signalWaiting": "{{count}} waiting",
  "inspect.allClear": "all clear",
  "inspect.toInspect": "To inspect",
  "inspect.doneTab": "Done",
  "inspect.queueEmpty": "Queue is empty",
  "inspect.queueEmptyHint": "Submitted rooms appear here as housekeepers finish.",
  "inspect.noneDoneYet": "No inspections yet today",
  "inspect.pullToRefresh": "Pull to refresh.",
  "inspect.doneAgo": "Done {{time}}",
  "inspect.justNow": "Just now",
  "inspect.minutesAgo": "{{minutes}}m ago",
  "inspect.hoursAgo": "{{hours}}h ago",
  "inspect.notesOptional": "Notes (optional)",
  "inspect.failNotesPlaceholder": "Describe what needs attention…",
  "inspect.passNotesPlaceholder": "Any observations…",
  "inspect.submitting": "Submitting…",
  "inspect.confirmPass": "Confirm Pass",
  "inspect.confirmFail": "Confirm Fail",
  "inspect.submitError": "Could not submit inspection. Try again.",
  "inspect.modalTitlePass": "Pass Room {{room}}?",
  "inspect.modalTitleFail": "Fail Room {{room}}?",
  "inspect.result.passed": "Passed",
  "inspect.result.failed": "Failed",
  "inspect.result.conditional": "Conditional",
  "common.cancel": "Cancel",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`));
    },
    i18n: { language: "en" },
  }),
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));
jest.mock("@/lib/api/inspections", () => ({
  listInspectionTemplates: jest.fn(),
  submitInspection: jest.fn(),
}));

import { api } from "@/lib/api/client";
import { listInspectionTemplates } from "@/lib/api/inspections";
import InspectScreen from "@/app/(app)/inspect";

const mockGet = api.get as jest.Mock;
const mockTemplates = listInspectionTemplates as jest.Mock;

const mockQueue = [
  { room_id: "r-103", room_number: "103", floor: 1, cleaned_by: "Maria", cleaned_at: null, housekeeper_id: null, clean_type: null },
  { room_id: "r-107", room_number: "107", floor: 1, cleaned_by: "Lisa", cleaned_at: null, housekeeper_id: null, clean_type: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockTemplates.mockResolvedValue({ data: [{ id: "tmpl-1", name: "Standard", items: [] }] });
  mockGet
    .mockResolvedValueOnce({ data: mockQueue })
    .mockResolvedValueOnce({ data: [] });
});

describe("InspectScreen", () => {
  it("renders the hero and loads queue rooms", async () => {
    const { getByText, getAllByText } = render(<InspectScreen />);
    await waitFor(() => expect(getByText("Inspections")).toBeTruthy());
    expect(getAllByText("103").length).toBeGreaterThan(0);
    expect(getAllByText("107").length).toBeGreaterThan(0);
    expect(getByText("Maria")).toBeTruthy();
  });

  it("shows the day summary, waiting signal, and segmented tabs", async () => {
    const { getByText } = render(<InspectScreen />);
    await waitFor(() => expect(getByText("2 waiting · 0 passed today")).toBeTruthy());
    expect(getByText("2 waiting")).toBeTruthy();
    expect(getByText(/To inspect/)).toBeTruthy();
    expect(getByText("Done")).toBeTruthy();
  });
});

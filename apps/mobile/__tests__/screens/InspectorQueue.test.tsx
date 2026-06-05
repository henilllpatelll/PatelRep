import React from "react";
import { render, waitFor } from "@testing-library/react-native";

const EN: Record<string, string> = {
  "inspect.title": "Inspections",
  "inspect.passedCount": "passed",
  "inspect.today": "today",
  "inspect.inQueue": "in queue",
  "inspect.waiting": "waiting",
  "inspect.allClear": "all clear",
  "inspect.toInspect": "To inspect",
  "inspect.passedTab": "Passed",
  "inspect.queueEmpty": "Queue is empty",
  "inspect.nonePassedYet": "No passed rooms yet",
  "inspect.pullToRefresh": "Pull to refresh.",
  "inspect.roomTitle": "Room {{room}}",
  "inspect.notesOptional": "Notes (optional)",
  "inspect.failNotesPlaceholder": "Describe what needs attention…",
  "inspect.passNotesPlaceholder": "Any observations…",
  "inspect.submitting": "Submitting…",
  "inspect.confirmPass": "Confirm Pass",
  "inspect.confirmFail": "Confirm Fail",
  "inspect.submitError": "Could not submit inspection. Try again.",
  "inspect.modalTitlePass": "Pass Room {{room}}?",
  "inspect.modalTitleFail": "Fail Room {{room}}?",
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
  it("renders the title and loads queue rooms", async () => {
    const { getByText, getAllByText } = render(<InspectScreen />);
    expect(getByText("Inspections")).toBeTruthy();
    await waitFor(() => expect(getAllByText("103").length).toBeGreaterThan(0));
    expect(getAllByText("107").length).toBeGreaterThan(0);
  });

  it("shows segmented tabs and queue count in summary", async () => {
    const { getByText } = render(<InspectScreen />);
    await waitFor(() => expect(getByText("in queue")).toBeTruthy());
    expect(getByText("To inspect")).toBeTruthy();
    expect(getByText("Passed")).toBeTruthy();
  });
});

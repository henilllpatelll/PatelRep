import React from "react";
import { render, waitFor } from "@testing-library/react-native";

const EN: Record<string, string> = {
  "tasks.title": "My tasks",
  "tasks.headerMeta": "{{count}} tasks",
  "tasks.copilotKicker": "Heads up",
  "tasks.reorderBtn": "Reorder for me",
  "tasks.groupNow": "Now",
  "tasks.groupBeforeNoon": "Before 12:00",
  "tasks.groupAfternoon": "This afternoon",
  "tasks.footerHint": "Copilot keeps this ordered around your route.",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`));
    },
  }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

import TasksScreen from "@/app/(app)/tasks";

describe("TasksScreen handoff", () => {
  it("renders Tasks variation A as a shift timeline with the AI reorder nudge", async () => {
    const { getByText } = render(<TasksScreen />);

    await waitFor(() => expect(getByText("My tasks")).toBeTruthy());

    expect(getByText("Heads up")).toBeTruthy();
    expect(getByText("Reorder for me")).toBeTruthy();
    expect(getByText("Now")).toBeTruthy();
    expect(getByText("Before 12:00")).toBeTruthy();
    expect(getByText("This afternoon")).toBeTruthy();
    expect(getByText("Restock cart - floor 2")).toBeTruthy();
  });
});

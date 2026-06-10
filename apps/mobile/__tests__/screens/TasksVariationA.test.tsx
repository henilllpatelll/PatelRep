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
  "tasks.emptyTitle": "All caught up",
  "tasks.emptyMeta": "New tasks will show here when assigned.",
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
  it("renders the empty task state when no tasks are assigned", async () => {
    const { getByText } = render(<TasksScreen />);

    await waitFor(() => expect(getByText("My tasks")).toBeTruthy());

    expect(getByText("0 tasks")).toBeTruthy();
    expect(getByText("All caught up")).toBeTruthy();
    expect(getByText("New tasks will show here when assigned.")).toBeTruthy();
  });
});

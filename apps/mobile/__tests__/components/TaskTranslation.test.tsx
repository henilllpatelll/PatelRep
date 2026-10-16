import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.language ? `${key}:${options.language}` : key),
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/translation", () => ({ translateTask: jest.fn() }));

import { translateTask } from "@/lib/api/translation";
import { TaskTranslation } from "@/components/tasks/TaskTranslation";

const mockTranslate = translateTask as jest.Mock;
const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);

const reply = (taskTitle: string, taskBody: string | null) => ({
  data: {
    original: { title: taskTitle, description: taskBody },
    translated: { title: "Entregar toallas de baño adicionales", description: "Habitación 405, dos toallas" },
    target_language: "es",
    cached: false,
    ai_generated: true,
    credits_used: 0.5,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("TaskTranslation", () => {
  it("fetches nothing until the person picks a language", () => {
    const task = { id: "task-a", title: "Deliver extra bath towels", description: "Room 405, two towels" };
    const { getByTestId, queryByTestId } = wrap(<TaskTranslation task={task} offline={false} />);
    expect(getByTestId("task-translate-es")).toBeTruthy();
    expect(getByTestId("task-translate-en")).toBeTruthy();
    expect(queryByTestId("task-translate-result")).toBeNull();
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it("shows the AI translation, labelled, with the original one tap away", async () => {
    const task = { id: "task-b", title: "Deliver extra bath towels", description: "Room 405, two towels" };
    mockTranslate.mockResolvedValue(reply(task.title, task.description));
    const { getByTestId, getByText } = wrap(<TaskTranslation task={task} offline={false} />);

    fireEvent.press(getByTestId("task-translate-es"));
    await waitFor(() => expect(getByTestId("task-translate-result")).toBeTruthy());
    expect(mockTranslate).toHaveBeenCalledWith("task-b", "es");
    expect(getByTestId("task-translate-title").props.children).toBe("Entregar toallas de baño adicionales");
    expect(getByTestId("task-translate-body").props.children).toBe("Habitación 405, dos toallas");
    expect(getByText("tasks.hk.translate.badge:tasks.hk.translate.language.es")).toBeTruthy();
    expect(getByText("tasks.hk.translate.aiNote")).toBeTruthy();

    fireEvent.press(getByTestId("task-translate-toggle"));
    expect(getByTestId("task-translate-title").props.children).toBe("Deliver extra bath towels");
    expect(getByTestId("task-translate-body").props.children).toBe("Room 405, two towels");
    expect(getByText("tasks.hk.translate.originalBadge")).toBeTruthy();

    fireEvent.press(getByTestId("task-translate-toggle"));
    expect(getByTestId("task-translate-title").props.children).toBe("Entregar toallas de baño adicionales");
  });

  it("does not ask the server again for wording it already translated", async () => {
    const task = { id: "task-c", title: "Deliver extra bath towels", description: null };
    mockTranslate.mockResolvedValue(reply(task.title, null));
    const { getByTestId } = wrap(<TaskTranslation task={task} offline={false} />);
    fireEvent.press(getByTestId("task-translate-es"));
    await waitFor(() => expect(getByTestId("task-translate-result")).toBeTruthy());
    fireEvent.press(getByTestId("task-translate-es")); // hides it
    fireEvent.press(getByTestId("task-translate-es")); // shows it again
    await waitFor(() => expect(getByTestId("task-translate-result")).toBeTruthy());
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it("drops a translation the moment the task's wording changes", async () => {
    const task = { id: "task-d", title: "Deliver extra bath towels", description: "Room 405, two towels" };
    mockTranslate.mockResolvedValue(reply(task.title, task.description));
    const view = wrap(<TaskTranslation task={task} offline={false} />);
    fireEvent.press(view.getByTestId("task-translate-es"));
    await waitFor(() => expect(view.getByTestId("task-translate-result")).toBeTruthy());

    view.rerender(
      <ThemeProvider>
        <TaskTranslation task={{ ...task, description: "Room 405, FOUR towels" }} offline={false} />
      </ThemeProvider>,
    );
    expect(view.queryByTestId("task-translate-result")).toBeNull();

    fireEvent.press(view.getByTestId("task-translate-es"));
    await waitFor(() => expect(mockTranslate).toHaveBeenCalledTimes(2));
  });

  it("says translating needs a connection and asks nothing while offline", async () => {
    const task = { id: "task-e", title: "Deliver extra bath towels", description: null };
    const { getByTestId, queryByTestId } = wrap(<TaskTranslation task={task} offline />);
    fireEvent.press(getByTestId("task-translate-es"));
    await waitFor(() => expect(getByTestId("task-translate-offline")).toBeTruthy());
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(queryByTestId("task-translate-result")).toBeNull();
  });

  it("falls back to the original with a plain note when translating fails", async () => {
    const task = { id: "task-f", title: "Deliver extra bath towels", description: null };
    mockTranslate.mockRejectedValue(new Error("503"));
    const { getByTestId, queryByTestId } = wrap(<TaskTranslation task={task} offline={false} />);
    fireEvent.press(getByTestId("task-translate-en"));
    await waitFor(() => expect(getByTestId("task-translate-failed")).toBeTruthy());
    expect(queryByTestId("task-translate-result")).toBeNull();
  });

  it("rejects an empty translation instead of showing a blank card", async () => {
    const task = { id: "task-g", title: "Deliver extra bath towels", description: null };
    mockTranslate.mockResolvedValue({ data: { original: { title: task.title, description: null }, translated: { title: "  ", description: null }, target_language: "es", cached: false, ai_generated: true, credits_used: 0 } });
    const { getByTestId, queryByTestId } = wrap(<TaskTranslation task={task} offline={false} />);
    fireEvent.press(getByTestId("task-translate-es"));
    await waitFor(() => expect(getByTestId("task-translate-failed")).toBeTruthy());
    expect(queryByTestId("task-translate-result")).toBeNull();
    await act(async () => {});
  });
});

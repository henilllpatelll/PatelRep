import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { BlockedTasksSection } from "@/components/tasks/BlockedTasksSection";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}|${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")}` : key,
  }),
}));

jest.mock("@/lib/theme/useTheme", () => ({
  useTheme: () => ({
    background: "#fff",
    primaryAction: "#00f",
    onPrimary: "#fff",
    textDisabled: "#999",
    status: { pickup: "#f90", dirty: "#f00", ready: "#0a0" },
    shell: { bg: "#000", ink: "#111", ink2: "#222", ink3: "#333", line: "#444", surface: "#eee" },
  }),
}));

jest.mock("@/components/shared/evening", () => {
  const { Text } = jest.requireActual("react-native");
  return { SectionHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});

const mockFetchBlocked = jest.fn();
const mockResolve = jest.fn();
jest.mock("@/lib/api/tasks", () => ({
  fetchBlockedTasks: (...args: unknown[]) => mockFetchBlocked(...args),
  resolveBlocker: (...args: unknown[]) => mockResolve(...args),
}));

const item = (n: number) => ({
  blocker: {
    id: `b-${n}`,
    reason: "missing_supplies",
    details: "No towels on the cart",
    reported_by: "u-1",
    reported_by_name: "Maria Vega",
    reported_at: new Date(Date.now() - 90 * 60000).toISOString(),
    status: "active",
    notification_status: "queued",
  },
  task: { id: `t-${n}`, title: `Restock room ${n}`, task_type: "housekeeping", priority: "normal", assigned_to_name: "Maria Vega", room_number: `20${n}`, location_text: null },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchBlocked.mockResolvedValue({ items: [item(1), item(2)], hasMore: false });
  mockResolve.mockResolvedValue({ task: {}, blocker: null, replayed: false });
});

describe("BlockedTasksSection (supervisor)", () => {
  it("lists each unresolved report with reason, reporter, assignee and wait time", async () => {
    const { findByText, getByTestId, getAllByText } = render(<BlockedTasksSection isOnline reloadToken={0} />);

    expect(await findByText("Restock room 1")).toBeTruthy();
    expect(getByTestId("blocked-task-t-2")).toBeTruthy();
    expect(getAllByText("tasks.hk.blocker.reason.missing_supplies")).toHaveLength(2);
    expect(getAllByText("No towels on the cart")).toHaveLength(2);
    expect(getAllByText(/tasks\.blocked\.reportedBy\|name=Maria Vega/)[0]).toBeTruthy();
    expect(getAllByText(/tasks\.blocked\.waiting\|time=1h/)[0]).toBeTruthy();
  });

  it("renders nothing when nothing is blocked", async () => {
    mockFetchBlocked.mockResolvedValue({ items: [], hasMore: false });
    const { queryByTestId } = render(<BlockedTasksSection isOnline reloadToken={0} />);
    await waitFor(() => expect(mockFetchBlocked).toHaveBeenCalled());
    expect(queryByTestId("blocked-tasks-section")).toBeNull();
  });

  it("resolves with the supervisor note and removes the row only after the server confirms", async () => {
    const { findByText, getByLabelText, getByText, queryByText } = render(<BlockedTasksSection isOnline reloadToken={0} />);
    await findByText("Restock room 1");

    fireEvent.press(getByLabelText("tasks.blocked.review: Restock room 1"));
    fireEvent.changeText(getByLabelText("tasks.blocked.noteLabel"), "  Towels delivered  ");
    fireEvent.press(getByLabelText("tasks.blocked.resolve"));

    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith("t-1", "b-1", "  Towels delivered  "));
    await waitFor(() => expect(queryByText("Restock room 1")).toBeNull());
    expect(getByText("Restock room 2")).toBeTruthy();
    expect(getByText("tasks.blocked.resolved")).toBeTruthy();
  });

  it("keeps the row and says so when the server refuses", async () => {
    mockResolve.mockRejectedValue(new Error("HTTP 500"));
    const { findByText, getByLabelText, getByText } = render(<BlockedTasksSection isOnline reloadToken={0} />);
    await findByText("Restock room 1");

    fireEvent.press(getByLabelText("tasks.blocked.review: Restock room 1"));
    fireEvent.press(getByLabelText("tasks.blocked.resolve"));

    await waitFor(() => expect(getByText("tasks.blocked.resolveFailed")).toBeTruthy());
    expect(getByText("Restock room 1")).toBeTruthy();
  });

  it("does not offer to resolve while offline", async () => {
    const { findByText, getByLabelText, getByText } = render(<BlockedTasksSection isOnline={false} reloadToken={0} />);
    await findByText("Restock room 1");

    fireEvent.press(getByLabelText("tasks.blocked.review: Restock room 1"));
    expect(getByText("tasks.blocked.offline")).toBeTruthy();
    fireEvent.press(getByLabelText("tasks.blocked.resolve"));
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("shows a retry when the list can not be loaded", async () => {
    mockFetchBlocked.mockRejectedValueOnce(new Error("offline"));
    const { findByText } = render(<BlockedTasksSection isOnline reloadToken={0} />);

    fireEvent.press(await findByText("tasks.blocked.retry"));

    expect(await findByText("Restock room 1")).toBeTruthy();
  });
});

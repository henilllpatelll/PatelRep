import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require("react-native");
    return <Text testID="redirect">{href}</Text>;
  },
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/engineering/team/AssignTechnicianSheet", () => ({
  AssignTechnicianSheet: ({ target }: { target: { id: string } | null }) => {
    const { Text } = require("react-native");
    return target ? <Text testID="assign-sheet-open">{target.id}</Text> : null;
  },
}));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), info: jest.fn(), error: jest.fn() }) }));

let mockRole = "chief_engineer";
let mockOnline = true;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "u1", tenant_id: "h1", role: mockRole } })) };
});

const baseOverview = {
  generated_at: "2026-10-31T12:00:00Z",
  counts: { open: 7, overdue: 2, on_hold: 1, emergency: 1, unassigned: 3, pm_overdue: null },
  rooms_down: { total: 2, past_expected_return: 1 },
  pm_oversight: {
    overdue: [{ id: "pm-1", name: "Boiler check", asset_name: "Boiler", next_due_at: "2026-10-28T00:00:00Z" }],
    overdue_total: 1,
    repeat_defects: [{ asset_id: "a-ahu", asset_name: "AHU", count: 3 }],
    repeat_window_days: 90,
  },
  technicians: [
    { user_id: "t1", name: "Alex M.", active: 3, urgent: 1, on_hold: 0, overdue: 1 },
    { user_id: "t2", name: null, active: 0, urgent: 0, on_hold: 0, overdue: 0 },
  ],
  attention_counts: { emergency_unassigned: 1, urgent_overdue: 0, escalated: 0, on_hold: 1 },
  needs_attention: [
    { kind: "emergency_unassigned", id: "wo-9", work_order_number: 1045, title: "Water leaking under sink", priority: "emergency", status: "open", assigned_to: null, due_at: null, room_id: "r", room_number: "415" },
    { kind: "on_hold", id: "wo-4", work_order_number: 1030, title: "Replace compressor", priority: "normal", status: "on_hold", assigned_to: "t1", assigned_to_name: "Alex M.", hold_reason_code: "awaiting_parts", due_at: null, room_id: null, room_number: null },
  ],
  truncated: false,
};
let mockResource: { data: unknown; loading: boolean; refreshing: boolean; failure: string | null; reload: jest.Mock };
jest.mock("@/lib/engineering/useTeamOverview", () => ({
  useTeamOverview: () => mockResource,
  useTechnicians: () => ({ data: [], loading: false, failure: null, reload: jest.fn() }),
}));

import { router } from "expo-router";
import TeamOverviewScreen from "@/app/(app)/team/index";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const renderScreen = () =>
  render(
    <ThemeProvider>
      <TeamOverviewScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "chief_engineer";
  mockOnline = true;
  mockResource = { data: baseOverview, loading: false, refreshing: false, failure: null, reload: jest.fn() };
});

describe("Team Overview", () => {
  it("shows the verified counts, what needs attention, and each technician", () => {
    const { getByTestId, getByText } = renderScreen();
    expect(getByTestId("team-tile-open").props.accessibilityLabel).toBe("engineeringTeam.tiles.open: 7");
    expect(getByTestId("team-tile-overdue").props.accessibilityLabel).toContain("engineeringTeam.needsAttention");
    expect(getByTestId("team-attention-wo-9")).toBeTruthy();
    expect(getByTestId("team-attention-wo-4")).toBeTruthy();
    expect(getByTestId("team-tech-t1")).toBeTruthy();
    expect(getByText("engineeringTeam.workloadNote")).toBeTruthy();
  });

  it("shows an unknown PM figure as unavailable, never as zero", () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId("team-tile-pm_overdue").props.accessibilityLabel).toBe("engineeringTeam.tiles.pm_overdue: engineeringTeam.tiles.unknown");
  });

  it("invents no presence or availability for a technician with no work", () => {
    const { queryByText } = renderScreen();
    for (const word of ["Available", "Clocked in", "On break", "Online"]) expect(queryByText(word)).toBeNull();
  });

  it("opens the real work order from an attention row and the technician's work from a card", () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId("team-attention-wo-9"));
    expect(router.push).toHaveBeenCalledWith("/(app)/work-orders/wo-9");
    fireEvent.press(getByTestId("team-tech-t1"));
    expect(router.push).toHaveBeenCalledWith("/(app)/team/t1");
  });

  it("opens Available Work (open and escalated orders with no owner) from the unassigned shortcut", () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId("team-unassigned"));
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ view: "available" }) }));
  });

  it("lists overdue inspections and repeat-defect equipment from the PM records, each opening the real record", () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId("team-pm-overdue-pm-1"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/pm-1");
    fireEvent.press(getByTestId("team-pm-repeat-a-ahu"));
    expect(router.push).toHaveBeenCalledWith("/(app)/assets/a-ahu");
  });

  it("says PM detail is unavailable (not clear) when the server could not read it", () => {
    mockResource = { data: { ...baseOverview, pm_oversight: null }, loading: false, refreshing: false, failure: null, reload: jest.fn() };
    const { getByTestId, queryByTestId } = renderScreen();
    expect(getByTestId("team-pm-unavailable")).toBeTruthy();
    expect(queryByTestId("team-pm-overdue-pm-1")).toBeNull();
  });

  it("opens the assign sheet for the right order", () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId("team-attention-assign-wo-9"));
    expect(getByTestId("assign-sheet-open").props.children).toBe("wo-9");
  });

  it("a failed read is an error with Retry, not an empty team", () => {
    mockResource = { data: null, loading: false, refreshing: false, failure: "failed", reload: jest.fn() };
    const { queryByTestId, getByText } = renderScreen();
    expect(queryByTestId("team-tile-open")).toBeNull();
    fireEvent.press(getByText("common.retry"));
    expect(mockResource.reload).toHaveBeenCalled();
  });

  it("keeps the last figures with a stale banner when a refresh fails", () => {
    mockResource = { data: baseOverview, loading: false, refreshing: false, failure: "offline", reload: jest.fn() };
    const { getByTestId } = renderScreen();
    expect(getByTestId("engineering-stale-banner")).toBeTruthy();
    expect(getByTestId("team-tile-open")).toBeTruthy();
  });

  it("sends a regular engineer or any other role back out", () => {
    for (const role of ["engineer", "housekeeper", "front_desk"]) {
      mockRole = role;
      expect(renderScreen().getByTestId("redirect")).toBeTruthy();
    }
  });
});

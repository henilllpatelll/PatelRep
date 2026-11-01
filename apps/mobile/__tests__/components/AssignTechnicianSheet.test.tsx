import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/housekeeping/roomDetail/BottomSheet", () => {
  const { View } = require("react-native");
  return {
    MAX_FONT_SCALE: 1.6,
    BottomSheet: ({ visible, children, footer }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
      visible ? (
        <View>
          {children}
          {footer}
        </View>
      ) : null,
  };
});
const mockTechs = {
  data: [
    { user_id: "t-alex", name: "Alex M.", active: 3, urgent: 1, on_hold: 0, overdue: 0 },
    { user_id: "t-bea", name: "Bea Chen", active: 1, urgent: 0, on_hold: 1, overdue: 0 },
  ],
  loading: false,
  failure: null as null | string,
  reload: jest.fn(),
};
jest.mock("@/lib/engineering/useTeamOverview", () => ({ useTechnicians: () => mockTechs }));
jest.mock("@/lib/api/engineeringTeam", () => ({ assignWorkOrder: jest.fn() }));

import { assignWorkOrder } from "@/lib/api/engineeringTeam";
import { AssignTechnicianSheet } from "@/components/engineering/team/AssignTechnicianSheet";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const assign = assignWorkOrder as jest.Mock;
const target = { id: "wo-1", code: "WO-1045", title: "Water leaking under sink", priority: "emergency", assignedTo: null as string | null, assignedToName: null as string | null };

function renderSheet(over: Partial<React.ComponentProps<typeof AssignTechnicianSheet>> = {}) {
  const props = { visible: true, onClose: jest.fn(), target, scope: "h:u:team", online: true, onAssigned: jest.fn(), onNeedsRefresh: jest.fn(), ...over };
  const utils = render(
    <ThemeProvider>
      <AssignTechnicianSheet {...props} />
    </ThemeProvider>,
  );
  return { ...utils, props };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTechs.failure = null;
});

describe("Assign Technician sheet", () => {
  it("lists real technicians with plain counts and cannot confirm until one is chosen", () => {
    const { getByTestId } = renderSheet();
    expect(getByTestId("assign-tech-t-alex")).toBeTruthy();
    expect(getByTestId("assign-tech-t-bea")).toBeTruthy();
    expect(getByTestId("assign-confirm").props.accessibilityState?.disabled).toBe(true);
  });

  it("sends the assignee the manager was looking at and reports success only after the API accepts", async () => {
    assign.mockResolvedValueOnce({ changed: true, assignedTo: "t-alex" });
    const { getByTestId, props } = renderSheet();
    fireEvent.press(getByTestId("assign-tech-t-alex"));
    await act(async () => {
      fireEvent.press(getByTestId("assign-confirm"));
    });
    expect(assign).toHaveBeenCalledWith({ workOrderId: "wo-1", assignedTo: "t-alex", expectedAssignedTo: null, note: undefined });
    await waitFor(() => expect(props.onAssigned).toHaveBeenCalledWith(expect.objectContaining({ user_id: "t-alex" }), true));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does not send twice on a double press", async () => {
    let resolve!: (v: unknown) => void;
    assign.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { getByTestId } = renderSheet();
    fireEvent.press(getByTestId("assign-tech-t-alex"));
    fireEvent.press(getByTestId("assign-confirm"));
    fireEvent.press(getByTestId("assign-confirm"));
    expect(assign).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ changed: true, assignedTo: "t-alex" }));
  });

  it("keeps the sheet open, explains a conflict and asks the screen to re-read", async () => {
    assign.mockRejectedValueOnce(Object.assign(new Error("This work order was assigned by someone else."), { status: 409 }));
    const { getByTestId, props } = renderSheet({ target: { ...target, assignedTo: "t-bea", assignedToName: "Bea Chen" } });
    expect(getByTestId("assign-current")).toBeTruthy();
    fireEvent.press(getByTestId("assign-tech-t-alex"));
    await act(async () => {
      fireEvent.press(getByTestId("assign-confirm"));
    });
    await waitFor(() => expect(getByTestId("assign-error")).toBeTruthy());
    expect(props.onAssigned).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onNeedsRefresh).toHaveBeenCalled();
  });

  it("does not offer the current assignee, and asks for the reason only when reassigning", () => {
    const { getByTestId, queryByTestId } = renderSheet({ target: { ...target, assignedTo: "t-bea", assignedToName: "Bea Chen" } });
    expect(getByTestId("assign-tech-t-bea").props.accessibilityState.disabled).toBe(true);
    expect(queryByTestId("assign-note")).toBeNull();
    fireEvent.press(getByTestId("assign-tech-t-alex"));
    expect(getByTestId("assign-note")).toBeTruthy();
  });

  it("cannot assign without a connection", () => {
    const { getByTestId } = renderSheet({ online: false });
    expect(getByTestId("assign-confirm").props.accessibilityState?.disabled).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  it("filters the list by name", () => {
    const { getByTestId, queryByTestId } = renderSheet();
    fireEvent.changeText(getByTestId("assign-search"), "bea");
    expect(queryByTestId("assign-tech-t-alex")).toBeNull();
    expect(getByTestId("assign-tech-t-bea")).toBeTruthy();
  });
});

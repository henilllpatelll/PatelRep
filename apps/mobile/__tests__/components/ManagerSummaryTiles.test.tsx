import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { count?: number }) => (o && "count" in o ? `${k}:${o.count}` : k) }),
}));

import { ManagerSummaryTiles } from "@/components/engineering/work/ManagerSummaryTiles";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const none = { needsOwner: false, inProgress: false, waiting: false };

function renderTiles(over: Partial<React.ComponentProps<typeof ManagerSummaryTiles>> = {}) {
  const props = {
    counts: { needsOwner: 3, inProgress: 2, waiting: 0 },
    truncated: false,
    unavailable: false,
    stale: false,
    active: none,
    onPress: jest.fn(),
    ...over,
  };
  return { props, ...render(<ThemeProvider><ManagerSummaryTiles {...props} /></ThemeProvider>) };
}

describe("ManagerSummaryTiles", () => {
  it("shows server counts, including a real zero", () => {
    const { getByTestId } = renderTiles();
    expect(getByTestId("manager-summary-needsOwner-count").props.children).toBe("3");
    expect(getByTestId("manager-summary-waiting-count").props.children).toBe("0");
  });

  it("shows an unknown count as a dash, not zero", () => {
    const { getByTestId } = renderTiles({ counts: { needsOwner: null, inProgress: null, waiting: null }, unavailable: true });
    expect(getByTestId("manager-summary-needsOwner-count").props.children).toBe("workQueue.managerSummary.unknown");
    expect(getByTestId("wo-manager-summary-unavailable")).toBeTruthy();
  });

  it("marks counts as a floor when the server read was truncated", () => {
    const { getByTestId } = renderTiles({ truncated: true });
    expect(getByTestId("manager-summary-inProgress-count").props.children).toBe("2+");
  });

  it("labels stale figures", () => {
    const { getByTestId, queryByTestId } = renderTiles({ stale: true });
    expect(getByTestId("wo-manager-summary-stale")).toBeTruthy();
    expect(queryByTestId("wo-manager-summary-unavailable")).toBeNull();
  });

  it("reports the pressed tile and the selected state", () => {
    const { getByTestId, props } = renderTiles({ active: { ...none, waiting: true } });
    fireEvent.press(getByTestId("manager-summary-needsOwner"));
    expect(props.onPress).toHaveBeenCalledWith("needsOwner");
    expect(getByTestId("manager-summary-waiting").props.accessibilityState).toEqual({ selected: true });
  });
});

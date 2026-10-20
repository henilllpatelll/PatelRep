import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

const mockToastAndroid = { show: jest.fn() };
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { ToastAndroid } from "react-native";
import { HousekeeperPicker } from "@/components/supervisor/HousekeeperPicker";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import type { AssignableStaff, TeamLoad } from "@/lib/housekeeping/supervisor";

const tr = makeTranslator("en");
const STAFF: AssignableStaff[] = [
  { userId: "hk-1", name: "Ana Rodriguez", role: "housekeeper" },
  { userId: "hk-2", name: "Carlos Martinez", role: "housekeeper" },
  { userId: "hk-3", name: "—", role: "housekeeper" },
];
const load = (id: string, extra: Partial<TeamLoad> = {}): TeamLoad => ({
  housekeeperId: id, name: id, rooms: [], total: 5, done: 1, inProgress: 1, minutesLeft: 120, overAssigned: false, ...extra,
});

function setup(props: Partial<React.ComponentProps<typeof HousekeeperPicker>> = {}) {
  const handlers = { onSelect: jest.fn(), onClose: jest.fn() };
  const element = (extra: Partial<React.ComponentProps<typeof HousekeeperPicker>> = {}) => (
    <ThemeProvider>
      <HousekeeperPicker visible roomNumber="201" staff={STAFF} loads={[load("hk-1")]} saving={false} {...handlers} {...props} {...extra} />
    </ThemeProvider>
  );
  const screen = render(element());
  return { screen, handlers, rerenderWith: (extra: Partial<React.ComponentProps<typeof HousekeeperPicker>>) => screen.rerender(element(extra)) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(ToastAndroid, "show").mockImplementation(mockToastAndroid.show);
});

describe("HousekeeperPicker (Assignments screen)", () => {
  it("lists staff with room count and a remaining-work estimate, and one tap chooses", () => {
    const { screen, handlers } = setup();
    expect(screen.getByText("ASSIGN ROOM 201")).toBeTruthy();
    expect(screen.getByText("5 rooms · ~120 min remaining")).toBeTruthy();
    fireEvent.press(screen.getByTestId("picker-hk-1"));
    expect(handlers.onSelect).toHaveBeenCalledWith(expect.objectContaining({ userId: "hk-1" }));
  });

  it("never claims availability it does not have", () => {
    const { screen } = setup();
    expect(screen.queryByTestId("picker-hk-1-availability")).toBeNull();
    expect(screen.queryByText("On shift")).toBeNull();
    expect(screen.queryByTestId("picker-filter-on_shift")).toBeNull();
  });

  it("does not show 'Assigned' just because saving ended — the caller announces a confirmed save", () => {
    const { screen, rerenderWith } = setup({ saving: false });
    fireEvent.press(screen.getByTestId("picker-hk-1"));
    rerenderWith({ saving: true });
    rerenderWith({ saving: false });
    expect(screen.queryByText("Assigned ✓")).toBeNull();
    expect(mockToastAndroid.show).not.toHaveBeenCalled();
  });

  it("ignores taps while a save is in flight", () => {
    const { screen, handlers } = setup({ saving: true });
    fireEvent.press(screen.getByTestId("picker-hk-1"));
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("does not present a capped workload as the total", () => {
    const { screen } = setup({ loads: [load("hk-1", { minutesLeft: 480, overAssigned: true })] });
    expect(screen.getByText("5 rooms · At least 480 min remaining")).toBeTruthy();
    expect(screen.getByText(tr("roomBoard.assign.picker.overload"))).toBeTruthy();
  });

  it("shows 'No rooms yet' for someone with nothing, never '0 min'", () => {
    const { screen } = setup({ loads: [] });
    expect(screen.getAllByText("No rooms yet").length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 min/)).toBeNull();
  });

  it("searches by name and names a missing name as unavailable", () => {
    const { screen } = setup();
    expect(screen.getByText("Name unavailable")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("picker-search"), "carl");
    expect(screen.getByTestId("picker-hk-2")).toBeTruthy();
    expect(screen.queryByTestId("picker-hk-1")).toBeNull();
    fireEvent.changeText(screen.getByTestId("picker-search"), "zzz");
    expect(screen.getByText('No one matches "zzz".')).toBeTruthy();
  });

  it("says so when there is no staff, and uses the custom title for a floor", () => {
    const { screen } = setup({ staff: [], customTitle: "Assign floor 3" });
    expect(screen.getByText("Assign floor 3")).toBeTruthy();
    expect(screen.getByText("No housekeeping staff found.")).toBeTruthy();
  });

  it("rows are accessible radio buttons with a spoken name and workload", () => {
    const { screen } = setup();
    const row = screen.getByTestId("picker-hk-1");
    expect(row.props.accessibilityRole).toBe("radio");
    expect(row.props.accessibilityLabel).toContain("Ana Rodriguez");
    expect(row.props.accessibilityLabel).toContain("5 rooms");
  });
});

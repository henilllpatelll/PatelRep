import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { render } from "@testing-library/react-native";
import {
  darkTheme,
  lightTheme,
  type ThemeTokens,
} from "@/components/shared/tokens";
import type { Room } from "@/stores/appStore";

let mockTheme: ThemeTokens = lightTheme;

jest.mock("@/lib/theme/useTheme", () => ({
  useTheme: () => mockTheme,
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      typeof options?.status === "string" ? options.status : key,
  }),
}));

import {
  Chip,
  ProgressBar,
  RoomQueueCard,
  StatusPill,
  StatusRail,
  getStatusMeta,
} from "@/components/shared/evening";
import { getTileVisual } from "@/components/home/CompanionHome";

type TestNode = {
  props: {
    style?: StyleProp<ViewStyle & TextStyle>;
  };
};

function flattenStyle(node: TestNode) {
  return StyleSheet.flatten(node.props.style) ?? {};
}

function findViewByStyle(
  nodes: TestNode[],
  predicate: (style: ViewStyle & TextStyle) => boolean,
) {
  const match = nodes.find((node) => predicate(flattenStyle(node)));
  expect(match).toBeDefined();
  return match as TestNode;
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-101",
    room_number: "101",
    floor: 1,
    status: "IN_PROGRESS",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: null,
    clean_type: null,
    clean_type_label: null,
    room_type_code: "KS",
    room_type_name: "King Suite",
    rooms: { room_types: { name: "King Suite", code: "KS" } },
    ...overrides,
  };
}

describe("Evening status composites", () => {
  beforeEach(() => {
    mockTheme = lightTheme;
  });

  it("resolves status metadata from the supplied theme without changing labels", () => {
    expect(getStatusMeta("IN_PROGRESS", lightTheme)).toEqual({
      label: "In Progress",
      bg: lightTheme.status.inProgressSoft,
      fg: lightTheme.status.inProgress,
      border: lightTheme.status.inProgressLine,
    });
    expect(getStatusMeta("IN_PROGRESS", darkTheme)).toEqual({
      label: "In Progress",
      bg: darkTheme.status.inProgressSoft,
      fg: darkTheme.status.inProgress,
      border: darkTheme.status.inProgressLine,
    });
    expect(getStatusMeta("IN_PROGRESS", darkTheme).fg).not.toBe(
      darkTheme.status.pickup,
    );
    expect(getStatusMeta("WAITING", darkTheme)).toEqual({
      label: "WAITING",
      bg: darkTheme.surfaceMuted,
      fg: darkTheme.textMuted,
      border: darkTheme.border,
    });
  });

  it("renders status pills from the active theme while preserving label and dot cues", () => {
    const light = render(<StatusPill status="IN_PROGRESS" />);
    const lightLabel = light.getByText("In Progress");
    expect(flattenStyle(lightLabel).color).toBe(lightTheme.status.inProgress);

    light.unmount();
    mockTheme = darkTheme;

    const dark = render(<StatusPill status="IN_PROGRESS" />);
    const darkLabel = dark.getByText("In Progress");
    expect(flattenStyle(darkLabel).color).toBe(darkTheme.status.inProgress);
    expect(flattenStyle(darkLabel).color).not.toBe(
      lightTheme.status.inProgress,
    );

    const dot = findViewByStyle(
      dark.UNSAFE_getAllByType(View),
      (style) => style.width === 5 && style.height === 5,
    );
    expect(flattenStyle(dot).backgroundColor).toBe(
      darkTheme.status.inProgress,
    );
  });

  it("keeps the occupied rail striped and resolves both rail colors from the active theme", () => {
    mockTheme = darkTheme;
    const occupied = render(<StatusRail status="OCCUPIED" />);
    const occupiedViews = occupied.UNSAFE_getAllByType(View);
    const rail = findViewByStyle(
      occupiedViews,
      (style) => style.width === 4 && style.position === "absolute",
    );
    expect(flattenStyle(rail).backgroundColor).toBe(
      darkTheme.status.dirtySoft,
    );

    const stripes = occupiedViews.filter(
      (node) =>
        flattenStyle(node).backgroundColor === darkTheme.status.occupied,
    );
    expect(stripes).toHaveLength(4);

    occupied.unmount();
    const clean = render(<StatusRail status="CLEAN" />);
    const cleanRail = findViewByStyle(
      clean.UNSAFE_getAllByType(View),
      (style) => style.width === 4 && style.position === "absolute",
    );
    expect(flattenStyle(cleanRail).backgroundColor).toBe(
      darkTheme.status.clean,
    );
  });

  it("themes progress and chips without changing their non-color structure", () => {
    mockTheme = darkTheme;
    const progress = render(<ProgressBar value={1} total={4} />);
    const progressViews = progress.UNSAFE_getAllByType(View);
    const track = findViewByStyle(
      progressViews,
      (style) => style.overflow === "hidden" && style.height === 7,
    );
    const fill = findViewByStyle(
      progressViews,
      (style) => style.width === "25%" && style.height === 7,
    );

    expect(flattenStyle(track).backgroundColor).toBe(
      darkTheme.surfaceMuted,
    );
    expect(flattenStyle(fill).backgroundColor).toBe(
      darkTheme.status.ready,
    );

    const chip = render(<Chip tone="alert">Needs attention</Chip>);
    const chipLabel = chip.getByText("Needs attention");
    expect(flattenStyle(chipLabel).color).toBe(darkTheme.status.dirty);
    const chipShell = findViewByStyle(
      chip.UNSAFE_getAllByType(View),
      (style) => style.borderRadius === 999,
    );
    expect(flattenStyle(chipShell)).toMatchObject({
      backgroundColor: darkTheme.status.dirtySoft,
      borderColor: darkTheme.status.dirtyLine,
    });
  });

  it("keeps room queue behavior and accessible naming while using dark status tokens", () => {
    mockTheme = darkTheme;
    const onPress = jest.fn();
    const room = makeRoom();
    const screen = render(
      <RoomQueueCard
        room={room}
        onPress={onPress}
        actionLabel="Resume"
      />,
    );

    const card = screen.getByTestId("room-card-101");
    expect(card.props.accessibilityRole).toBe("button");
    expect(card.props.accessibilityLabel).toBe("Room 101");
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(flattenStyle(screen.getByText("In Progress")).color).toBe(
      darkTheme.status.inProgress,
    );
    expect(flattenStyle(screen.getByText("101")).color).toBe(
      darkTheme.textPrimary,
    );
    expect(screen.getByText("Resume")).toBeTruthy();
  });

  it("resolves mosaic visuals from the active theme and keeps in-progress purple", () => {
    expect(getTileVisual("IN_PROGRESS", lightTheme)).toMatchObject({
      bg: lightTheme.status.inProgressSoft,
      fg: lightTheme.status.inProgress,
      border: lightTheme.status.inProgressLine,
    });
    expect(getTileVisual("IN_PROGRESS", darkTheme)).toMatchObject({
      bg: darkTheme.status.inProgressSoft,
      fg: darkTheme.status.inProgress,
      border: darkTheme.status.inProgressLine,
    });
    expect(getTileVisual("IN_PROGRESS", darkTheme).fg).not.toBe(
      darkTheme.status.pickup,
    );
    expect(getTileVisual("INSPECTED", darkTheme).fg).toBe(
      darkTheme.shell.ink,
    );
  });
});

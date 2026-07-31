import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { render } from "@testing-library/react-native";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { darkTheme, lightTheme } from "@/components/shared/tokens";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

let mockSystemScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));

jest.mock("@expo/vector-icons", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  const { Text: NativeText } =
    jest.requireActual<typeof import("react-native")>("react-native");

  return {
    Ionicons: (props: Record<string, unknown>) =>
      ReactActual.createElement(NativeText, props),
  };
});

function renderThemed(ui: React.ReactElement, mode: "light" | "dark" = "light") {
  mockSystemScheme = mode;
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function flattenedStyle(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(
    node.props.style as StyleProp<ViewStyle | TextStyle>,
  ) as ViewStyle & TextStyle;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSystemScheme = "light";
  (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise(() => undefined));
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

describe("Button accessibility and semantic styling", () => {
  const sizes: ButtonSize[] = ["sm", "md", "lg"];
  const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "destructive"];

  it.each(sizes)("%s remains at least a 44pt target", (size) => {
    const screen = renderThemed(<Button label={`${size} action`} size={size} onPress={jest.fn()} />);
    const button = screen.getByRole("button", { name: `${size} action` });

    expect(flattenedStyle(button).minHeight).toBeGreaterThanOrEqual(44);
  });

  it.each(variants)("%s exposes its label as the accessible button name", (variant) => {
    const screen = renderThemed(
      <Button label={`${variant} action`} variant={variant} onPress={jest.fn()} />,
    );

    expect(screen.getByRole("button", { name: `${variant} action` })).toBeTruthy();
  });

  it("exposes disabled and busy states while preserving the loading label width", () => {
    const screen = renderThemed(
      <Button label="Save room" loading disabled onPress={jest.fn()} />,
    );
    const button = screen.getByRole("button", { name: "Save room", disabled: true, busy: true });
    const hiddenLabel = screen.getByText("Save room");

    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(flattenedStyle(hiddenLabel).opacity).toBe(0);
  });

  it("uses contrast-tested semantic foregrounds in both themes", () => {
    for (const [mode, theme] of [
      ["light", lightTheme],
      ["dark", darkTheme],
    ] as const) {
      const screen = renderThemed(
        <View>
          <Button label={`${mode} primary`} onPress={jest.fn()} />
          <Button label={`${mode} destructive`} variant="destructive" onPress={jest.fn()} />
        </View>,
        mode,
      );

      expect(flattenedStyle(screen.getByText(`${mode} primary`)).color).toBe(theme.onPrimary);
      expect(flattenedStyle(screen.getByText(`${mode} destructive`)).color).toBe(
        theme.onDestructive,
      );
    }
  });

  it("uses the tested disabled fill, foreground, and boundary", () => {
    const screen = renderThemed(
      <Button label="Unavailable" disabled onPress={jest.fn()} />,
      "dark",
    );
    const button = screen.getByRole("button", { name: "Unavailable", disabled: true });

    expect(flattenedStyle(button)).toMatchObject({
      backgroundColor: darkTheme.primarySoft,
      borderColor: darkTheme.primaryLine,
      borderWidth: 1,
    });
    expect(flattenedStyle(screen.getByText("Unavailable")).color).toBe(darkTheme.onDisabled);
  });

  it("merges caller style last", () => {
    const screen = renderThemed(
      <Button
        label="Custom"
        onPress={jest.fn()}
        style={{ minHeight: 60, backgroundColor: "rebeccapurple" }}
      />,
    );

    expect(flattenedStyle(screen.getByRole("button", { name: "Custom" }))).toMatchObject({
      minHeight: 60,
      backgroundColor: "rebeccapurple",
    });
  });
});

describe("Card dark-mode separation", () => {
  it.each([
    [false, darkTheme.surface],
    [true, darkTheme.surfaceMuted],
  ] as const)("keeps a visible tonal layer and border when dimmed=%s", (dimmed, surface) => {
    const screen = renderThemed(
      <Card dimmed={dimmed}>
        <Text>Card content</Text>
      </Card>,
      "dark",
    );
    const card = screen.UNSAFE_getAllByType(View)[0];

    expect(flattenedStyle(card)).toMatchObject({
      backgroundColor: surface,
      borderColor: darkTheme.border,
      borderWidth: 1,
    });
  });

  it("merges caller style last", () => {
    const screen = renderThemed(
      <Card style={{ borderWidth: 3 }}>
        <Text>Styled card</Text>
      </Card>,
    );

    expect(flattenedStyle(screen.UNSAFE_getAllByType(View)[0]).borderWidth).toBe(3);
  });
});

describe("StatusBadge status and non-color contracts", () => {
  const statusKeys: StatusKey[] = [
    "ready",
    "clean",
    "dirty",
    "occupied",
    "pickup",
    "outOfOrder",
    "emergency",
    "urgent",
    "low",
    "onHold",
    "overdue",
    "inProgress",
    "completed",
  ];

  it.each(statusKeys)("%s exposes one meaningful label with icon, text, and color", (statusKey) => {
    const label = `${statusKey} status`;
    const screen = renderThemed(<StatusBadge statusKey={statusKey} label={label} />, "dark");
    const badge = screen.UNSAFE_getAllByType(View)[0];

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByRole("text", { name: label })).toHaveLength(1);
    expect(badge.props.accessible).toBe(true);
    expect(badge.props.accessibilityLabel).toBe(label);
    expect(flattenedStyle(badge).backgroundColor).toBeTruthy();
    expect(screen.UNSAFE_getByType(Ionicons).props.color).toEqual(expect.any(String));
  });

  it("keeps occupied non-color-dependent with a person icon and visible label", () => {
    const screen = renderThemed(<StatusBadge statusKey="occupied" label="Occupied" />);

    expect(screen.getByText("Occupied")).toBeTruthy();
    expect(screen.UNSAFE_getByType(Ionicons).props.name).toBe("person-outline");
  });

  it("uses the dedicated in-progress purple family", () => {
    const screen = renderThemed(
      <StatusBadge statusKey="inProgress" label="In progress" />,
      "dark",
    );
    const badge = screen.UNSAFE_getAllByType(View)[0];
    const label = screen.getByText("In progress");

    expect(flattenedStyle(badge)).toMatchObject({
      backgroundColor: darkTheme.status.inProgressSoft,
      borderColor: darkTheme.status.inProgressLine,
    });
    expect(flattenedStyle(label).color).toBe(darkTheme.status.inProgress);
  });

  it("allows text growth without turning a status cue into a 44pt control", async () => {
    const screen = renderThemed(
      <StatusBadge statusKey="ready" label="Ready for supervisor inspection" />,
    );
    const badge = screen.UNSAFE_getAllByType(View)[0];
    const label = screen.getByText("Ready for supervisor inspection");

    expect(flattenedStyle(badge).minHeight).toBeLessThan(44);
    expect(label.props.numberOfLines).toBeUndefined();
    expect(flattenedStyle(label).flexShrink).toBe(1);
  });
});

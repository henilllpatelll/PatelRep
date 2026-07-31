import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  IconButton,
  Segmented,
} from "@/components/shared/mobileHandoff";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import {
  darkTheme,
  lightTheme,
} from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useReducedMotion } from "@/lib/accessibility/useReducedMotion";
import { getNavigationTheme } from "@/lib/theme/navigationTheme";
import { APPEARANCE_STORAGE_KEY } from "@/lib/theme/appearance";
import {
  ThemeProvider,
  useAppearancePreference,
} from "@/lib/theme/ThemeProvider";
import {
  ToastProvider,
  ToastViewport,
  useToastActions,
} from "@/lib/theme/ToastProvider";
import { useTheme } from "@/lib/theme/useTheme";

let mockSystemScheme: "light" | "dark" = "light";
let storedPreference: "system" | "light" | "dark" | null = null;
const mockOfflineState = { isOnline: false };

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

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "common.offline"
        ? "Offline changes will sync when connected"
        : key,
  }),
}));

jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (state: typeof mockOfflineState) => unknown) =>
    selector(mockOfflineState),
}));

function completedAnimation(): Animated.CompositeAnimation {
  return {
    start: (callback) => callback?.({ finished: true }),
    stop: jest.fn(),
    reset: jest.fn(),
  };
}

function flattenStyle(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(
    node.props.style as StyleProp<ViewStyle | TextStyle>,
  ) as ViewStyle & TextStyle;
}

function animatedValue(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  return (
    value as { __getValue?: () => number } | null | undefined
  )?.__getValue?.();
}

function AppearanceAndPrimitiveHarness() {
  const { preference, mode, setPreference, isHydrated } =
    useAppearancePreference();
  const theme = useTheme();
  const toast = useToastActions();
  const reducedMotion = useReducedMotion();
  const navigationTheme = getNavigationTheme(mode);

  return (
    <View>
      <Text testID="contract-hydrated">{String(isHydrated)}</Text>
      <Text testID="contract-mode">{mode}</Text>
      <Text testID="contract-reduced-motion">
        {String(reducedMotion)}
      </Text>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`${mode} navigation chrome`}
        testID="navigation-chrome"
        style={{
          minHeight: 44,
          backgroundColor: navigationTheme.colors.card,
          borderColor: navigationTheme.colors.border,
          borderWidth: 1,
        }}
      />
      <Segmented
        accessibilityLabel="Appearance"
        items={[
          {
            label: "System",
            active: preference === "system",
            onPress: () => void setPreference("system"),
          },
          {
            label: "Light",
            active: preference === "light",
            onPress: () => void setPreference("light"),
          },
          {
            label: "Dark",
            active: preference === "dark",
            onPress: () => void setPreference("dark"),
          },
        ]}
      />
      <Button
        label="Save room"
        loading
        onPress={jest.fn()}
        testID="busy-button"
      />
      <IconButton
        icon="close"
        accessibilityLabel="Close sheet"
        disabled
        onPress={jest.fn()}
      />
      <Segmented
        accessibilityLabel="Work filter"
        items={[
          {
            label: "Open",
            active: true,
            onPress: jest.fn(),
          },
          {
            label: "Unavailable",
            disabled: true,
            onPress: jest.fn(),
          },
        ]}
      />
      <StatusBadge
        statusKey="occupied"
        label="Occupied room"
      />
      <OfflineBanner />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show sync result"
        onPress={() => toast.show("success", "Changes synced")}
      />
      <ToastViewport topOffset={72} />
      <Text testID="active-primary">{theme.primaryAction}</Text>
    </View>
  );
}

function ContractTree() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppearanceAndPrimitiveHarness />
      </ToastProvider>
    </ThemeProvider>
  );
}

async function renderContract() {
  const screen = render(<ContractTree />);
  await waitFor(() =>
    expect(screen.getByTestId("contract-hydrated").props.children).toBe(
      "true",
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId("contract-reduced-motion").props.children,
    ).toBe("true"),
  );
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSystemScheme = "light";
  storedPreference = null;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async () =>
    storedPreference,
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    async (_key: string, value: "system" | "light" | "dark") => {
      storedPreference = value;
    },
  );

  jest.spyOn(
    AccessibilityInfo,
    "isReduceMotionEnabled",
  ).mockResolvedValue(true);
  jest.spyOn(
    AccessibilityInfo,
    "addEventListener",
  ).mockReturnValue(
    { remove: jest.fn() } as unknown as ReturnType<
      typeof AccessibilityInfo.addEventListener
    >,
  );
  jest.spyOn(Animated, "timing").mockImplementation(
    completedAnimation,
  );
  jest.spyOn(Animated, "spring").mockImplementation(
    completedAnimation,
  );
  jest.spyOn(Animated, "parallel").mockImplementation(
    completedAnimation,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("cross-primitive roles, names, states, and targets", () => {
  it.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ] as const)(
    "keeps shared controls semantic and at least 44pt in explicit %s mode",
    async (mode, theme) => {
      storedPreference = mode;
      const screen = await renderContract();

      expect(
        screen.getByRole("summary", {
          name: `${mode} navigation chrome`,
        }),
      ).toBeTruthy();
      expect(
        flattenStyle(screen.getByTestId("navigation-chrome")),
      ).toMatchObject({
        minHeight: 44,
        backgroundColor: theme.shell.surface,
        borderColor: theme.shell.line,
        borderWidth: 1,
      });

      const busyButton = screen.getByRole("button", {
        name: "Save room",
        disabled: true,
        busy: true,
      });
      expect(flattenStyle(busyButton).minHeight).toBeGreaterThanOrEqual(
        44,
      );
      expect(busyButton.props.accessibilityState).toEqual({
        disabled: true,
        busy: true,
      });

      const iconButton = screen.getByRole("button", {
        name: "Close sheet",
        disabled: true,
      });
      expect(flattenStyle(iconButton)).toMatchObject({
        width: 44,
        height: 44,
      });
      expect(iconButton.props.accessibilityState).toEqual({
        disabled: true,
      });

      const unavailable = screen.getByRole("radio", {
        name: "Unavailable",
        disabled: true,
      });
      expect(flattenStyle(unavailable).minHeight).toBeGreaterThanOrEqual(
        44,
      );
      expect(unavailable.props.accessibilityState).toEqual({
        selected: false,
        disabled: true,
      });

      const occupied = screen.getByRole("text", {
        name: "Occupied room",
      });
      expect(screen.getByText("Occupied room")).toBeTruthy();
      expect(occupied.props.accessibilityLabel).toBe("Occupied room");
      expect(screen.getByRole("alert", {
        name: "Offline changes will sync when connected",
      })).toBeTruthy();
    },
  );

  it("keeps appearance choices ordered, selected, and immediately persisted", async () => {
    const screen = await renderContract();
    const appearanceGroup = screen.getByLabelText("Appearance");
    expect(appearanceGroup.props.accessibilityRole).toBe("radiogroup");
    const appearanceLabels = new Set(["System", "Light", "Dark"]);
    const appearanceRadios = screen
      .getAllByRole("radio")
      .filter((node) =>
        appearanceLabels.has(node.props.accessibilityLabel),
      );

    expect(
      appearanceRadios.map(
        (node) => node.props.accessibilityLabel,
      ),
    ).toEqual(["System", "Light", "Dark"]);
    expect(
      screen.getByRole("radio", { name: "System" }).props
        .accessibilityState,
    ).toEqual({ selected: true, disabled: false });

    fireEvent.press(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() =>
      expect(screen.getByTestId("contract-mode").props.children).toBe(
        "dark",
      ),
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      APPEARANCE_STORAGE_KEY,
      "dark",
    );
    expect(
      screen.getByRole("radio", { name: "Dark" }).props
        .accessibilityState,
    ).toEqual({ selected: true, disabled: false });
  });
});

describe("System rerender, navigation chrome, and reduced motion", () => {
  it("reacts to System changes but keeps explicit Light stable", async () => {
    const screen = await renderContract();

    expect(screen.getByTestId("contract-mode").props.children).toBe(
      "light",
    );
    expect(
      flattenStyle(screen.getByTestId("navigation-chrome"))
        .backgroundColor,
    ).toBe(lightTheme.shell.surface);

    mockSystemScheme = "dark";
    screen.rerender(<ContractTree />);

    expect(screen.getByTestId("contract-mode").props.children).toBe(
      "dark",
    );
    expect(
      flattenStyle(screen.getByTestId("navigation-chrome"))
        .backgroundColor,
    ).toBe(darkTheme.shell.surface);

    fireEvent.press(screen.getByRole("radio", { name: "Light" }));
    expect(screen.getByTestId("contract-mode").props.children).toBe(
      "light",
    );

    mockSystemScheme = "dark";
    screen.rerender(<ContractTree />);
    expect(screen.getByTestId("contract-mode").props.children).toBe(
      "light",
    );
  });

  it("puts reduced-motion Toast directly in its final visible state", async () => {
    const screen = await renderContract();
    jest.clearAllMocks();

    fireEvent.press(
      screen.getByRole("button", { name: "Show sync result" }),
    );

    const toast = screen.getByRole("alert", {
      name: "Changes synced",
    });
    let animatedLayer = toast.parent;
    while (
      animatedLayer &&
      !StyleSheet.flatten(animatedLayer.props.style)?.opacity
    ) {
      animatedLayer = animatedLayer.parent;
    }
    const animatedStyle = StyleSheet.flatten(
      animatedLayer?.props.style,
    ) as {
      opacity?: Animated.Value;
      transform?: Array<Record<string, Animated.Value>>;
    };

    expect(Animated.timing).not.toHaveBeenCalled();
    expect(Animated.spring).not.toHaveBeenCalled();
    expect(animatedValue(animatedStyle.opacity)).toBe(1);
    expect(
      animatedValue(
        animatedStyle.transform?.[0]?.translateY,
      ),
    ).toBe(0);
  });
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type PanResponderInstance,
  type PanResponderCallbacks,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { darkTheme, lightTheme } from "@/components/shared/tokens";
import { useReducedMotion } from "@/lib/accessibility/useReducedMotion";
import {
  ToastProvider,
  ToastViewport,
  useToastActions,
  type ToastVariant,
} from "@/lib/theme/ToastProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

let mockSystemScheme: "light" | "dark" = "light";
let reduceMotionEnabled = false;
let reduceMotionListener: ((enabled: boolean) => void) | undefined;
let removeReduceMotionListener: jest.Mock;
let panResponderCallbacks: PanResponderCallbacks | undefined;
let deferredParallelCallbacks: Array<(result: { finished: boolean }) => void>;
let deferParallelCallbacks = false;

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

function animation(): Animated.CompositeAnimation {
  return {
    start: (callback) => callback?.({ finished: true }),
    stop: jest.fn(),
    reset: jest.fn(),
  };
}

function ToastHarness({ topOffset = 42 }: { topOffset?: number }) {
  const actions = useToastActions();

  return (
    <View>
      {(["success", "error", "info"] as const).map((variant) => (
        <Pressable
          key={variant}
          testID={`show-${variant}`}
          onPress={() => actions.show(variant, `${variant} message that must remain fully visible`)}
        />
      ))}
      <Pressable
        testID="show-replacement"
        onPress={() => actions.show("info", "replacement message")}
      />
      <ToastViewport topOffset={topOffset} />
    </View>
  );
}

function ToastTree({ topOffset = 42 }: { topOffset?: number }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ToastHarness topOffset={topOffset} />
      </ToastProvider>
    </ThemeProvider>
  );
}

function renderToast(mode: "light" | "dark" = "light", topOffset = 42) {
  mockSystemScheme = mode;
  return render(<ToastTree topOffset={topOffset} />);
}

function flattenedStyle(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(
    node.props.style as StyleProp<ViewStyle | TextStyle>,
  ) as ViewStyle & TextStyle;
}

function swipe(deltaX: number) {
  act(() => {
    panResponderCallbacks?.onPanResponderRelease?.(
      {} as GestureResponderEvent,
      { dx: deltaX } as PanResponderGestureState,
    );
  });
}

async function settleReducedMotion() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSystemScheme = "light";
  reduceMotionEnabled = false;
  reduceMotionListener = undefined;
  removeReduceMotionListener = jest.fn();
  panResponderCallbacks = undefined;
  deferredParallelCallbacks = [];
  deferParallelCallbacks = false;

  (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise(() => undefined));
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => {
    return reduceMotionEnabled;
  });
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(
    ((eventName: string, listener: (enabled: boolean) => void) => {
      if (eventName === "reduceMotionChanged") {
        reduceMotionListener = listener;
      }
      return { remove: removeReduceMotionListener };
    }) as unknown as typeof AccessibilityInfo.addEventListener,
  );

  jest.spyOn(Animated, "timing").mockImplementation(() => animation());
  jest.spyOn(Animated, "spring").mockImplementation(() => animation());
  jest.spyOn(Animated, "parallel").mockImplementation(
    () =>
      ({
        ...animation(),
        start: (callback?: (result: { finished: boolean }) => void) => {
          if (!callback) return;
          if (deferParallelCallbacks) {
            deferredParallelCallbacks.push(callback);
          } else {
            callback({ finished: true });
          }
        },
      }) as Animated.CompositeAnimation,
  );
  jest.spyOn(PanResponder, "create").mockImplementation((callbacks) => {
    panResponderCallbacks = callbacks;
    return { panHandlers: {} } as PanResponderInstance;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("useReducedMotion", () => {
  it("loads the OS preference, reacts live, and removes its listener", async () => {
    reduceMotionEnabled = true;
    const hook = renderHook(() => useReducedMotion());

    await waitFor(() => expect(hook.result.current).toBe(true));
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
      "reduceMotionChanged",
      expect.any(Function),
    );

    act(() => reduceMotionListener?.(false));
    expect(hook.result.current).toBe(false);

    hook.unmount();
    expect(removeReduceMotionListener).toHaveBeenCalledTimes(1);
  });
});

describe("Toast accessibility and theme contract", () => {
  it.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ] as const)("uses %s success/error/info fill, foreground, and border roles", async (mode, theme) => {
    for (const variant of ["success", "error", "info"] as ToastVariant[]) {
      const screen = renderToast(mode);
      await settleReducedMotion();
      fireEvent.press(screen.getByTestId(`show-${variant}`));
      const alert = screen.getByRole("alert");
      const message = screen.getByText(`${variant} message that must remain fully visible`);

      expect(flattenedStyle(alert)).toMatchObject({
        backgroundColor: theme.toast[variant].background,
        borderColor: theme.toast[variant].border,
        borderWidth: 1,
      });
      expect(flattenedStyle(message).color).toBe(theme.toast[variant].foreground);
      screen.unmount();
    }
  });

  it("announces one assertive alert and leaves the complete message unclipped", async () => {
    const screen = renderToast();
    await settleReducedMotion();
    fireEvent.press(screen.getByTestId("show-info"));
    const alert = screen.getByRole("alert", {
      name: "info message that must remain fully visible",
    });
    const message = screen.getByText("info message that must remain fully visible");

    expect(alert.props.accessibilityLiveRegion).toBe("assertive");
    expect(message.props.numberOfLines).toBeUndefined();
    expect(flattenedStyle(message).flexShrink).toBe(1);
    expect(screen.UNSAFE_getByType(Ionicons).props.accessible).toBe(false);
  });

  it("uses the measured topOffset unchanged", async () => {
    const screen = renderToast("light", 73);
    await settleReducedMotion();
    fireEvent.press(screen.getByTestId("show-success"));

    const positionedLayer = screen
      .UNSAFE_getAllByType(View)
      .find((node) => flattenedStyle(node)?.top === 73);
    expect(positionedLayer).toBeTruthy();
  });

  it("switches theme colors without replaying entry motion", async () => {
    const screen = renderToast("light");
    await settleReducedMotion();
    fireEvent.press(screen.getByTestId("show-success"));
    const entryCallCount = (Animated.timing as jest.Mock).mock.calls.length;

    mockSystemScheme = "dark";
    screen.rerender(<ToastTree />);

    expect((Animated.timing as jest.Mock).mock.calls).toHaveLength(entryCallCount);
    expect(flattenedStyle(screen.getByRole("alert")).backgroundColor).toBe(
      darkTheme.toast.success.background,
    );
  });
});

describe("Toast timing, replacement, and swipe behavior", () => {
  it.each([
    ["success", 3000],
    ["info", 3000],
    ["error", 5000],
  ] as const)("auto-dismisses %s after %dms", async (variant, duration) => {
    const screen = renderToast();
    await settleReducedMotion();
    fireEvent.press(screen.getByTestId(`show-${variant}`));

    act(() => jest.advanceTimersByTime(duration - 1));
    expect(screen.queryByRole("alert")).toBeTruthy();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a replacement toast when an interrupted exit reports finished=false", async () => {
    const screen = renderToast();
    await settleReducedMotion();
    fireEvent.press(screen.getByTestId("show-success"));

    deferParallelCallbacks = true;
    act(() => jest.advanceTimersByTime(3000));
    expect(deferredParallelCallbacks).toHaveLength(1);

    fireEvent.press(screen.getByTestId("show-replacement"));
    act(() => deferredParallelCallbacks[0]?.({ finished: false }));

    expect(screen.getByRole("alert", { name: "replacement message" })).toBeTruthy();
  });

  it("retains 200ms entry, 150ms exit, and the 80pt swipe threshold", async () => {
    const screen = renderToast();
    await settleReducedMotion();
    fireEvent.press(screen.getByTestId("show-info"));

    expect(Animated.timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, duration: 200 }),
    );

    swipe(80);
    expect(Animated.spring).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeTruthy();

    swipe(81);
    expect(Animated.timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 0, duration: 150 }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("skips timing and spring while reduced motion is enabled", async () => {
    reduceMotionEnabled = true;
    const screen = renderToast();
    await settleReducedMotion();
    fireEvent.press(screen.getByTestId("show-error"));

    expect(Animated.timing).not.toHaveBeenCalled();
    swipe(20);
    expect(Animated.spring).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeTruthy();

    swipe(81);
    expect(Animated.timing).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

import React from "react";
import { fireEvent, render, cleanup } from "@testing-library/react-native";
import { CopilotBubble } from "@/components/shared/CopilotBubble";

jest.mock("@expo/vector-icons", () => ({
  MaterialIcons: () => null,
  Ionicons: () => null,
}));

// PulseDot ("thinking" state) runs an Animated.loop that never resolves on
// its own — fake timers keep it from ticking on real wall-clock delays, and
// explicit unmount after each test stops the loop so it can't leak into the
// next test.
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function renderBubble(overrides: Partial<React.ComponentProps<typeof CopilotBubble>> = {}) {
  return render(
    <CopilotBubble
      state="idle"
      bottom={92}
      accessibilityLabel="Copilot"
      onPress={jest.fn()}
      onLongPress={jest.fn()}
      onPressOut={jest.fn()}
      {...overrides}
    />,
  );
}

describe("CopilotBubble", () => {
  it("renders in idle state without an unread dot", () => {
    const { getByTestId, queryByTestId } = renderBubble({ state: "idle" });

    expect(getByTestId("copilot-bubble")).toBeTruthy();
    expect(queryByTestId("copilot-bubble-unread-dot")).toBeNull();
  });

  it("shows the unread dot only in the unread state", () => {
    const { getByTestId } = renderBubble({ state: "unread" });

    expect(getByTestId("copilot-bubble-unread-dot")).toBeTruthy();
  });

  it("calls onPress on a tap", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderBubble({ onPress });

    fireEvent.press(getByTestId("copilot-bubble"));

    expect(onPress).toHaveBeenCalled();
  });

  it("calls onLongPress on a long press and onPressOut on release", () => {
    const onLongPress = jest.fn();
    const onPressOut = jest.fn();
    const { getByTestId } = renderBubble({ onLongPress, onPressOut });

    fireEvent(getByTestId("copilot-bubble"), "longPress");
    fireEvent(getByTestId("copilot-bubble"), "pressOut");

    expect(onLongPress).toHaveBeenCalled();
    expect(onPressOut).toHaveBeenCalled();
  });

  it("renders without crashing in thinking and listening states", () => {
    expect(() => renderBubble({ state: "thinking" })).not.toThrow();
    expect(() => renderBubble({ state: "listening" })).not.toThrow();
  });
});

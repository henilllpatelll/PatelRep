import React from "react";
import { StyleSheet, Text, type TextStyle, type ViewStyle } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { darkTheme, lightTheme } from "@/components/shared/tokens";
import { darkThemeV2, lightThemeV2, radiusV2 } from "@/components/shared/tokensV2";
import { AiSurface } from "@/components/ui/AiSurface";
import { AppText } from "@/components/ui/AppText";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { InteractiveRow } from "@/components/ui/InteractiveRow";
import { LinearProgress } from "@/components/ui/LinearProgress";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SearchField, TextField } from "@/components/ui/TextField";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { useTheme } from "@/lib/theme/useTheme";

let mockSystemScheme: "light" | "dark" = "light";
let mockFlag = true;

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));

jest.mock("@/lib/design/designV2", () => ({
  isDesignV2Enabled: () => mockFlag,
  resolveDesignV2Preview: () => mockFlag,
}));

jest.mock("@expo/vector-icons", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  const { Text: NativeText } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Ionicons: (props: Record<string, unknown>) => ReactActual.createElement(NativeText, props),
  };
});

type Styled = { props: { style?: unknown } };
const flat = (node: Styled) =>
  StyleSheet.flatten(node.props.style as TextStyle & ViewStyle) as TextStyle & ViewStyle;

function renderV2(ui: React.ReactElement, mode: "light" | "dark" = "light") {
  mockSystemScheme = mode;
  return render(
    <ThemeProvider>
      <DesignV2Scope>{ui}</DesignV2Scope>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockFlag = true;
  mockSystemScheme = "light";
});

describe("DesignV2Scope and useTheme", () => {
  function Probe() {
    const theme = useTheme();
    return <Text testID="probe">{theme.primaryAction}</Text>;
  }

  it("flag ON: returns V2 tokens in both modes, following the app appearance", () => {
    renderV2(<Probe />, "light");
    expect(screen.getByTestId("probe").props.children).toBe(lightThemeV2.primaryAction);
    screen.unmount();
    renderV2(<Probe />, "dark");
    expect(screen.getByTestId("probe").props.children).toBe(darkThemeV2.primaryAction);
  });

  it("flag ON: an explicit scope mode overrides the system appearance only inside the scope", () => {
    mockSystemScheme = "light";
    render(
      <ThemeProvider>
        <Probe />
        <DesignV2Scope mode="dark">
          <Text testID="inner">{""}</Text>
          <Probe />
        </DesignV2Scope>
      </ThemeProvider>,
    );
    const probes = screen.getAllByTestId("probe");
    expect(probes[0].props.children).toBe(lightTheme.primaryAction);
    expect(probes[1].props.children).toBe(darkThemeV2.primaryAction);
  });

  it("flag OFF: the scope is inert and the legacy theme is returned unchanged", () => {
    mockFlag = false;
    renderV2(<Probe />, "light");
    expect(screen.getByTestId("probe").props.children).toBe(lightTheme.primaryAction);
    screen.unmount();
    renderV2(<Probe />, "dark");
    expect(screen.getByTestId("probe").props.children).toBe(darkTheme.primaryAction);
  });

  it("outside any scope the legacy theme is used even when the flag is on", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("probe").props.children).toBe(lightTheme.primaryAction);
  });
});

describe("existing components, legacy vs V2", () => {
  it("Button keeps its legacy look with the flag off", () => {
    mockFlag = false;
    renderV2(<Button label="Go" onPress={jest.fn()} testID="b" />);
    const s = flat(screen.getByTestId("b"));
    expect(s.backgroundColor).toBe(lightTheme.primaryAction);
    expect(s.borderRadius).toBe(12);
  });

  it("Button uses V2 color and 14px radius inside an active scope", () => {
    renderV2(<Button label="Go" onPress={jest.fn()} testID="b" />);
    const s = flat(screen.getByTestId("b"));
    expect(s.backgroundColor).toBe(lightThemeV2.primaryAction);
    expect(s.borderRadius).toBe(radiusV2.control);
    expect(s.minHeight).toBeGreaterThanOrEqual(44);
  });

  it("Button 'tertiary' renders like ghost: transparent, accent text, still pressable", () => {
    const onPress = jest.fn();
    renderV2(<Button label="More" variant="tertiary" onPress={onPress} testID="t" />);
    expect(flat(screen.getByTestId("t")).backgroundColor).toBe("transparent");
    fireEvent.press(screen.getByTestId("t"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("disabled and loading Buttons cannot be pressed and expose their state", () => {
    const onPress = jest.fn();
    renderV2(<Button label="Mark clean" disabled onPress={onPress} testID="d" />);
    fireEvent.press(screen.getByTestId("d"));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("d").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("Card uses the subtle V2 edge and 16px radius", () => {
    renderV2(
      <Card testID="c">
        <Text>x</Text>
      </Card>,
    );
    const s = flat(screen.getByTestId("c"));
    expect(s.borderColor).toBe(lightThemeV2.borderSubtle);
    expect(s.borderRadius).toBe(16);
  });

  it("Card in legacy mode is unchanged", () => {
    mockFlag = false;
    renderV2(
      <Card testID="c">
        <Text>x</Text>
      </Card>,
    );
    expect(flat(screen.getByTestId("c")).borderColor).toBe(lightTheme.border);
  });

  it("StatusBadge is sentence case in V2 and keeps icon + text; legacy stays uppercase", () => {
    renderV2(<StatusBadge statusKey="dirty" label="Dirty" />);
    const v2 = flat(screen.getByText("Dirty"));
    expect(v2.textTransform).toBe("none");
    expect(v2.color).toBe(lightThemeV2.status.dirty);
    screen.unmount();
    mockFlag = false;
    renderV2(<StatusBadge statusKey="dirty" label="Dirty" />);
    expect(flat(screen.getByText("Dirty")).textTransform).toBe("uppercase");
  });

  it("StateBlock supports an offline state with retry", () => {
    const onRetry = jest.fn();
    renderV2(
      <StateBlock
        status="offline"
        offlineTitle="You are offline"
        offlineBody="Showing saved rooms."
        onRetry={onRetry}
        retryLabel="Try again"
      />,
    );
    expect(screen.getByText("You are offline")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Try again"));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("new V2 primitives", () => {
  it("AppText maps roles to the type scale and tones to theme colors", () => {
    renderV2(
      <AppText variant="title" tone="secondary" numeric>
        412
      </AppText>,
    );
    const s = flat(screen.getByText("412"));
    expect(s.fontSize).toBe(22);
    expect(s.color).toBe(lightThemeV2.textSecondary);
    expect(s.fontVariant).toEqual(["tabular-nums"]);
    expect(screen.getByText("412").props.maxFontSizeMultiplier).toBe(1.5);
  });

  it("IconButton has a >=44dp target, a spoken name and a text badge", () => {
    const onPress = jest.fn();
    renderV2(
      <IconButton icon="notifications-outline" accessibilityLabel="Notifications" badgeCount={12} onPress={onPress} testID="n" />,
    );
    const btn = screen.getByTestId("n");
    expect(flat(btn).minWidth).toBeGreaterThanOrEqual(44);
    expect(flat(btn).minHeight).toBeGreaterThanOrEqual(44);
    expect(btn.props.accessibilityLabel).toBe("Notifications, 12");
    expect(screen.getByText("9+")).toBeTruthy();
    fireEvent.press(btn);
    expect(onPress).toHaveBeenCalled();
  });

  it("LinearProgress reports a clamped accessibility value", () => {
    renderV2(<LinearProgress value={12} total={9} accessibilityLabel="Checklist, 9 of 9" testID="p" />);
    const bar = screen.getByTestId("p");
    expect(bar.props.accessibilityRole).toBe("progressbar");
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 9, now: 9 });
  });

  it("LinearProgress tolerates a zero total without NaN", () => {
    renderV2(<LinearProgress value={0} total={0} accessibilityLabel="Empty" testID="p" />);
    expect(screen.getByTestId("p").props.accessibilityValue).toEqual({ min: 0, max: 1, now: 0 });
  });

  it("SegmentedControl exposes tab semantics and reports changes", () => {
    const onChange = jest.fn();
    renderV2(
      <SegmentedControl
        accessibilityLabel="Appearance"
        value="light"
        onChange={onChange}
        testID="seg"
        options={[
          { key: "system", label: "System" },
          { key: "light", label: "Light" },
          { key: "dark", label: "Dark" },
        ]}
      />,
    );
    expect(screen.getByTestId("seg-light").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("seg-dark").props.accessibilityState).toMatchObject({ selected: false });
    expect(flat(screen.getByTestId("seg-dark")).minHeight).toBeGreaterThanOrEqual(44);
    fireEvent.press(screen.getByTestId("seg-dark"));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("TextField shows a visible label and an icon+text error", () => {
    renderV2(<TextField label="Room number" value="" onChangeText={jest.fn()} error="Required" />);
    expect(screen.getByText("Room number")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.getByLabelText("Room number")).toBeTruthy();
  });

  it("SearchField offers a clear control only when there is text", () => {
    const onClear = jest.fn();
    const { rerender } = renderV2(
      <SearchField label="Search rooms" clearLabel="Clear search" value="" onChangeText={jest.fn()} onClear={onClear} />,
    );
    expect(screen.queryByLabelText("Clear search")).toBeNull();
    rerender(
      <ThemeProvider>
        <DesignV2Scope>
          <SearchField label="Search rooms" clearLabel="Clear search" value="41" onChangeText={jest.fn()} onClear={onClear} />
        </DesignV2Scope>
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByLabelText("Clear search"));
    expect(onClear).toHaveBeenCalled();
  });

  it("MetricCard speaks label, value and caption together and can be pressable", () => {
    const onPress = jest.fn();
    renderV2(<MetricCard label="Done" value="4" caption="of 12 rooms" icon="checkmark-circle-outline" tone="ready" onPress={onPress} testID="m" />);
    expect(screen.getByTestId("m").props.accessibilityLabel).toBe("Done, 4, of 12 rooms");
    fireEvent.press(screen.getByTestId("m"));
    expect(onPress).toHaveBeenCalled();
  });

  it("InteractiveRow is a >=56dp button with a hint, and inert when disabled", () => {
    const onPress = jest.fn();
    renderV2(<InteractiveRow title="Language" subtitle="English" onPress={onPress} testID="r" />);
    expect(flat(screen.getByTestId("r")).minHeight).toBeGreaterThanOrEqual(56);
    expect(screen.getByTestId("r").props.accessibilityLabel).toBe("Language, English");
    fireEvent.press(screen.getByTestId("r"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("AiSurface always carries a literal AI chip and provenance", () => {
    renderV2(
      <AiSurface title="Briefing" aiLabel="AI" provenance="Sample text.">
        <Text>Body</Text>
      </AiSurface>,
    );
    expect(screen.getByText("AI")).toBeTruthy();
    expect(screen.getByText("Sample text.")).toBeTruthy();
  });

  it("BottomSheet renders title/body/footer when visible and closes from the header control", () => {
    const onClose = jest.fn();
    renderV2(
      <BottomSheet visible onClose={onClose} title="Report an issue" closeLabel="Close" footer={<Text>Footer</Text>}>
        <Text>Sheet body</Text>
      </BottomSheet>,
    );
    expect(screen.getByText("Report an issue")).toBeTruthy();
    expect(screen.getByText("Sheet body")).toBeTruthy();
    expect(screen.getByText("Footer")).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText("Close")[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("BottomSheet renders nothing when not visible", () => {
    renderV2(
      <BottomSheet visible={false} onClose={jest.fn()} title="Hidden" closeLabel="Close">
        <Text>Nope</Text>
      </BottomSheet>,
    );
    expect(screen.queryByText("Hidden")).toBeNull();
  });
});

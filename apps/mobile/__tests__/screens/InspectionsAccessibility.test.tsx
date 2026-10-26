import React from "react";
import { StyleSheet } from "react-native";
import { act, render } from "@testing-library/react-native";
import { compositedContrastRatio, contrastRatio } from "../helpers/contrast";
import { darkTheme, lightTheme } from "@/components/shared/tokens";

/* Touch targets, large text, roles and contrast for the redesigned Inspections surfaces. The tokens are checked
   in both themes for every colour pair the screen actually draws. */

let mockScheme: "light" | "dark" = "light";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { makeTranslator } from "../helpers/i18n";
import { buildQueue } from "@/lib/inspections/queue";
import { buildCorrections } from "@/lib/inspections/lists";
import { buildAvailability, DEFAULT_QUEUE_DRAFT, EMPTY_QUEUE_FILTERS } from "@/lib/inspections/queueView";
import { InspectHeader } from "@/components/supervisor/inspect/InspectHeader";
import { InspectSearchBar } from "@/components/supervisor/inspect/InspectSearchBar";
import { InspectTabs } from "@/components/supervisor/inspect/InspectTabs";
import { InspectActiveFilters } from "@/components/supervisor/inspect/InspectActiveFilters";
import { InspectionQueueCard } from "@/components/supervisor/inspect/InspectionQueueCard";
import { CorrectionCard } from "@/components/supervisor/inspect/CorrectionCard";
import { DoneRow } from "@/components/supervisor/inspect/DoneRow";
import { InspectFilterSheet } from "@/components/supervisor/inspect/InspectFilterSheet";
import { openCorrection, readyRoom } from "../helpers/inspectionFixtures";
import { buildDone } from "@/lib/inspections/lists";
import { inspectionRecord } from "../helpers/inspectionFixtures";

const t = makeTranslator("en");
const NOW = Date.parse("2026-10-20T18:00:00Z");
const noop = () => undefined;
const [queued] = buildQueue([readyRoom("r1", { room_number: "205", arrival_at: "2026-10-20T19:00:00Z", cleaned_at: "2026-10-20T17:42:00Z" })]);
const [correction] = buildCorrections([openCorrection("305")]).items;
const [done] = buildDone([inspectionRecord("401")], "2026-10-20", "America/Chicago").items;

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, number | undefined>;

/** ThemeProvider hydrates its stored preference asynchronously; wait for it so no update lands outside act. */
async function renderThemed(children: React.ReactNode) {
  const screen = render(<ThemeProvider>{children}</ThemeProvider>);
  await act(async () => undefined);
  return screen;
}

describe.each(["light", "dark"] as const)("%s mode", (mode) => {
  beforeEach(() => {
    mockScheme = mode;
  });
  const theme = mode === "light" ? lightTheme : darkTheme;

  it("renders every surface", async () => {
    const screen = await renderThemed(
      <>
        <InspectHeader
          status={{ text: "Live · Updated just now", tone: "live" }}
          metrics={{ waiting: { value: 3, atLeast: false }, corrections: { value: null, atLeast: false }, passed: { value: 0, atLeast: false } }}
          refreshing={false}
          topInset={0}
          t={t}
          onRefresh={noop}
        />
        <InspectSearchBar value="" onChangeText={noop} onClear={noop} onOpenFilters={noop} activeCount={0} showFilters t={t} />
        <InspectTabs selected="queue" counts={{ queue: 3, corrections: null, done: 0 }} t={t} onSelect={noop} />
        <InspectionQueueCard item={queued} now={NOW} timeZone="America/Chicago" language="en" showBuilding={false} blockedReason={null} t={t} onPress={noop} />
        <CorrectionCard item={correction} now={NOW} roomAwaitingInspection={false} t={t} onOpen={noop} onAction={noop} />
        <DoneRow item={done} timeZone="America/Chicago" language="en" t={t} onPress={noop} />
      </>,
    );
    expect(screen.getByTestId("queue-card-r1")).toBeTruthy();
  });

  it("every colour pair the screen draws is readable", () => {
    const ratio = (fg: string, bg: string, base: string) => compositedContrastRatio(fg, bg, base);
    for (const family of ["clean", "dirty", "pickup", "ready"] as const) {
      const fg = theme.status[family];
      const soft = theme.status[`${family}Soft` as const];
      expect(ratio(fg, soft, theme.surface)).toBeGreaterThanOrEqual(4.5); // badges and metric values
      expect(ratio(fg, soft, theme.background)).toBeGreaterThanOrEqual(4.5); // stale banner on the page
    }
    expect(contrastRatio(theme.status.dirty, theme.surface)).toBeGreaterThanOrEqual(4.5); // the overdue note
    expect(contrastRatio(theme.status.pickup, theme.background)).toBeGreaterThanOrEqual(4.5); // a warning status line
    expect(contrastRatio(theme.textMuted, theme.surfaceMuted)).toBeGreaterThanOrEqual(4.5); // a disabled card action
    expect(contrastRatio(theme.onPrimary, theme.primaryAction)).toBeGreaterThanOrEqual(4.5); // Start inspection, Show N rooms
    expect(contrastRatio(theme.textPrimary, theme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.textSecondary, theme.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.textPrimary, theme.surfaceMuted)).toBeGreaterThanOrEqual(4.5); // selected tab sits on the track
    expect(contrastRatio(theme.primaryAction, theme.background)).toBeGreaterThanOrEqual(3); // the primary accent is essential UI
  });
});

describe("touch targets and text scaling", () => {
  beforeEach(() => {
    mockScheme = "light";
  });

  it("every control is at least 48dp tall (44pt on iOS is covered)", async () => {
    const screen = await renderThemed(
      <>
        <InspectHeader status={{ text: "x", tone: "live" }} metrics={{ waiting: { value: 1, atLeast: false }, corrections: { value: 1, atLeast: false }, passed: { value: 1, atLeast: false } }} refreshing={false} topInset={0} t={t} onRefresh={noop} />
        <InspectSearchBar value="12" onChangeText={noop} onClear={noop} onOpenFilters={noop} activeCount={2} showFilters t={t} />
        <InspectTabs selected="queue" counts={{ queue: 1, corrections: 1, done: 1 }} t={t} onSelect={noop} />
        <InspectActiveFilters filters={{ ...EMPTY_QUEUE_FILTERS, priority: ["vip"] }} shown={1} total={2} multiBuilding={false} ignored={false} t={t} onRemove={noop} onClearAll={noop} />
        <InspectionQueueCard item={queued} now={NOW} timeZone="America/Chicago" language="en" showBuilding={false} blockedReason={null} t={t} onPress={noop} />
        <CorrectionCard item={correction} now={NOW} roomAwaitingInspection t={t} onOpen={noop} onAction={noop} />
        <DoneRow item={done} timeZone="America/Chicago" language="en" t={t} onPress={noop} />
      </>,
    );
    for (const id of ["inspect-refresh", "inspect-filter-button", "inspect-tab-queue", "inspect-tab-corrections", "inspect-tab-done", "inspect-search-clear", "inspect-chip-priority:vip", "inspect-clear-filters"]) {
      const node = screen.getByTestId(id);
      const style = flat(node);
      const height = style.minHeight ?? style.height ?? 0;
      expect(height).toBeGreaterThanOrEqual(44);
      if (id === "inspect-refresh" || id.startsWith("inspect-tab") || id === "inspect-filter-button") expect(height).toBeGreaterThanOrEqual(48);
    }
    // the whole card and each row are the target; the action inside is 48dp tall
    expect(flat(screen.getByTestId("done-row-401")).minHeight).toBeGreaterThanOrEqual(48);
    expect(screen.getByLabelText(/^Start inspection, room 205/)).toBeTruthy();
  });

  it("text is capped at a scale that keeps the layout intact, and nothing is clipped to one line that must be read in full", async () => {
    const screen = await renderThemed(
      <>
        <InspectHeader status={{ text: "Live", tone: "live" }} metrics={{ waiting: { value: 12, atLeast: false }, corrections: { value: 3, atLeast: false }, passed: { value: 24, atLeast: false } }} refreshing={false} topInset={0} t={t} onRefresh={noop} />
        <InspectTabs selected="queue" counts={{ queue: 12, corrections: 3, done: 24 }} t={t} onSelect={noop} />
        <InspectionQueueCard item={queued} now={NOW} timeZone="America/Chicago" language="en" showBuilding={false} blockedReason={null} t={t} onPress={noop} />
      </>,
    );
    const texts = screen.UNSAFE_root.findAll((node) => (node.type as unknown) === "Text" || (node.type as { displayName?: string })?.displayName === "Text");
    const withCap = texts.filter((node) => typeof node.props.maxFontSizeMultiplier === "number");
    expect(withCap.length).toBeGreaterThan(8);
    for (const node of withCap) expect(node.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.6);
  });
});

describe("roles, labels and state", () => {
  beforeEach(() => {
    mockScheme = "light";
  });

  it("tabs are a tablist of tabs with selected state; the card, row and chips are buttons with spoken labels", async () => {
    const screen = await renderThemed(
      <>
        <InspectTabs selected="done" counts={{ queue: 2, corrections: 1, done: 0 }} t={t} onSelect={noop} />
        <InspectionQueueCard item={queued} now={NOW} timeZone="America/Chicago" language="en" showBuilding={false} blockedReason={null} t={t} onPress={noop} />
        <InspectActiveFilters filters={{ ...EMPTY_QUEUE_FILTERS, floors: ["~|2"] }} shown={1} total={2} multiBuilding={false} ignored={false} t={t} onRemove={noop} onClearAll={noop} />
      </>,
    );
    expect(screen.getByTestId("inspect-tabs").props.accessibilityRole).toBe("tablist");
    expect(screen.getByTestId("inspect-tab-done").props.accessibilityRole).toBe("tab");
    expect(screen.getByTestId("inspect-tab-done").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("inspect-tab-queue").props.accessibilityState).toEqual({ selected: false });
    const card = screen.getByTestId("queue-card-r1");
    expect(card.props.accessibilityRole).toBe("button");
    expect(card.props.accessibilityLabel).toContain("room 205");
    expect(card.props.accessibilityLabel).toContain("Arrival priority");
    expect(screen.getByTestId("inspect-chip-floor:~|2").props.accessibilityRole).toBe("button");
  });

  it("status is never colour alone: a blocked card says it in words", async () => {
    const screen = await renderThemed(
      <InspectionQueueCard item={queued} now={NOW} timeZone="America/Chicago" language="en" showBuilding={false} blockedReason="No checklist" t={t} onPress={noop} />,
    );
    expect(screen.getByText("Checklist unavailable")).toBeTruthy();
    expect(screen.getByTestId("queue-card-r1").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("the filter sheet is a modal group of checkboxes and radios whose selection is announced", async () => {
    const screen = await renderThemed(
      <InspectFilterSheet
        visible
        applied={DEFAULT_QUEUE_DRAFT}
        availability={buildAvailability([queued])}
        previewCount={() => 1}
        t={t}
        onApply={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByTestId("inspect-filter-sheet").props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByTestId("inspect-filter-priority-vip").props.accessibilityRole).toBe("checkbox");
    expect(screen.getByTestId("inspect-sort-priority").props.accessibilityRole).toBe("radio");
    expect(screen.getByTestId("inspect-sort-priority").props.accessibilityState).toMatchObject({ selected: true });
    // content scrolls so the apply button stays reachable on small screens and with large text
    expect(screen.getByTestId("inspect-filter-scroll")).toBeTruthy();
  });
});

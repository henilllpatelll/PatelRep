import React from "react";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

let mockScheme: "light" | "dark" = "light";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
jest.setTimeout(30000);

import { DoneRow, locationText } from "@/components/supervisor/inspect/DoneRow";
import { HistoryFilterSheet } from "@/components/supervisor/inspect/history/HistoryFilterSheet";
import { HistoryToolbar } from "@/components/supervisor/inspect/history/HistoryToolbar";
import { InsightsSheet } from "@/components/supervisor/inspect/history/InsightsSheet";
import { QualityInsightsCard } from "@/components/supervisor/inspect/history/QualityInsightsCard";
import { ResultBadge } from "@/components/supervisor/inspect/history/ResultBadge";
import { TrendChart } from "@/components/supervisor/inspect/history/TrendChart";
import { DEFAULT_HISTORY_FILTERS, type HistoryFilters } from "@/lib/inspections/history/filters";
import { buildTrend } from "@/lib/inspections/history/insights";
import { buildHistory } from "@/lib/inspections/history/rows";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { historyInsights, historyRow } from "../helpers/inspectionFixtures";

const en = makeTranslator("en");
const es = makeTranslator("es");
const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);
const day = (date: string, rate: number | null, passed = 0, failed = 0) => ({ date, initial_passed: passed, initial_failed: failed, completed: passed + failed, first_pass_rate: rate });

beforeEach(() => {
  mockScheme = "light";
});

describe("ResultBadge", () => {
  it("says the outcome in words, with historical conditional kept apart", () => {
    const screen = wrap(
      <>
        <ResultBadge result="passed" t={en} testID="p" />
        <ResultBadge result="failed" t={en} testID="f" />
        <ResultBadge result="conditional" t={en} testID="c" />
      </>,
    );
    expect(within(screen.getByTestId("p")).getByText("Passed")).toBeTruthy();
    expect(within(screen.getByTestId("f")).getByText("Failed")).toBeTruthy();
    expect(within(screen.getByTestId("c")).getByText("Conditional (historical)")).toBeTruthy();
  });

  it("is Spanish too", () => {
    const screen = wrap(<ResultBadge result="conditional" t={es} testID="c" />);
    expect(within(screen.getByTestId("c")).getByText("Condicional (histórica)")).toBeTruthy();
  });
});

describe("DoneRow", () => {
  const item = buildHistory([historyRow("205", { building: "A", floor: 2 })]).items[0];

  it("reads out room, outcome, inspector, time and place for a screen reader", () => {
    const onPress = jest.fn();
    const screen = wrap(<DoneRow item={item} timeZone="America/Chicago" language="en" t={en} showBuilding onPress={onPress} />);
    expect(screen.getByTestId("done-row-205").props.accessibilityLabel).toBe("Room 205, Passed, Sam Supervisor, 11:00 AM. A · Floor 2");
    fireEvent.press(screen.getByTestId("done-row-205"));
    expect(onPress).toHaveBeenCalledWith(item);
  });

  it("hides the building when the hotel has one, and says 'reinspection' when it is one", () => {
    const re = buildHistory([historyRow("205", { building: "A", is_reinspection: true, reinspection_of: "x" })]).items[0];
    expect(locationText(re, false, en)).toBe("Floor 2");
    expect(locationText({ floor: null, building: null }, true, en)).toBeNull();
    const screen = wrap(<DoneRow item={re} timeZone="America/Chicago" language="en" t={en} onPress={jest.fn()} />);
    expect(screen.getByTestId("done-row-205").props.accessibilityLabel).toMatch(/^Room 205, reinspection, Passed/);
  });

  it("labels a missing room and a missing inspector instead of leaving a blank", () => {
    const blank = buildHistory([historyRow("x", { room_number: "", inspector_display_name: null })]).items[0];
    const screen = wrap(<DoneRow item={blank} timeZone="America/Chicago" language="en" t={en} onPress={jest.fn()} />);
    expect(screen.getByText("Room not recorded")).toBeTruthy();
    expect(screen.getByText("Inspector not recorded")).toBeTruthy();
  });
});

describe("TrendChart", () => {
  const trend = buildTrend([day("2026-10-19", 1, 4, 0), day("2026-10-20", null), day("2026-10-21", 0.5, 2, 2)], false)!;

  it("draws a gap - not a 0% bar - for a day with no first inspections, and is one accessible summary", () => {
    const screen = wrap(<TrendChart trend={trend} language="en" t={en} />);
    // the bars are decoration for sighted users: the chart is read as ONE summary, so they are hidden from the a11y tree
    const hidden = { includeHiddenElements: true };
    expect(screen.getByTestId("trend-bar-2026-10-19", hidden)).toBeTruthy();
    expect(screen.getByTestId("trend-gap-2026-10-20", hidden)).toBeTruthy();
    expect(screen.queryByTestId("trend-bar-2026-10-20", hidden)).toBeNull();
    expect(screen.queryByTestId("trend-bar-2026-10-19")).toBeNull();
    expect(screen.getByTestId("insights-trend-chart").props.accessibilityLabel).toBe("Daily first-pass rate over 3 days, 2 with inspections. Lowest 50% on Oct 21, highest 100% on Oct 19.");
    expect(screen.getByText("A dotted mark is a day with no first inspections. It has no rate; it is not 0%.")).toBeTruthy();
  });

  it("writes the numbers out as text too", () => {
    const screen = wrap(<TrendChart trend={trend} language="en" t={en} />);
    expect(screen.getByText("Lowest day 50% (Oct 21); highest 100% (Oct 19).")).toBeTruthy();
  });
});

describe("QualityInsightsCard", () => {
  const ready = (data = historyInsights()) => ({ status: "ready", data, fetchedAt: 1, stale: null }) as const;
  const base = { periodLabel: "Today · Oct 21", t: en, onRetry: jest.fn(), onOpenDetails: jest.fn() };

  it("is compact: the first-pass rate, one summary line and the single most common issue", () => {
    const data = historyInsights({
      counts: { completed: 146, passed: 128, failed: 18, conditional: 0, initial: 134, reinspections: 12, without_lineage: 0 },
      first_pass: { rate: 0.88, passed: 118, eligible: 134, conditional_excluded: 0 },
      top_standards: [
        { standard_id: "a", label: "Bathroom amenities", section: null, count: 9 },
        { standard_id: "b", label: "Mirrors / glass", section: null, count: 6 },
      ],
    });
    const screen = wrap(<QualityInsightsCard state={ready(data)} {...base} />);
    expect(within(screen.getByTestId("insights-first-pass")).getByText("88%")).toBeTruthy();
    expect(screen.getByTestId("insights-summary").props.children).toBe("146 completed · 18 failed · 12 reinspections");
    expect(screen.getByTestId("insights-top-issue").props.children).toBe("Most common issue: Bathroom amenities (9)");
    expect(screen.queryByText(/Mirrors/)).toBeNull(); // the ranking lives in the details drawer
  });

  it("explains an empty period rather than printing zeros", () => {
    const screen = wrap(<QualityInsightsCard state={ready()} {...base} />);
    expect(screen.getByTestId("insights-empty")).toBeTruthy();
    expect(screen.queryByTestId("insights-first-pass")).toBeNull();
  });

  it("marks counts from a cut-off period as minimums and withholds the rate", () => {
    const data = historyInsights({ truncated: true, counts: { completed: 5000, passed: 4000, failed: 1000, conditional: 0, initial: 4800, reinspections: 200, without_lineage: 0 }, first_pass: { rate: 0.9, passed: 4300, eligible: 4800, conditional_excluded: 0 } });
    const screen = wrap(<QualityInsightsCard state={ready(data)} {...base} />);
    expect(screen.getByTestId("insights-summary").props.children).toBe("At least 5000 completed · 1000 failed · 200 reinspections");
    expect(within(screen.getByTestId("insights-first-pass")).getByText("Not available")).toBeTruthy();
    expect(screen.getByText(/more inspections than can be summarised/)).toBeTruthy();
  });

  it("loading, failed (with retry) and stale are each shown honestly", () => {
    const retry = jest.fn();
    const loading = wrap(<QualityInsightsCard state={{ status: "loading" }} {...base} />);
    expect(loading.getByTestId("insights-loading")).toBeTruthy();
    const failed = wrap(<QualityInsightsCard state={{ status: "failed", failure: { kind: "error", status: 500 } }} {...base} onRetry={retry} />);
    fireEvent.press(failed.getByTestId("insights-retry"));
    expect(retry).toHaveBeenCalled();
    const stale = wrap(<QualityInsightsCard state={{ status: "ready", data: historyInsights(), fetchedAt: 1, stale: "offline" }} {...base} />);
    expect(stale.getByTestId("insights-stale")).toBeTruthy();
  });

  it("opens the details", () => {
    const open = jest.fn();
    const screen = wrap(<QualityInsightsCard state={ready()} {...base} onOpenDetails={open} />);
    fireEvent.press(screen.getByTestId("insights-more"));
    expect(open).toHaveBeenCalled();
  });
});

describe("InsightsSheet", () => {
  const props = { visible: true, periodLabel: "Last 7 days", language: "en", t: en, onDrillStandard: jest.fn(), onDrillRoom: jest.fn(), onClose: jest.fn() };

  it("discloses how legacy conditional results and unlinked reinspections are treated", () => {
    const data = historyInsights({ counts: { completed: 9, passed: 5, failed: 2, conditional: 2, initial: 9, reinspections: 0, without_lineage: 4 }, first_pass: { rate: 0.71, passed: 5, eligible: 7, conditional_excluded: 2 } });
    const screen = wrap(<InsightsSheet {...props} data={data} />);
    expect(screen.getByTestId("insights-conditional-note").props.children).toMatch(/2 older "conditional" results are left out of the rate/);
    expect(screen.getByTestId("insights-lineage-note").props.children).toMatch(/4 inspections .* before reinspections were linked/);
    expect(screen.getByTestId("insights-detail-rate").props.children).toBe("71%");
  });

  it("says a handful of failures is too few to conclude anything, and shows no repeat claims", () => {
    const data = historyInsights({
      counts: { completed: 20, passed: 18, failed: 2, conditional: 0, initial: 20, reinspections: 0, without_lineage: 0 },
      first_pass: { rate: 0.9, passed: 18, eligible: 20, conditional_excluded: 0 },
      repeat_rooms: [{ room_id: "r1", room_number: "204", failed_count: 2, inspection_ids: ["a", "b"] }],
    });
    const screen = wrap(<InsightsSheet {...props} data={data} />);
    expect(screen.getByTestId("insights-sparse").props.children).toBe("Only 2 failed in this period. That is too little to draw conclusions from.");
    expect(screen.queryByTestId("insights-room-r1")).toBeNull();
  });

  it("lets a supervisor drill from an issue or a room to the underlying inspections", () => {
    const data = historyInsights({
      counts: { completed: 30, passed: 20, failed: 10, conditional: 0, initial: 30, reinspections: 0, without_lineage: 0 },
      first_pass: { rate: 0.66, passed: 20, eligible: 30, conditional_excluded: 0 },
      top_standards: [{ standard_id: "std-1", label: "Mirrors", section: "Bath", count: 6 }],
      repeat_rooms: [{ room_id: "r1", room_number: "204", failed_count: 3, inspection_ids: [] }],
    });
    const drillStandard = jest.fn();
    const drillRoom = jest.fn();
    const screen = wrap(<InsightsSheet {...props} data={data} onDrillStandard={drillStandard} onDrillRoom={drillRoom} />);
    fireEvent.press(screen.getByTestId("insights-standard-0"));
    expect(drillStandard).toHaveBeenCalledWith({ id: "std-1", label: "Mirrors" });
    fireEvent.press(screen.getByTestId("insights-room-r1"));
    expect(drillRoom).toHaveBeenCalledWith("204");
    expect(screen.getByText("These show where problems recur. They say nothing about any person.")).toBeTruthy();
  });

  it("shows a typical time to verification only with enough verified corrections", () => {
    const base = { corrections: { failed: 4, verified: 3, failed_again: 1, no_reinspection_recorded: 0 } };
    const few = wrap(<InsightsSheet {...props} data={historyInsights({ ...base, time_to_verification: { available: false, median_minutes: null, sample: 2, minimum_sample: 3 } })} />);
    expect(few.getByTestId("insights-verification").props.children).toBe("Not enough verified corrections to show a typical time (2 of 3 needed).");
    const enough = wrap(<InsightsSheet {...props} data={historyInsights({ ...base, time_to_verification: { available: true, median_minutes: 95, sample: 3, minimum_sample: 3 } })} />);
    expect(enough.getByTestId("insights-verification").props.children).toMatch(/1 h 35 min \(median of 3 verified corrections\)/);
  });

  it("with no trend data it says so instead of drawing an empty chart", () => {
    const screen = wrap(<InsightsSheet {...props} data={historyInsights()} />);
    expect(screen.getByTestId("insights-no-trend")).toBeTruthy();
  });
});

describe("HistoryToolbar", () => {
  const base = { periodText: "Today · Oct 21", inspectors: [], matchAtLeast: false, t: en, onOpenFilters: jest.fn(), onRemoveChip: jest.fn(), onClearAll: jest.fn() };

  it("shows the period's counts when unfiltered - and nothing at all while they are unknown", () => {
    const known = wrap(<HistoryToolbar {...base} filters={DEFAULT_HISTORY_FILTERS} activeCount={0} counts={{ completed: 30, passed: 24, failed: 4, conditional: 0, initial: 28, reinspections: 2, without_lineage: 0 }} countsAtLeast={false} matchCount={30} />);
    expect(within(known.getByTestId("history-stat-passed")).getByText("24")).toBeTruthy();
    expect(known.queryByTestId("history-stat-conditional")).toBeNull();
    const unknown = wrap(<HistoryToolbar {...base} filters={DEFAULT_HISTORY_FILTERS} activeCount={0} counts={null} countsAtLeast={false} matchCount={null} />);
    expect(unknown.queryByTestId("history-summary")).toBeNull();
  });

  it("shows a historical-conditional count only when there are some", () => {
    const screen = wrap(<HistoryToolbar {...base} filters={DEFAULT_HISTORY_FILTERS} activeCount={0} counts={{ completed: 5, passed: 3, failed: 1, conditional: 1, initial: 5, reinspections: 0, without_lineage: 1 }} countsAtLeast={false} matchCount={5} />);
    expect(screen.getByTestId("history-stat-conditional")).toBeTruthy();
  });

  it("with filters shows the number of matches and removable chips instead of period totals", () => {
    const filters: HistoryFilters = { ...DEFAULT_HISTORY_FILTERS, result: "failed", room: "204" };
    const onRemove = jest.fn();
    const screen = wrap(<HistoryToolbar {...base} filters={filters} activeCount={2} counts={null} countsAtLeast={false} matchCount={7} onRemoveChip={onRemove} />);
    expect(screen.getByTestId("history-match-count").props.children).toBe("7 results");
    expect(screen.queryByTestId("history-summary")).toBeNull();
    expect(screen.getByTestId("history-filter-button").props.accessibilityLabel).toBe("Filter, 2 active");
    fireEvent.press(screen.getByTestId("history-chip-result"));
    expect(onRemove).toHaveBeenCalledWith({ kind: "result", value: "failed" });
  });
});

describe("HistoryFilterSheet", () => {
  const sheet = (applied: HistoryFilters = DEFAULT_HISTORY_FILTERS, over: Record<string, unknown> = {}) => {
    const onApply = jest.fn();
    const onOpen = jest.fn();
    const onClose = jest.fn();
    const screen = wrap(
      <HistoryFilterSheet
        visible
        applied={applied}
        today="2026-10-21"
        inspectors={{ status: "ready", rows: [{ id: "u1", name: "Ana Inspector", count: 3 }, { id: "u2", name: null, count: 1 }], truncated: false }}
        t={en}
        onOpen={onOpen}
        onApply={onApply}
        onClose={onClose}
        {...over}
      />,
    );
    return { screen, onApply, onOpen, onClose };
  };

  it("loads the inspectors when it opens, and offers them by name", () => {
    const { screen, onOpen } = sheet();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Ana Inspector")).toBeTruthy();
    expect(screen.getByText("Inspector not recorded")).toBeTruthy(); // never an id
  });

  it("edits a draft and applies it only on 'Show results'", () => {
    const { screen, onApply } = sheet();
    fireEvent.press(screen.getByTestId("history-filter-period-30d"));
    fireEvent.press(screen.getByTestId("history-filter-result-failed"));
    fireEvent.press(screen.getByTestId("history-filter-type-reinspection"));
    fireEvent.changeText(screen.getByTestId("history-filter-room"), " 204 ");
    fireEvent.press(screen.getByTestId("history-filter-inspector-u1"));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("history-filter-apply"));
    expect(onApply).toHaveBeenCalledWith({ period: "30d", custom: null, result: "failed", type: "reinspection", room: "204", inspectorId: "u1", standard: null });
  });

  it("Reset puts every choice back to the default", () => {
    const { screen, onApply } = sheet({ ...DEFAULT_HISTORY_FILTERS, period: "7d", result: "failed", room: "9", inspectorId: "u1" });
    fireEvent.press(screen.getByTestId("history-filter-reset"));
    fireEvent.press(screen.getByTestId("history-filter-apply"));
    expect(onApply).toHaveBeenCalledWith(DEFAULT_HISTORY_FILTERS);
  });

  it("shows the selected choices with a state, not only a colour", () => {
    const { screen } = sheet({ ...DEFAULT_HISTORY_FILTERS, result: "failed" });
    expect(screen.getByTestId("history-filter-result-failed").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId("history-filter-result-all").props.accessibilityState).toEqual({ selected: false });
  });

  it("blocks an invalid custom range and explains each problem", () => {
    const { screen, onApply } = sheet();
    fireEvent.press(screen.getByTestId("history-filter-period-custom"));
    fireEvent.changeText(screen.getByTestId("history-filter-from"), "2026-13-45");
    expect(screen.getByTestId("history-filter-problem").props.children).toBe("Enter both dates as YYYY-MM-DD.");
    fireEvent.press(screen.getByTestId("history-filter-apply"));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("history-filter-from"), "2025-01-01");
    fireEvent.changeText(screen.getByTestId("history-filter-to"), "2026-10-21");
    expect(screen.getByTestId("history-filter-problem").props.children).toBe("The range can span at most 366 days.");
  });

  it("applies a valid custom range", () => {
    const { screen, onApply } = sheet();
    fireEvent.press(screen.getByTestId("history-filter-period-custom"));
    fireEvent.changeText(screen.getByTestId("history-filter-from"), "2026-10-01");
    fireEvent.changeText(screen.getByTestId("history-filter-to"), "2026-10-05");
    expect(screen.queryByTestId("history-filter-problem")).toBeNull();
    fireEvent.press(screen.getByTestId("history-filter-apply"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ period: "custom", custom: { from: "2026-10-01", to: "2026-10-05" } }));
  });

  it("steps a custom date a day at a time", () => {
    const { screen } = sheet();
    fireEvent.press(screen.getByTestId("history-filter-period-custom"));
    fireEvent.changeText(screen.getByTestId("history-filter-to"), "2026-10-05");
    fireEvent.press(screen.getByTestId("history-filter-to-plus"));
    expect(screen.getByTestId("history-filter-to").props.value).toBe("2026-10-06");
    fireEvent.press(screen.getByTestId("history-filter-to-minus"));
    fireEvent.press(screen.getByTestId("history-filter-to-minus"));
    expect(screen.getByTestId("history-filter-to").props.value).toBe("2026-10-04");
  });

  it("a failed inspector list doesn't block the other filters", () => {
    const { screen } = sheet(DEFAULT_HISTORY_FILTERS, { inspectors: { status: "failed", rows: [], truncated: false } });
    expect(screen.getByTestId("history-filter-inspectors-failed")).toBeTruthy();
    expect(screen.getByTestId("history-filter-apply")).toBeTruthy();
  });

  it("lets a failed-standard drill-down be removed", () => {
    const { screen, onApply } = sheet({ ...DEFAULT_HISTORY_FILTERS, standard: { id: "s1", label: "Mirrors" } });
    fireEvent.press(screen.getByTestId("history-filter-standard"));
    fireEvent.press(screen.getByTestId("history-filter-apply"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ standard: null }));
  });

  it("starts from what is applied each time it opens, dropping a cancelled draft", async () => {
    const applied = { ...DEFAULT_HISTORY_FILTERS, result: "passed" as const };
    const view = (visible: boolean) => (
      <ThemeProvider>
        <HistoryFilterSheet visible={visible} applied={applied} today="2026-10-21" inspectors={{ status: "ready", rows: [], truncated: false }} t={en} onOpen={jest.fn()} onApply={jest.fn()} onClose={jest.fn()} />
      </ThemeProvider>
    );
    const screen = render(view(true));
    fireEvent.press(screen.getByTestId("history-filter-result-failed"));
    screen.rerender(view(false));
    await act(async () => screen.rerender(view(true)));
    expect(screen.getByTestId("history-filter-result-passed").props.accessibilityState).toEqual({ selected: true });
  });

  it("is Spanish", () => {
    const { screen } = sheet(DEFAULT_HISTORY_FILTERS, { t: es });
    expect(screen.getByText("Filtrar historial")).toBeTruthy();
    expect(screen.getByText("Mostrar resultados")).toBeTruthy();
    expect(screen.getByText("Condicional histórico")).toBeTruthy();
  });
});

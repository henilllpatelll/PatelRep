import {
  DEFAULT_HISTORY_FILTERS,
  MAX_RANGE_DAYS,
  activeFilterCount,
  daysInRange,
  filterChips,
  filterRange,
  hasActiveFilters,
  isDefaultView,
  isYmd,
  presetRange,
  queryKey,
  removeChip,
  resetFilters,
  toHistoryQuery,
  validateRange,
  type HistoryFilters,
} from "@/lib/inspections/history/filters";
import { periodLabel, rangeProblemText, chipText } from "@/lib/inspections/history/labels";
import { makeTranslator } from "../../../helpers/i18n";

const TODAY = "2026-10-21";
const en = makeTranslator("en");
const es = makeTranslator("es");
const withFilters = (over: Partial<HistoryFilters>): HistoryFilters => ({ ...DEFAULT_HISTORY_FILTERS, ...over });

describe("periods are hotel-local calendar days", () => {
  it("covers today, yesterday and the rolling 7, 30 and 90 days ending today", () => {
    expect(presetRange("today", TODAY)).toEqual({ from: "2026-10-21", to: "2026-10-21" });
    expect(presetRange("yesterday", TODAY)).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(presetRange("7d", TODAY)).toEqual({ from: "2026-10-15", to: "2026-10-21" });
    expect(presetRange("30d", TODAY)).toEqual({ from: "2026-09-22", to: "2026-10-21" });
    expect(presetRange("90d", TODAY)).toEqual({ from: "2026-07-24", to: "2026-10-21" });
    expect(daysInRange(presetRange("7d", TODAY))).toBe(7);
    expect(daysInRange(presetRange("90d", TODAY))).toBe(90);
  });

  it("does pure calendar arithmetic, so a daylight-saving change cannot shift a day", () => {
    // US clocks changed on 2026-03-08 and 2026-11-01; a calendar range is unaffected.
    expect(presetRange("7d", "2026-03-10")).toEqual({ from: "2026-03-04", to: "2026-03-10" });
    expect(presetRange("yesterday", "2026-11-02")).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(presetRange("30d", "2026-11-05").from).toBe("2026-10-07");
    expect(presetRange("7d", "2027-03-02")).toEqual({ from: "2027-02-24", to: "2027-03-02" }); // not a leap year
    expect(presetRange("yesterday", "2028-03-01").from).toBe("2028-02-29"); // a leap year
  });

  it("reads 'today' from the hotel, never the phone: the range is a function of the hotel date it is given", () => {
    expect(filterRange(DEFAULT_HISTORY_FILTERS, "2026-12-31")).toEqual({ from: "2026-12-31", to: "2026-12-31" });
  });
});

describe("custom ranges", () => {
  it("accepts a valid range up to today", () => {
    expect(validateRange({ from: "2026-10-01", to: "2026-10-21" }, TODAY)).toBeNull();
    expect(validateRange({ from: "2026-10-21", to: "2026-10-21" }, TODAY)).toBeNull();
  });

  it("refuses reversed, future, over-long and malformed ranges, and says which", () => {
    expect(validateRange({ from: "2026-10-21", to: "2026-10-01" }, TODAY)).toBe("reversed");
    expect(validateRange({ from: "2026-10-01", to: "2026-10-22" }, TODAY)).toBe("future");
    expect(validateRange({ from: "2025-01-01", to: "2026-10-21" }, TODAY)).toBe("too_long");
    expect(validateRange({ from: "10/01/2026", to: "2026-10-21" }, TODAY)).toBe("invalid");
    expect(validateRange({ from: "2026-02-30", to: "2026-10-21" }, TODAY)).toBe("invalid");
    expect(validateRange({ from: "", to: "" }, TODAY)).toBe("invalid");
  });

  it("allows exactly the maximum span and no more", () => {
    const to = "2026-12-31";
    const ok = { from: presetRange("yesterday", "2026-01-01").from, to }; // 2025-12-31 .. 2026-12-31 = 366 days
    expect(daysInRange(ok)).toBe(MAX_RANGE_DAYS);
    expect(validateRange(ok, to)).toBeNull();
    expect(validateRange({ from: "2025-12-30", to }, to)).toBe("too_long");
  });

  it("a custom period with no valid range selects nothing, so nothing is fetched", () => {
    expect(filterRange(withFilters({ period: "custom", custom: null }), TODAY)).toBeNull();
    expect(filterRange(withFilters({ period: "custom", custom: { from: "2026-10-21", to: "2026-10-01" } }), TODAY)).toBeNull();
    expect(toHistoryQuery(withFilters({ period: "custom", custom: null }), TODAY, 30)).toBeNull();
    expect(filterRange(withFilters({ period: "custom", custom: { from: "2026-10-01", to: "2026-10-05" } }), TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-05" });
  });

  it("isYmd rejects impossible calendar dates", () => {
    expect(isYmd("2028-02-29")).toBe(true);
    expect(isYmd("2027-02-29")).toBe(false);
    expect(isYmd("2026-13-01")).toBe(false);
  });
});

describe("filters map to real server fields", () => {
  it("the default view asks for today with no other filter", () => {
    expect(toHistoryQuery(DEFAULT_HISTORY_FILTERS, TODAY, 30)).toEqual({ dateFrom: TODAY, dateTo: TODAY, limit: 30, cursor: null });
    expect(isDefaultView(DEFAULT_HISTORY_FILTERS)).toBe(true);
  });

  it("combines result, type, room, inspector (by id) and failed standard predictably", () => {
    const filters = withFilters({
      period: "7d",
      result: "failed",
      type: "reinspection",
      room: " 204 ",
      inspectorId: "user-1",
      standard: { id: "std-1", label: "Mirrors" },
    });
    expect(toHistoryQuery(filters, TODAY, 30, "CUR")).toEqual({
      dateFrom: "2026-10-15",
      dateTo: TODAY,
      result: "failed",
      inspectionType: "reinspection",
      inspectorId: "user-1",
      roomNumber: "204",
      failedItemId: "std-1",
      limit: 30,
      cursor: "CUR",
    });
    expect(activeFilterCount(filters)).toBe(5);
    expect(hasActiveFilters(filters)).toBe(true);
    expect(isDefaultView(filters)).toBe(false);
  });

  it("a different period alone is not a 'filter', but it is not the default view either", () => {
    const week = withFilters({ period: "7d" });
    expect(hasActiveFilters(week)).toBe(false);
    expect(isDefaultView(week)).toBe(false);
  });

  it("the query key changes with the question and ignores whitespace and case in the room", () => {
    const a = queryKey(withFilters({ room: "204" }), TODAY);
    expect(queryKey(withFilters({ room: " 204 " }), TODAY)).toBe(a);
    expect(queryKey(withFilters({ room: "205" }), TODAY)).not.toBe(a);
    expect(queryKey(withFilters({ room: "204", result: "failed" }), TODAY)).not.toBe(a);
    expect(queryKey(withFilters({ room: "204" }), "2026-10-22")).not.toBe(a); // the hotel's day rolled over
  });

  it("chips can be removed one at a time and everything can be reset", () => {
    const filters = withFilters({ result: "passed", type: "initial", room: "9", inspectorId: "u", standard: { id: "s", label: "x" } });
    const chips = filterChips(filters);
    expect(chips.map((chip) => chip.kind)).toEqual(["result", "type", "room", "inspector", "standard"]);
    expect(removeChip(filters, chips[0]).result).toBe("all");
    expect(removeChip(filters, chips[3]).inspectorId).toBeNull();
    expect(removeChip(filters, chips[4]).standard).toBeNull();
    expect(resetFilters()).toEqual(DEFAULT_HISTORY_FILTERS);
  });
});

describe("words for the period and chips", () => {
  it("shows the selected days in the hotel's own dates, in English and Spanish", () => {
    expect(periodLabel(DEFAULT_HISTORY_FILTERS, TODAY, "en", en)).toBe("Today · Oct 21");
    expect(periodLabel(withFilters({ period: "yesterday" }), TODAY, "en", en)).toBe("Yesterday · Oct 20");
    expect(periodLabel(withFilters({ period: "7d" }), TODAY, "en", en)).toBe("Last 7 days · Oct 15 – Oct 21");
    expect(periodLabel(withFilters({ period: "custom", custom: { from: "2026-10-01", to: "2026-10-05" } }), TODAY, "en", en)).toBe("Oct 1 – Oct 5");
    expect(periodLabel(DEFAULT_HISTORY_FILTERS, TODAY, "es", es)).toMatch(/^Hoy · 21 oct/);
    expect(periodLabel(withFilters({ period: "custom", custom: null }), TODAY, "en", en)).toBe("Choose a valid date range");
  });

  it("an inspector chip names the person, never the id", () => {
    const chip = { kind: "inspector", value: "9f1c-id" } as const;
    expect(chipText(chip, [{ id: "9f1c-id", name: "Ana Inspector", count: 3 }], en)).toBe("Inspector: Ana Inspector");
    expect(chipText(chip, [], en)).toBe("Inspector");
    expect(chipText(chip, [], en)).not.toContain("9f1c");
  });

  it("explains each range problem", () => {
    expect(rangeProblemText("reversed", en)).toBe("The start date must not be after the end date.");
    expect(rangeProblemText("future", es)).toMatch(/hoy/);
    expect(rangeProblemText(null, en)).toBeNull();
  });
});

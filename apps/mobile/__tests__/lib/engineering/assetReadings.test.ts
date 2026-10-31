import {
  checkReadingInput,
  formatReadingValue,
  hasEnoughForTrend,
  limitState,
  parseReadingValue,
  sortReadings,
  trendDirection,
  trendGeometry,
  trendPoints,
  type MeterReading,
} from "@/lib/engineering/assetReadings";

const reading = (id: string, value: number | string, at: string, over: Partial<MeterReading> = {}): MeterReading => ({ id, value, recorded_at: at, ...over });

describe("reading input", () => {
  it("accepts plain decimals, including negatives", () => {
    expect(parseReadingValue("4280")).toEqual({ value: 4280, error: null });
    expect(parseReadingValue(" 18.25 ")).toEqual({ value: 18.25, error: null });
    expect(parseReadingValue("-3.5")).toEqual({ value: -3.5, error: null });
    expect(parseReadingValue("0")).toEqual({ value: 0, error: null });
  });

  it("requires a value and refuses anything that is not a plain number", () => {
    expect(parseReadingValue("")).toEqual({ value: null, error: "required" });
    expect(parseReadingValue("   ")).toEqual({ value: null, error: "required" });
    for (const bad of ["abc", "1,5", "4,280", "1e3", "12.", ".5", "--1", "1 2", "NaN", "Infinity"]) {
      expect(parseReadingValue(bad)).toEqual({ value: null, error: "invalid" });
    }
  });

  it("enforces the API range and precision", () => {
    expect(parseReadingValue("1000000000").error).toBeNull();
    expect(parseReadingValue("1000000001").error).toBe("out_of_range");
    expect(parseReadingValue("-1000000001").error).toBe("out_of_range");
    expect(parseReadingValue("1.1234567").error).toBe("too_precise");
    expect(parseReadingValue("1.123456").error).toBeNull();
  });

  it("checks notes length together with the value", () => {
    expect(checkReadingInput("5", "x".repeat(1000)).error).toBeNull();
    expect(checkReadingInput("5", "x".repeat(1001)).error).toBe("notes_too_long");
    expect(checkReadingInput("", "x").error).toBe("required");
  });
});

describe("limits come only from the meter's own configuration", () => {
  const meter = { warning_low: 10, warning_high: 20, critical_low: 5, critical_high: 25 };

  it("never judges a meter that has no limits (and never calls anything safe)", () => {
    expect(limitState({}, 9999)).toBe("no_limits");
    expect(limitState({ warning_low: null, warning_high: null, critical_low: null, critical_high: null }, 1)).toBe("no_limits");
  });

  it("compares against the configured warning and critical limits", () => {
    expect(limitState(meter, 15)).toBe("inside_configured");
    expect(limitState(meter, 21)).toBe("outside_warning");
    expect(limitState(meter, 9)).toBe("outside_warning");
    expect(limitState(meter, 25)).toBe("outside_critical");
    expect(limitState(meter, 4)).toBe("outside_critical");
  });

  it("works with a one-sided meter", () => {
    expect(limitState({ critical_high: 100 }, 99)).toBe("inside_configured");
    expect(limitState({ critical_high: 100 }, 100)).toBe("outside_critical");
  });
});

describe("meters are not assumed to only increase", () => {
  it("shows a lower later value as recorded: no reset detection, no blocking", () => {
    const points = trendPoints([reading("1", 4200, "2026-10-01T00:00:00Z"), reading("2", 120, "2026-10-20T00:00:00Z")]);
    expect(points.map((p) => p.value)).toEqual([4200, 120]);
    expect(trendDirection(points)).toBe("falling");
  });
});

describe("trend", () => {
  const six = Array.from({ length: 6 }, (_, i) => reading(`r${i}`, 100 + i * 10, `2026-10-0${i + 1}T12:00:00Z`));

  it("orders oldest to newest regardless of how the API returned them, and drops duplicate ids", () => {
    const shuffled = [six[3], six[0], six[5], six[1], six[1], six[4], six[2]];
    expect(trendPoints(shuffled).map((p) => p.value)).toEqual([100, 110, 120, 130, 140, 150]);
    expect(sortReadings(shuffled)[0].id).toBe("r5");
  });

  it("skips readings with unreadable values or times instead of plotting a guess", () => {
    const points = trendPoints([reading("a", "n/a", "2026-10-01T00:00:00Z"), reading("b", 5, "not a date"), reading("c", "7", "2026-10-02T00:00:00Z")]);
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(7);
  });

  it("only draws a chart from enough real points", () => {
    expect(hasEnoughForTrend(trendPoints(six.slice(0, 3)))).toBe(false);
    expect(hasEnoughForTrend(trendPoints(six.slice(0, 4)))).toBe(true);
  });

  it("describes direction without forecasting, and treats a flat series as flat", () => {
    expect(trendDirection(trendPoints(six))).toBe("rising");
    expect(trendDirection(trendPoints(six.map((r) => ({ ...r, value: 5 }))))).toBe("flat");
    expect(trendDirection(trendPoints(six.slice(0, 1)))).toBeNull();
  });

  it("spaces the horizontal axis by real time, so a gap in readings looks like a gap", () => {
    const geometry = trendGeometry(trendPoints([reading("a", 1, "2026-10-01T00:00:00Z"), reading("b", 2, "2026-10-02T00:00:00Z"), reading("c", 3, "2026-10-11T00:00:00Z")]));
    expect(geometry.map((g) => Number(g.x.toFixed(2)))).toEqual([0, 0.1, 1]);
    expect(geometry.map((g) => g.y)).toEqual([1, 0.5, 0]);
  });

  it("puts a single value mid-height instead of dividing by zero", () => {
    expect(trendGeometry([{ at: "2026-10-01T00:00:00Z", value: 4 }, { at: "2026-10-02T00:00:00Z", value: 4 }]).map((g) => g.y)).toEqual([0.5, 0.5]);
  });
});

describe("display", () => {
  it("formats with the device locale and leaves unparseable values as given", () => {
    expect(formatReadingValue(4280, "en-US")).toBe("4,280");
    expect(formatReadingValue("18.256", "en-US")).toBe("18.26");
    expect(formatReadingValue("oops", "en-US")).toBe("oops");
  });
});

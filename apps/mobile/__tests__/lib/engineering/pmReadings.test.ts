import { adaptPmMeters, evaluateReading, hasReferenceLimits, parseReading, referenceRange, type PmMeterRow } from "@/lib/engineering/pmReadings";

const meterRow = (extra: Partial<PmMeterRow> = {}): PmMeterRow => ({
  id: "m1",
  name: "Operating pressure",
  unit: "psi",
  warning_low: 15,
  warning_high: 20,
  critical_low: 10,
  critical_high: 25,
  critical_action: "create_work_order",
  is_active: true,
  latest_reading: { value: "18.0", recorded_at: "2026-10-01T00:00:00Z" },
  ...extra,
});

describe("parseReading", () => {
  it("accepts integers, decimals, decimal commas and negatives", () => {
    expect(parseReading("18")).toEqual({ kind: "ok", value: 18 });
    expect(parseReading(" 18.5 ")).toEqual({ kind: "ok", value: 18.5 });
    expect(parseReading("18,5")).toEqual({ kind: "ok", value: 18.5 });
    expect(parseReading("-3")).toEqual({ kind: "ok", value: -3 });
    expect(parseReading(".5")).toEqual({ kind: "ok", value: 0.5 });
  });

  it("treats blank as not entered and rejects everything else that is not a plain number", () => {
    expect(parseReading("")).toEqual({ kind: "empty" });
    expect(parseReading("   ")).toEqual({ kind: "empty" });
    expect(parseReading(undefined)).toEqual({ kind: "empty" });
    for (const bad of ["abc", "18 psi", "1.2.3", "NaN", "Infinity", "1e5", "--1", "5-", "2000000000"]) {
      expect(parseReading(bad)).toEqual({ kind: "invalid" });
    }
  });
});

describe("meters", () => {
  it("adapts active meters with their own unit and limits", () => {
    const [m] = adaptPmMeters([meterRow(), meterRow({ id: "off", is_active: false })]);
    expect(m).toMatchObject({ id: "m1", unit: "psi", warningLow: 15, warningHigh: 20, criticalLow: 10, criticalHigh: 25, opensWorkOrderWhenCritical: true });
    expect(m.last).toEqual({ value: 18, recordedAt: "2026-10-01T00:00:00Z" });
    expect(adaptPmMeters(null)).toEqual([]);
  });

  it("mirrors the server rule: critical limits are inclusive, then warning, otherwise normal", () => {
    const [m] = adaptPmMeters([meterRow()]);
    expect(evaluateReading(m, 18)).toBe("normal");
    expect(evaluateReading(m, 15)).toBe("warning");
    expect(evaluateReading(m, 20)).toBe("warning");
    expect(evaluateReading(m, 10)).toBe("critical");
    expect(evaluateReading(m, 25)).toBe("critical");
    expect(evaluateReading(m, 30)).toBe("critical");
    expect(evaluateReading(m, 12)).toBe("warning");
  });

  it("invents no limits: a meter without any has no range and no status", () => {
    const [m] = adaptPmMeters([meterRow({ warning_low: null, warning_high: null, critical_low: null, critical_high: null, critical_action: "none" })]);
    expect(hasReferenceLimits(m)).toBe(false);
    expect(referenceRange(m)).toBeNull();
    expect(m.opensWorkOrderWhenCritical).toBe(false);
  });

  it("reports a one-sided range", () => {
    const [m] = adaptPmMeters([meterRow({ warning_low: null, critical_low: null })]);
    expect(referenceRange(m)).toEqual({ low: null, high: 20 });
  });
});

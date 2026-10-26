import { SMALL_SAMPLE, SPARSE_FAILURES, buildInsightsView, buildTrend, durationParts, percentOf, rateView } from "@/lib/inspections/history/insights";
import { historyInsights } from "../../../helpers/inspectionFixtures";

describe("percentages", () => {
  it("rounds normally but never claims 100% for a rate that is not perfect", () => {
    expect(percentOf(0.88)).toBe(88);
    expect(percentOf(0.5)).toBe(50);
    expect(percentOf(0)).toBe(0);
    expect(percentOf(0.996)).toBe(99);
    expect(percentOf(0.9951)).toBe(99);
    expect(percentOf(1)).toBe(100);
  });
});

describe("the first-pass rate", () => {
  it("is shown with its numerator and denominator", () => {
    const view = rateView(historyInsights({ first_pass: { rate: 0.88, passed: 118, eligible: 134, conditional_excluded: 0 } }));
    expect(view).toEqual({ kind: "value", percent: 88, passed: 118, eligible: 134, smallSample: false });
  });

  it("flags a small sample rather than hiding it", () => {
    const view = rateView(historyInsights({ first_pass: { rate: 0.5, passed: 2, eligible: SMALL_SAMPLE - 1, conditional_excluded: 0 } }));
    expect(view).toMatchObject({ kind: "value", smallSample: true });
  });

  it("has no rate when there is nothing to divide by - that is not 0%", () => {
    expect(rateView(historyInsights())).toEqual({ kind: "none", reason: "no_initial" });
    expect(rateView(historyInsights({ first_pass: { rate: 0, passed: 0, eligible: 0, conditional_excluded: 0 } }))).toEqual({ kind: "none", reason: "no_initial" });
  });

  it("a genuine 0% (first inspections, none passed) is a rate", () => {
    expect(rateView(historyInsights({ first_pass: { rate: 0, passed: 0, eligible: 4, conditional_excluded: 0 } }))).toMatchObject({ kind: "value", percent: 0 });
  });

  it("is withheld for a cut-off period even if the server sent one", () => {
    expect(rateView(historyInsights({ truncated: true, first_pass: { rate: 0.9, passed: 9, eligible: 10, conditional_excluded: 0 } }))).toEqual({ kind: "none", reason: "truncated" });
  });
});

describe("the insights view", () => {
  it("is empty only when nothing was inspected", () => {
    expect(buildInsightsView(historyInsights()).empty).toBe(true);
    expect(buildInsightsView(historyInsights({ counts: { completed: 1, passed: 1, failed: 0, conditional: 0, initial: 1, reinspections: 0, without_lineage: 0 } })).empty).toBe(false);
  });

  it("calls a handful of failures too sparse to conclude anything", () => {
    const count = (failed: number) => historyInsights({ counts: { completed: 20, passed: 20 - failed, failed, conditional: 0, initial: 20, reinspections: 0, without_lineage: 0 } });
    expect(buildInsightsView(count(SPARSE_FAILURES - 1)).sparse).toBe(true);
    expect(buildInsightsView(count(SPARSE_FAILURES)).sparse).toBe(false);
  });

  it("carries the disclosure counts through unchanged", () => {
    const view = buildInsightsView(historyInsights({ counts: { completed: 9, passed: 5, failed: 2, conditional: 2, initial: 9, reinspections: 0, without_lineage: 4 }, first_pass: { rate: 0.71, passed: 5, eligible: 7, conditional_excluded: 2 } }));
    expect(view).toMatchObject({ conditional: 2, conditionalExcluded: 2, withoutLineage: 4 });
  });

  it("only shows the corrections block when something failed, and the duration only with enough cases", () => {
    expect(buildInsightsView(historyInsights()).corrections.shown).toBe(false);
    const view = buildInsightsView(
      historyInsights({
        corrections: { failed: 4, verified: 2, failed_again: 1, no_reinspection_recorded: 1 },
        time_to_verification: { available: false, median_minutes: null, sample: 2, minimum_sample: 3 },
      }),
    );
    expect(view.corrections).toMatchObject({ shown: true, verified: 2 });
    expect(view.verification).toEqual({ available: false, medianMinutes: null, sample: 2, minimum: 3 });
  });
});

describe("the trend", () => {
  const day = (date: string, rate: number | null, passed = 0, failed = 0) => ({ date, initial_passed: passed, initial_failed: failed, completed: passed + failed, first_pass_rate: rate });

  it("keeps a day with no first inspections as a gap, never a 0% bar", () => {
    const trend = buildTrend([day("2026-10-19", 1, 4, 0), day("2026-10-20", null), day("2026-10-21", 0.5, 2, 2)], false);
    expect(trend?.points.map((p) => p.percent)).toEqual([100, null, 50]);
    expect(trend?.withData).toBe(2);
  });

  it("needs at least two days with a rate to say anything", () => {
    expect(buildTrend([day("2026-10-19", 1, 4, 0), day("2026-10-20", null)], false)).toBeNull();
    expect(buildTrend([day("2026-10-19", 1, 4, 0)], false)).toBeNull();
    expect(buildTrend([day("2026-10-19", null), day("2026-10-20", null)], false)).toBeNull();
  });

  it("is not drawn for a cut-off period", () => {
    expect(buildTrend([day("2026-10-19", 1, 4, 0), day("2026-10-20", 1, 3, 0)], true)).toBeNull();
  });
});

describe("durations", () => {
  it("splits minutes into hours and minutes", () => {
    expect(durationParts(95)).toEqual({ hours: 1, minutes: 35 });
    expect(durationParts(59.6)).toEqual({ hours: 1, minutes: 0 });
    expect(durationParts(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});

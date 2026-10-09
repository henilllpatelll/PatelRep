import {
  MAX_PLAUSIBLE_ELAPSED_SECONDS,
  confirmedDurationMinutes,
  elapsedSeconds,
  formatElapsed,
  standardMinutes,
} from "@/lib/housekeeping/cleaningTimer";

const START = "2026-10-09T16:00:00.000Z";
const at = (offsetSeconds: number) => new Date(START).getTime() + offsetSeconds * 1000;

describe("elapsedSeconds", () => {
  it("is computed from the start timestamp, so a later 'now' always yields the right value (backgrounding/restart)", () => {
    expect(elapsedSeconds(START, at(0))).toBe(0);
    expect(elapsedSeconds(START, at(1104))).toBe(1104);
    expect(elapsedSeconds(START, at(5400))).toBe(5400);
  });

  it("never goes negative when the device clock is behind the server's start time", () => {
    expect(elapsedSeconds(START, at(-45))).toBe(0);
  });

  it("returns null for a missing or unparseable start instead of inventing a number", () => {
    expect(elapsedSeconds(null, at(10))).toBeNull();
    expect(elapsedSeconds(undefined, at(10))).toBeNull();
    expect(elapsedSeconds("not a date", at(10))).toBeNull();
    expect(elapsedSeconds(START, Number.NaN)).toBeNull();
  });

  it("refuses an implausibly long clean (forgotten session) rather than showing 71:12:09", () => {
    expect(elapsedSeconds(START, at(MAX_PLAUSIBLE_ELAPSED_SECONDS))).toBe(MAX_PLAUSIBLE_ELAPSED_SECONDS);
    expect(elapsedSeconds(START, at(MAX_PLAUSIBLE_ELAPSED_SECONDS + 1))).toBeNull();
  });

  it("floors partial seconds", () => {
    expect(elapsedSeconds(START, at(61) + 999)).toBe(61);
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "0:00"],
    [9, "0:09"],
    [1104, "18:24"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3723, "1:02:03"],
  ])("%i s -> %s", (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected);
  });

  it("clamps negatives", () => {
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("standardMinutes", () => {
  it("shows a configured estimate and hides absent / zero / junk values", () => {
    expect(standardMinutes(30)).toBe(30);
    expect(standardMinutes(29.6)).toBe(30);
    expect(standardMinutes(0)).toBeNull();
    expect(standardMinutes(null)).toBeNull();
    expect(standardMinutes(undefined)).toBeNull();
    expect(standardMinutes(Number.NaN)).toBeNull();
  });
});

describe("confirmedDurationMinutes", () => {
  it("uses only the server's duration", () => {
    expect(confirmedDurationMinutes(1680)).toBe(28);
    expect(confirmedDurationMinutes(20)).toBe(1);
  });

  it("is null (not a client guess) when the server has not provided one", () => {
    expect(confirmedDurationMinutes(null)).toBeNull();
    expect(confirmedDurationMinutes(undefined)).toBeNull();
    expect(confirmedDurationMinutes(-1)).toBeNull();
  });
});

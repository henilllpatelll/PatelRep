/* Pins only `Date` to a Wednesday so tests that look at "this week" with "tomorrow" in it stay green on a Sunday, when
   tomorrow is already in the next Monday-based week. Timers stay real, so async waits behave as they always did. */

const REAL_TIMERS = [
  "hrtime",
  "nextTick",
  "performance",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "setImmediate",
  "clearImmediate",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
] as const;

/** Wednesday 2026-11-04, noon in Chicago (the hotel zone the schedule tests use). */
export function pinMidweekClock(): void {
  jest.useFakeTimers({ now: new Date("2026-11-04T18:00:00.000Z"), doNotFake: [...REAL_TIMERS] });
}

import React from "react";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { build, room } from "../helpers/homeModelFixture";
import { makeTranslator } from "../helpers/i18n";

const mockPost = jest.fn();
jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { api: { post: (...args: unknown[]) => mockPost(...args) }, ApiError };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { ApiError } from "@/lib/api/client";
import { CompletedShiftSummarySheet } from "@/components/home/CompletedShiftSummarySheet";
import { fetchShiftRecap, parseShiftFacts, summaryFingerprint, type ShiftRecap } from "@/lib/ai/shiftRecap";
import { buildShiftSummary } from "@/lib/housekeeping/shiftSummary";
import { resetRecapCache, useShiftRecap } from "@/lib/housekeeping/useShiftRecap";

const t = makeTranslator("en");
const NOW = new Date("2026-10-14T15:00:00.000Z");

const rawFacts = (over: Record<string, unknown> = {}) => ({
  shift_date: "2026-10-14",
  window: { basis: "shift", shift_ended: true },
  rooms: { assigned: 5, unavailable: 1, submitted: 2, inspected: 1, completed: 3, in_progress: 0, not_started: 1, unfinished: 1, restricted: 0, status_unknown: 0 },
  sessions: { completed_by_you: 3, completed_off_list: 0, stopped: 0, stopped_blocked: 0 },
  timing: { timed_rooms: 2, recorded_minutes: 52 },
  handoffs: { unfinished: ["105"], restricted: [], open_work_orders: [] },
  fingerprint: "abc123",
  ...over,
});
const rawResponse = (over: Record<string, unknown> = {}) => ({
  data: { headline: "3 of 5 assigned rooms are submitted or inspected.", note: "", facts: rawFacts(), cached: false, ...over },
});

beforeEach(() => {
  jest.clearAllMocks();
  resetRecapCache();
});

describe("fetchShiftRecap", () => {
  it("sends only the language and shift date, never a room list", async () => {
    mockPost.mockResolvedValue(rawResponse());
    await fetchShiftRecap({ shiftDate: "2026-10-14", language: "es" });
    expect(mockPost).toHaveBeenCalledWith("/ai/housekeeping/shift-summary", { language: "es", shift_date: "2026-10-14" });
  });

  it("returns the AI wording together with the server's facts", async () => {
    mockPost.mockResolvedValue(rawResponse());
    const recap = await fetchShiftRecap({ shiftDate: "2026-10-14", language: "en" });
    expect(recap.source).toBe("ai");
    expect(recap.note).toBeNull();
    expect(recap.facts.rooms).toMatchObject({ assigned: 5, completed: 3, submitted: 2, inspected: 1, unfinished: 1 });
    expect(recap.facts.sessions.completedByYou).toBe(3);
    expect(recap.facts.timing).toEqual({ timedRooms: 2, recordedMinutes: 52 });
  });

  it("rejects a reply without facts instead of showing unverified text", async () => {
    mockPost.mockResolvedValue({ data: { headline: "A great day." } });
    await expect(fetchShiftRecap({ shiftDate: "2026-10-14", language: "en" })).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("does not invent a local recap when the request fails", async () => {
    mockPost.mockRejectedValue(new ApiError("boom", 503));
    await expect(fetchShiftRecap({ shiftDate: "2026-10-14", language: "en" })).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("parseShiftFacts", () => {
  it("treats missing or malformed blocks as zero, never as completed work", () => {
    const facts = parseShiftFacts({ fingerprint: "x", rooms: { assigned: 4, completed: "lots" } });
    expect(facts?.rooms.assigned).toBe(4);
    expect(facts?.rooms.completed).toBe(0);
    expect(facts?.sessions.completedByYou).toBe(0);
    expect(facts?.timing.recordedMinutes).toBeNull();
  });

  it("refuses an object that is not facts", () => {
    expect(parseShiftFacts(null)).toBeNull();
    expect(parseShiftFacts({ rooms: {} })).toBeNull();
  });
});

describe("summaryFingerprint", () => {
  const ended = (rooms: ReturnType<typeof room>[]) => buildShiftSummary(build(rooms, { shift: "ended" }), NOW);

  it("changes when the shift changes materially and not otherwise", () => {
    const a = summaryFingerprint(ended([room("101", { status: "CLEAN" }), room("102", { status: "DIRTY" })]));
    const same = summaryFingerprint(ended([room("101", { status: "CLEAN" }), room("102", { status: "DIRTY" })]));
    const inspected = summaryFingerprint(ended([room("101", { status: "INSPECTED" }), room("102", { status: "DIRTY" })]));
    const submitted = summaryFingerprint(ended([room("101", { status: "CLEAN" }), room("102", { status: "CLEAN" })]));
    expect(same).toBe(a);
    expect(inspected).not.toBe(a);
    expect(submitted).not.toBe(a);
  });
});

describe("useShiftRecap", () => {
  const options = { scope: "hotel-1:user-1", shiftDate: "2026-10-14", language: "en" as const, fingerprint: "f1", isOnline: true };
  const setup = (over: Partial<typeof options> = {}) =>
    renderHook((props: typeof options) => useShiftRecap(props), { initialProps: { ...options, ...over } });

  it("never generates by itself, however often Home is reopened", async () => {
    setup().unmount();
    setup();
    await waitFor(() => expect(mockPost).not.toHaveBeenCalled());
  });

  it("generates on request and does not buy the same recap twice", async () => {
    mockPost.mockResolvedValue(rawResponse());
    const first = setup();
    await act(async () => {
      await first.result.current.request();
    });
    expect(first.result.current.ai?.headline).toMatch(/^3 of 5/);
    first.unmount();
    const again = setup();
    expect(again.result.current.ai?.headline).toMatch(/^3 of 5/);
    await act(async () => {
      await again.result.current.request();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("shares one request between two quick taps", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockPost.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = setup();
    await act(async () => {
      void result.current.request();
      void result.current.request();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(rawResponse());
    });
  });

  it("drops a stored recap when the shift changes materially", async () => {
    mockPost.mockResolvedValue(rawResponse());
    const { result, rerender } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.ai).not.toBeNull();
    rerender({ ...options, fingerprint: "f2" });
    await waitFor(() => expect(result.current.ai).toBeNull());
  });

  it("keeps recaps apart for different people and hotels", async () => {
    mockPost.mockResolvedValue(rawResponse());
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    const other = setup({ scope: "hotel-2:user-9" });
    expect(other.result.current.ai).toBeNull();
  });

  it("ignores an answer that arrives after the person or hotel switched", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockPost.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result, rerender } = setup();
    await act(async () => {
      void result.current.request();
    });
    rerender({ ...options, scope: "hotel-2:user-9" });
    await act(async () => {
      finish(rawResponse());
    });
    expect(result.current.ai).toBeNull();
  });

  it.each([
    [402, "credits"],
    [429, "credits"],
    [409, "insufficient"],
    [503, "unavailable"],
  ])("maps a %s answer to %s and stores nothing", async (status, expected) => {
    mockPost.mockRejectedValue(new ApiError("x", status));
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe(expected);
    expect(result.current.ai).toBeNull();
  });

  it("asks nothing while offline", async () => {
    const { result } = setup({ isOnline: false });
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("offline");
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe("CompletedShiftSummarySheet recap", () => {
  const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);
  const summary = buildShiftSummary(build([room("101", { status: "CLEAN" }), room("102", { status: "INSPECTED" }), room("103", { status: "CLEAN" }), room("104", { status: "DIRTY" })], { shift: "ended" }), NOW);
  const recap = (over: Partial<ShiftRecap> = {}): ShiftRecap => ({
    headline: "3 of 4 assigned rooms are submitted or inspected.",
    note: null,
    source: "ai",
    facts: parseShiftFacts(rawFacts({ rooms: { assigned: 4, completed: 3, submitted: 2, inspected: 1, unfinished: 1, unavailable: 0, in_progress: 0, not_started: 1, restricted: 0, status_unknown: 0 } }))!,
    cached: false,
    ...over,
  });
  const props = (over: Record<string, unknown> = {}) => ({
    visible: true, summary, language: "en", timeZone: "America/Chicago", online: true, recap: null, recapStatus: "idle" as const, t,
    onRequestRecap: jest.fn(), onOpenItem: jest.fn(), onOpenSync: jest.fn(), onClose: jest.fn(), ...over,
  });

  it("keeps verified numbers and the AI sentence in separate, labelled blocks", () => {
    const { getByTestId } = wrap(<CompletedShiftSummarySheet {...props({ recap: recap() })} />);
    expect(getByTestId("summary-recap-verified")).toBeTruthy();
    expect(getByTestId("recap-completed-by-you")).toBeTruthy();
    expect(getByTestId("recap-submitted").props.accessibilityLabel).toBe("Submitted (waiting for inspection): 2");
    expect(getByTestId("recap-inspected").props.accessibilityLabel).toBe("Inspected: 1");
    expect(getByTestId("summary-recap-ai").props.accessibilityLabel).toMatch(/Written by AI/);
    expect(getByTestId("summary-recap-basis").props.children).toMatch(/verified shift activity/);
  });

  it("shows recorded time only when the server recorded some", () => {
    const withTime = wrap(<CompletedShiftSummarySheet {...props({ recap: recap() })} />);
    expect(withTime.getByTestId("recap-recorded-time")).toBeTruthy();
    withTime.unmount();
    const none = recap();
    none.facts = { ...none.facts, timing: { timedRooms: 0, recordedMinutes: null } };
    const without = wrap(<CompletedShiftSummarySheet {...props({ recap: none })} />);
    expect(without.queryByTestId("recap-recorded-time")).toBeNull();
  });

  it("says so when the server's counts differ from this phone's list", () => {
    const differing = recap();
    differing.facts = { ...differing.facts, rooms: { ...differing.facts.rooms, completed: 4 } };
    const { getByTestId, queryByTestId } = wrap(<CompletedShiftSummarySheet {...props({ recap: differing })} />);
    expect(getByTestId("summary-recap-differs")).toBeTruthy();
    const same = wrap(<CompletedShiftSummarySheet {...props({ recap: recap() })} />);
    expect(same.queryByTestId("summary-recap-differs")).toBeNull();
    expect(queryByTestId("summary-recap-differs")).toBeTruthy();
  });

  it("labels a saved recap as saved", () => {
    const { getByTestId } = wrap(<CompletedShiftSummarySheet {...props({ recap: recap({ cached: true }) })} />);
    expect(getByTestId("summary-recap-basis").props.children).toMatch(/Saved from earlier/);
  });

  it.each([
    ["unavailable", "summary-recap-unavailable"],
    ["credits", "summary-recap-credits"],
    ["insufficient", "summary-recap-insufficient"],
    ["offline", "summary-recap-offline"],
  ])("explains %s without removing the verified summary", (status, testID) => {
    const { getByTestId } = wrap(<CompletedShiftSummarySheet {...props({ recapStatus: status })} />);
    expect(getByTestId(testID)).toBeTruthy();
    expect(getByTestId("summary-submitted")).toBeTruthy();
  });

  it("cannot be asked again once the allowance is used up", () => {
    const { getByTestId } = wrap(<CompletedShiftSummarySheet {...props({ recapStatus: "credits" })} />);
    expect(getByTestId("summary-recap-request").props.accessibilityState.disabled).toBe(true);
  });

  it("asks only when the button is pressed", () => {
    const p = props();
    const { getByTestId } = wrap(<CompletedShiftSummarySheet {...p} />);
    expect(p.onRequestRecap).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("summary-recap-request"));
    expect(p.onRequestRecap).toHaveBeenCalledTimes(1);
  });
});

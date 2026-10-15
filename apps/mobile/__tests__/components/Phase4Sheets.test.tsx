import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { build, room } from "../helpers/homeModelFixture";
import { makeTranslator } from "../helpers/i18n";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

jest.mock("react-i18next", () => {
  const { makeTranslator: make } = require("../helpers/i18n");
  const t = make("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { FinishShiftReviewSheet } from "@/components/home/FinishShiftReviewSheet";
import { SyncStatusSheet } from "@/components/home/SyncStatusSheet";
import { ShiftBriefingSheet } from "@/components/home/ShiftBriefingSheet";
import { CompletedShiftSummarySheet } from "@/components/home/CompletedShiftSummarySheet";
import { buildShiftReview } from "@/lib/housekeeping/shiftReview";
import { buildShiftSummary } from "@/lib/housekeeping/shiftSummary";
import { buildSyncStatusView } from "@/lib/housekeeping/syncStatus";
import { buildBriefingFromModel, buildBriefingPlan } from "@/lib/housekeeping/homeBriefing";

const t = makeTranslator("en");
const ctx = { language: "en", timeZone: "America/Chicago" };
const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);
const NOW = new Date("2026-10-14T15:00:00.000Z");

describe("FinishShiftReviewSheet", () => {
  const model = build([room("101", { status: "CLEAN" }), room("214", { status: "CLEAN", open_work_order_id: "wo-1" }), room("315", { dnd_flag: true })]);
  const props = (over = {}) => ({
    visible: true, review: buildShiftReview(model), clockingOut: false, error: null, alreadyEnded: false,
    language: "en", timeZone: "America/Chicago", t, ctx, onClockOut: jest.fn(), onOpenItem: jest.fn(), onOpenSync: jest.fn(), onClose: jest.fn(), ...over,
  });

  it("lists real handoffs and opens them", () => {
    const p = props();
    const { getByTestId } = wrap(<FinishShiftReviewSheet {...p} />);
    fireEvent.press(getByTestId("review-item-maintenance:214"));
    expect(p.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ kind: "maintenance" }));
    expect(getByTestId("review-item-exception:315")).toBeTruthy();
  });

  it("clocks out only on the button, and shows the error with the shift still open", () => {
    const p = props({ error: "failed" });
    const { getByTestId } = wrap(<FinishShiftReviewSheet {...p} />);
    expect(getByTestId("finish-shift-error")).toBeTruthy();
    expect(p.onClockOut).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("finish-shift-clock-out"));
    expect(p.onClockOut).toHaveBeenCalledTimes(1);
  });

  it("explains when the shift is already clocked out", () => {
    const { getByTestId, queryByTestId } = wrap(<FinishShiftReviewSheet {...props({ alreadyEnded: true })} />);
    expect(getByTestId("finish-shift-ended")).toBeTruthy();
    expect(queryByTestId("finish-shift-clock-out")).toBeNull();
  });
});

describe("SyncStatusSheet", () => {
  const rows = [
    { key: "a", roomId: "208", kind: "checklist" as const, state: "pending" as const, count: 2, savedAt: "2026-10-14T14:50:00.000Z" },
    { key: "b", roomId: "205", kind: "completion" as const, state: "conflict" as const, reason: "SESSION_GONE" },
  ];
  const model = build([room("208"), room("205")], { syncRows: rows });
  const base = (over = {}) => ({
    visible: true, view: buildSyncStatusView({ model, lastSyncedAt: "2026-10-14T14:00:00.000Z", syncing: false }), syncing: false, lastRun: null, t, ctx,
    onRetry: jest.fn(), onOpenRoom: jest.fn(), onOpenTasks: jest.fn(), onClose: jest.fn(), ...over,
  });

  it("shows each change with its room, state and a conflict recovery, without raw codes", () => {
    const p = base();
    const { getAllByTestId, getByTestId, queryByText } = wrap(<SyncStatusSheet {...p} />);
    expect(getAllByTestId("sync-status-row")).toHaveLength(2);
    expect(queryByText(/SESSION_GONE/)).toBeNull();
    fireEvent.press(getByTestId("sync-status-row-action"));
    expect(p.onOpenRoom).toHaveBeenCalledWith("205");
  });

  it("retries once, and never reports done for a refused change", () => {
    const p = base({ lastRun: { ran: true, remaining: 0, failed: 0, conflicts: 1, verified: true } });
    const { getByTestId, queryByText } = wrap(<SyncStatusSheet {...p} />);
    expect(queryByText("Everything was sent and confirmed.")).toBeNull();
    expect(getByTestId("sync-status-run")).toBeTruthy();
  });

  it("disables retry offline with a reason", () => {
    const off = build([room("208")], { online: false, syncRows: [rows[0]] });
    const { getByTestId } = wrap(<SyncStatusSheet {...base({ view: buildSyncStatusView({ model: off, lastSyncedAt: null, syncing: false }) })} />);
    expect(getByTestId("sync-status-retry-hint")).toBeTruthy();
  });
});

describe("ShiftBriefingSheet and summary", () => {
  const model = build([room("208", { status: "IN_PROGRESS" }), room("215")]);
  it("labels the local plan and asks nothing until New briefing is pressed", () => {
    const onNew = jest.fn();
    const { getByTestId } = wrap(
      <ShiftBriefingSheet visible plan={buildBriefingPlan(model, NOW)} briefing={buildBriefingFromModel(model, t)} status="idle" online t={t} ctx={ctx}
        onNewBriefing={onNew} onAskAi={jest.fn()} onOpenRoom={jest.fn()} onClose={jest.fn()} />,
    );
    expect(getByTestId("briefing-source").props.children).toBe("Planned on this phone from your assignments");
    expect(onNew).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("briefing-new"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("says plainly when AI help is used up, keeps the complete local plan, and cannot be asked again", () => {
    const { getByTestId, queryByTestId } = wrap(
      <ShiftBriefingSheet visible plan={buildBriefingPlan(model, NOW)} briefing={buildBriefingFromModel(model, t)} status="credits" online t={t} ctx={ctx}
        onNewBriefing={jest.fn()} onAskAi={jest.fn()} onOpenRoom={jest.fn()} onClose={jest.fn()} />,
    );
    expect(getByTestId("briefing-credits")).toBeTruthy();
    expect(queryByTestId("briefing-unavailable")).toBeNull();
    expect(getByTestId("briefing-plan-208")).toBeTruthy();
    expect(getByTestId("briefing-new").props.accessibilityState.disabled).toBe(true);
  });

  it("marks the order as verified data, shows when the rooms were last updated, and asks about the shift", () => {
    const onAsk = jest.fn();
    const { getByTestId, getByText } = wrap(
      <ShiftBriefingSheet visible plan={buildBriefingPlan(model, NOW)} briefing={buildBriefingFromModel(model, t)} status="idle" online t={t} ctx={ctx}
        updatedAt="2026-10-14T14:45:00.000Z" onNewBriefing={jest.fn()} onAskAi={onAsk} onOpenRoom={jest.fn()} onClose={jest.fn()} />,
    );
    expect(getByTestId("briefing-plan-source").props.children).toMatch(/not from AI/);
    expect(getByTestId("briefing-updated").props.children).toMatch(/Rooms last updated/);
    expect(getByText("Ask about my shift")).toBeTruthy();
    fireEvent.press(getByTestId("briefing-ask-ai"));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("summary has no recap until requested", () => {
    const ended = build([room("101", { status: "CLEAN" })], { shift: "ended" });
    const onRecap = jest.fn();
    const { getByTestId, queryByTestId } = wrap(
      <CompletedShiftSummarySheet visible summary={buildShiftSummary(ended, NOW)} language="en" timeZone="America/Chicago" online recap={null}
        recapStatus="idle" t={t} onRequestRecap={onRecap} onOpenItem={jest.fn()} onOpenSync={jest.fn()} onClose={jest.fn()} />,
    );
    expect(queryByTestId("summary-recap")).toBeNull();
    fireEvent.press(getByTestId("summary-recap-request"));
    expect(onRecap).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 4 locale parity", () => {
  type Json = { [k: string]: Json | string };
  const leaves = (n: Json | string, p: string[] = []): Array<[string, string]> =>
    typeof n === "string" ? [[p.join("."), n]] : Object.entries(n).flatMap(([k, v]) => leaves(v, [...p, k]));
  const ph = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
  const spanish = new Map(leaves(es as Json));
  const keys = leaves(en as Json).filter(([k]) => /^home\.(review|summary|syncSheet|markClean|postComplete|briefingSheet|allHandled)\./.test(k));

  it("covers every key in Spanish with the same placeholders", () => {
    expect(keys.length).toBeGreaterThan(100);
    for (const [k, v] of keys) {
      expect(spanish.get(k)).toBeTruthy();
      expect(ph(spanish.get(k) as string)).toEqual(ph(v));
    }
  });
});

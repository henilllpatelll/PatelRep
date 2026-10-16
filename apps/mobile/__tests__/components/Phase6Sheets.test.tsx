import React from "react";
import fs from "fs";
import path from "path";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { build, room, session } from "../helpers/homeModelFixture";
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

import { CompletedShiftSummarySheet } from "@/components/home/CompletedShiftSummarySheet";
import { FinishShiftReviewSheet } from "@/components/home/FinishShiftReviewSheet";
import { SyncStatusSheet } from "@/components/home/SyncStatusSheet";
import type { ShiftRecap } from "@/lib/ai/shiftRecap";
import { buildHandoffText, handoffItemCount, handoffSections } from "@/lib/housekeeping/handoffText";
import { buildShiftReview } from "@/lib/housekeeping/shiftReview";
import { buildShiftSummary } from "@/lib/housekeeping/shiftSummary";
import { buildSyncStatusView } from "@/lib/housekeeping/syncStatus";

const t = makeTranslator("en");
const tEs = makeTranslator("es");
const ctx = { language: "en", timeZone: "America/Chicago" };
const NOW = new Date("2026-10-14T15:00:00.000Z");
const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);

const endedModel = () =>
  build(
    [
      room("101", { status: "CLEAN" }),
      room("306", { status: "CLEAN", open_work_order_id: "wo-1", open_work_order_title: "Leaking sink for guest Maria Lopez" }),
      room("412", { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null, guest_name: "Maria Lopez" }),
      room("218", { status: "DIRTY" }),
    ],
    { shift: "ended" },
  );

describe("Finish shift review: completed, in progress and not started stay apart", () => {
  const props = (model: ReturnType<typeof build>) => ({
    visible: true, review: buildShiftReview(model), clockingOut: false, error: null, alreadyEnded: false, language: "en",
    timeZone: "America/Chicago", t, ctx, onClockOut: jest.fn(), onOpenItem: jest.fn(), onOpenSync: jest.fn(), onClose: jest.fn(),
  });

  it("shows the open room as in progress, not as part of 'not started'", () => {
    const model = build([room("101", { status: "CLEAN" }), room("102", { status: "IN_PROGRESS" }), room("103", { status: "DIRTY" })], {
      sessions: { "102": session("102") },
    });
    const review = buildShiftReview(model);
    expect(review.totals.inProgress).toBe(1);
    expect(review.totals.notStarted).toBe(1);
    expect(review.totals.inProgress + review.totals.notStarted).toBe(review.remaining);
    const { getByTestId, getByText } = wrap(<FinishShiftReviewSheet {...props(model)} />);
    expect(getByTestId("review-in-progress").props.accessibilityLabel).toMatch(/1 room open right now/);
    expect(getByTestId("review-not-started").props.accessibilityLabel).toMatch(/1 room not started/);
    expect(getByTestId("review-completed").props.accessibilityLabel).toMatch(/1 room submitted or inspected/);
    // The warning agrees with the totals: the open room is not counted as "not started".
    expect(getByText("1 room has not been started.")).toBeTruthy();
    expect(getByText("Room 102 is still being cleaned.")).toBeTruthy();
  });

  it("never reports a locally queued completion as completed", () => {
    const model = build([room("101", { status: "IN_PROGRESS" })], {
      sessions: { "101": session("101", { completeRequestedAt: "2026-10-14T14:55:00.000Z", completionConfirmed: false }) },
    });
    const review = buildShiftReview(model);
    expect(review.totals.completed).toBe(0);
  });

  it("only clocks out on the button and never from an AI path", () => {
    const p = props(build([room("101", { status: "CLEAN" })]));
    const { getByTestId } = wrap(<FinishShiftReviewSheet {...p} />);
    expect(p.onClockOut).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("finish-shift-clock-out"));
    expect(p.onClockOut).toHaveBeenCalledTimes(1);
    const source = fs.readFileSync(path.resolve(__dirname, "../../components/home/FinishShiftReviewSheet.tsx"), "utf8");
    expect(source).not.toMatch(/useAssistant|openAssistant|fetchShiftRecap|\/ai\//);
  });

  it("the button stays locked while a clock-out is in flight (repeated taps do nothing)", () => {
    const p = { ...props(build([room("101", { status: "CLEAN" })])), clockingOut: true };
    const { getByTestId } = wrap(<FinishShiftReviewSheet {...p} />);
    expect(getByTestId("finish-shift-clock-out").props.accessibilityState.disabled).toBe(true);
  });
});

describe("handoff summary", () => {
  it("lists only what is still open, from recorded items, with no guest details", () => {
    const summary = buildShiftSummary(endedModel(), NOW);
    const text = buildHandoffText({ summary, language: "en", t })!;
    expect(text).toMatch(/Shift handoff for/);
    expect(text).toMatch(/218/);
    expect(text).toMatch(/306/);
    expect(text).toMatch(/412/);
    expect(text).not.toMatch(/Maria|Lopez|Leaking sink/);
    expect(text).toMatch(/based on recorded shift activity/);
  });

  it("is null, not padded, when nothing is open", () => {
    const summary = buildShiftSummary(build([room("101", { status: "INSPECTED" }), room("102", { status: "CLEAN" })], { shift: "ended" }), NOW);
    expect(handoffItemCount(summary)).toBe(0);
    expect(handoffSections(summary, t)).toEqual([]);
    expect(buildHandoffText({ summary, language: "en", t })).toBeNull();
  });

  it("does not include an item that has been resolved since", () => {
    const open = buildShiftSummary(endedModel(), NOW);
    const resolved = buildShiftSummary(
      build([room("101", { status: "CLEAN" }), room("306", { status: "CLEAN" }), room("412", { status: "CLEAN" }), room("218", { status: "CLEAN" })], { shift: "ended" }),
      NOW,
    );
    expect(handoffItemCount(open)).toBeGreaterThan(0);
    expect(handoffItemCount(resolved)).toBe(0);
  });

  it("includes the AI note only when a recap already exists, and labels it", () => {
    const summary = buildShiftSummary(endedModel(), NOW);
    const recap = { headline: "h", note: "Two rooms remain open.", source: "ai", cached: false, facts: {} } as unknown as ShiftRecap;
    expect(buildHandoffText({ summary, language: "en", t, recap })).toMatch(/Note written by AI from the shift record: Two rooms remain open\./);
    expect(buildHandoffText({ summary, language: "en", t, recap: null })).not.toMatch(/written by AI/);
  });

  it("warns when changes had not reached the server", () => {
    const summary = { ...buildShiftSummary(endedModel(), NOW), sync: { pending: 2, failed: 0, conflicts: 0, verified: true } };
    expect(buildHandoffText({ summary, language: "en", t })).toMatch(/had not reached the server/);
  });

  it("reads in Spanish", () => {
    const summary = buildShiftSummary(endedModel(), NOW);
    expect(buildHandoffText({ summary, language: "es", t: tEs })).toMatch(/Relevo del turno/);
  });

  it("shows exactly the text that would be shared and shares only when pressed", () => {
    const summary = buildShiftSummary(endedModel(), NOW);
    const text = buildHandoffText({ summary, language: "en", t })!;
    const onShare = jest.fn();
    const { getByTestId } = wrap(
      <CompletedShiftSummarySheet
        visible summary={summary} language="en" timeZone="America/Chicago" online recap={null} recapStatus="idle" t={t}
        handoffText={text} onShareHandoff={onShare} onRequestRecap={jest.fn()} onOpenItem={jest.fn()} onOpenSync={jest.fn()} onClose={jest.fn()}
      />,
    );
    expect(getByTestId("summary-handoff-text")).toBeTruthy();
    expect(onShare).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("summary-handoff-share"));
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it("offers no share row when nothing is open", () => {
    const summary = buildShiftSummary(build([room("101", { status: "INSPECTED" })], { shift: "ended" }), NOW);
    const { queryByTestId } = wrap(
      <CompletedShiftSummarySheet
        visible summary={summary} language="en" timeZone="America/Chicago" online recap={null} recapStatus="idle" t={t}
        handoffText={null} onShareHandoff={undefined} onRequestRecap={jest.fn()} onOpenItem={jest.fn()} onOpenSync={jest.fn()} onClose={jest.fn()}
      />,
    );
    expect(queryByTestId("summary-handoff-share")).toBeNull();
  });
});

describe("Sync Status: AI help is online-only and never queued", () => {
  const view = (online: boolean) => {
    const model = build([room("101", { status: "CLEAN" })], { online });
    return buildSyncStatusView({ model, lastSyncedAt: "2026-10-14T14:50:00.000Z", syncing: false });
  };
  const sheet = (online: boolean) => (
    <SyncStatusSheet visible view={view(online)} syncing={false} lastRun={null} t={t} ctx={ctx} onRetry={jest.fn()} onOpenRoom={jest.fn()} onOpenTasks={jest.fn()} onClose={jest.fn()} />
  );

  it("says online AI is unavailable offline and that local guidance still works", () => {
    const { getByTestId } = wrap(sheet(false));
    expect(getByTestId("sync-status-ai-title").props.children).toBe("Online AI isn't available offline");
    expect(getByTestId("sync-status-ai").props.accessibilityLabel).toMatch(/Nothing AI-related is waiting to send/);
  });

  it("says AI is never saved to send later when online", () => {
    const { getByTestId } = wrap(sheet(true));
    expect(getByTestId("sync-status-ai").props.accessibilityLabel).toMatch(/never saved to send later/);
  });

  it("never shows a change saved only on this phone as synced", () => {
    const model = build([room("101", { status: "CLEAN" })], {
      syncRows: [{ key: "session-101-complete", roomId: "101", kind: "completion", state: "pending", savedAt: "2026-10-14T14:55:00.000Z" }],
    });
    const syncView = buildSyncStatusView({ model, lastSyncedAt: null, syncing: false });
    expect(syncView.status).toBe("pending");
    expect(syncView.pending).toBe(1);
    expect(syncView.rows[0].state).toBe("pending");
  });

  it("keeps pending, failed and conflicted changes apart", () => {
    const model = build([room("101"), room("102"), room("103")], {
      syncRows: [
        { key: "a", roomId: "101", kind: "completion", state: "pending" },
        { key: "b", roomId: "102", kind: "completion", state: "failed", reason: "x" },
        { key: "c", roomId: "103", kind: "completion", state: "conflict", reason: "DND_ACTIVE" },
      ],
    });
    const syncView = buildSyncStatusView({ model, lastSyncedAt: null, syncing: false });
    expect([syncView.pending, syncView.failed, syncView.conflicts]).toEqual([1, 1, 1]);
    expect(syncView.status).toBe("conflict");
    // A conflict is fixed where the work happened; it is never replayed from the drawer.
    expect(syncView.rows.find((row) => row.state === "conflict")?.action).toEqual({ type: "room", roomId: "103" });
    expect(syncView.retryBlock).toBeNull();
  });
});

describe("no AI call can be queued or replayed", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

  it("the offline queues carry only operational actions", () => {
    expect(read("stores/appStore.ts")).toMatch(/type OfflineActionType = "task_complete" \| "room_status" \| "work_order_update" \| "logbook_create"/);
    for (const file of ["lib/offline/sync.ts", "lib/offline/db.ts", "stores/cleanSessionStore.ts", "lib/housekeeping/syncRunner.ts", "lib/housekeeping/sessionGuard.ts"]) {
      expect(read(file)).not.toMatch(/["'`]\/ai\/|sendCopilotMessage|fetchShiftRecap|fetchShiftBriefing/);
    }
  });

  it("the recap is requested only from a button, never from a render or an effect", () => {
    const source = read("lib/housekeeping/useShiftRecap.ts");
    expect(source).not.toMatch(/useEffect\([^)]*request\(/);
    const home = read("components/home/HousekeeperHomeScreen.tsx");
    expect(home).not.toMatch(/recap\.request\(/);
    expect(read("components/home/HomeServiceSheets.tsx")).toMatch(/onRequestRecap=\{\(\) => void recap\.request\(\)\}/);
  });
});

describe("Phase 6 strings exist in English and Spanish with the same placeholders", () => {
  type Json = { [k: string]: Json | string };
  const leaves = (n: Json | string, p: string[] = []): Array<[string, string]> =>
    typeof n === "string" ? [[p.join("."), n]] : Object.entries(n).flatMap(([k, v]) => leaves(v, [...p, k]));
  const ph = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
  const spanish = new Map(leaves(es as Json));
  const PREFIXES = [
    /^settings\.aiVoice\./,
    /^assistant\.menu\.(settings|voiceOffByChoice|voiceBody)$/,
    /^alertsScreen\./,
    /^home\.handoff\./,
    /^home\.attentionCenter\.(ask|summary|section|why)\./,
    /^home\.issue\.(openProcedure|openProcedureHint|ask|askHint)$/,
    /^home\.message\.(ask|roomNotOnList|alreadyRead)$/,
    /^home\.syncSheet\.ai\./,
    /^home\.summary\.recap/,
    /^home\.review\.totals\.(inProgress|notStarted)/,
  ];
  const keys = leaves(en as Json).filter(([k]) => PREFIXES.some((re) => re.test(k)));

  it("covers every new key", () => {
    expect(keys.length).toBeGreaterThan(80);
    for (const [key, value] of keys) {
      expect(spanish.get(key)).toBeTruthy();
      expect(ph(spanish.get(key) as string)).toEqual(ph(value));
    }
  });

  it("uses the app's plural convention (key and key_plural) for new counted strings", () => {
    const counted = keys.filter(([, v]) => v.includes("{{count}}")).map(([k]) => k);
    // (alertsScreen.unreadSuffix_one/_other are older keys, kept for the existing parity tests.)
    for (const key of counted.filter((k) => !k.startsWith("alertsScreen.unreadSuffix_"))) expect(key).not.toMatch(/_(one|other)$/);
  });

  it("does not leave the old misleading recap label", () => {
    expect((en as Json as any).home.summary.recapAiLabel).not.toMatch(/room list/i);
  });
});

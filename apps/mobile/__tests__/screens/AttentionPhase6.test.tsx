import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { useHomeBridge } from "@/stores/homeBridgeStore";
import { build, room } from "../helpers/homeModelFixture";
import { makeTranslator } from "../helpers/i18n";

jest.mock("react-i18next", () => {
  const { makeTranslator: make } = require("../helpers/i18n");
  const t = make(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en", resolvedLanguage: "en" } }) };
});
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useFocusEffect: () => undefined,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

let mockRole = "housekeeper";
jest.mock("@/stores/appStore", () => {
  const state = () => ({
    user: { id: "user-1", tenant_id: "hotel-1", full_name: "Maria Vega", role: mockRole, language_pref: "en" },
    isOnline: true,
  });
  const useAppStore = (selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state());
  useAppStore.getState = state;
  return { useAppStore };
});

const mockOpenAssistant = jest.fn();
let mockHasAssistant = true;
jest.mock("@/lib/ai/AssistantProvider", () => ({
  useAssistantOptional: () => (mockHasAssistant ? { openAssistant: (...args: unknown[]) => mockOpenAssistant(...args) } : null),
}));

const mockRelated = jest.fn();
jest.mock("@/lib/sop/useRelatedProcedures", () => ({ useRelatedProcedures: (...args: unknown[]) => mockRelated(...args) }));

import { AttentionCenterScreen } from "@/components/home/AttentionCenterScreen";
import { IssueDetailsSheet } from "@/components/home/IssueDetailsSheet";
import { attentionWhyLines } from "@/lib/housekeeping/attentionWhy";
import { buildAttentionCenter } from "@/lib/housekeeping/homeAttention";
import { resolveIssueDetails } from "@/lib/housekeeping/homeSheets";

const router = require("expo-router").router as { push: jest.Mock };
const t = makeTranslator("en");
const SCOPE = "hotel-1:user-1";
const ctx = { language: "en", timeZone: "America/Chicago" };
const NOW = new Date("2026-10-14T15:00:00.000Z");

const dnd = (id: string, extra = {}) => room(id, { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null, ...extra });
const reclean = (id: string) =>
  room(id, {
    reclean_requested_at: "2026-10-14T14:00:00.000Z",
    reclean_details: { inspection_id: "i1", inspected_at: null, overall_result: "failed", notes: null, items: [{ id: "c1", label: "Mirror", note: null }] },
  });

const refresh = jest.fn().mockResolvedValue(undefined);
const markNoteRead = jest.fn().mockResolvedValue({ ok: true });

function publish(model: ReturnType<typeof build>) {
  act(() => {
    useHomeBridge.getState().publish({ scope: SCOPE, model, refresh, markNoteRead });
  });
}

async function renderScreen() {
  const screen = render(
    <ThemeProvider>
      <ToastProvider>
        <AttentionCenterScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "housekeeper";
  mockHasAssistant = true;
  mockRelated.mockReturnValue([]);
  act(() => useHomeBridge.getState().clear());
});

describe("Attention Center sections, summary and assistant", () => {
  it("heads each group of items and says what the list holds in one line", async () => {
    publish(build([dnd("214"), reclean("310"), room("112")]));
    const { getByTestId, queryByTestId } = await renderScreen();
    expect(queryByTestId("attention-section-critical") ?? queryByTestId("attention-section-actionable")).toBeTruthy();
    expect(getByTestId("attention-section-restricted").props.children).toBe("Room restrictions");
    expect(getByTestId("attention-summary").props.children).toMatch(/room restriction/);
    // A group with nothing in it gets no heading.
    expect(queryByTestId("attention-section-message")).toBeNull();
  });

  it("offers Ask assistant on a room item and hands over only that room's id and number", async () => {
    publish(build([dnd("214")]));
    const { getByTestId } = await renderScreen();
    fireEvent.press(getByTestId("attention-ask-room:214:dnd"));
    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(mockOpenAssistant).toHaveBeenCalledWith({ contextType: "room", entityId: "214", label: "214" });
  });

  it("offers no assistant to someone who has none, and the list still works", async () => {
    mockHasAssistant = false;
    publish(build([dnd("214")]));
    const { queryByTestId, getByTestId } = await renderScreen();
    expect(queryByTestId("attention-ask-room:214:dnd")).toBeNull();
    expect(getByTestId("attention-card-room:214:dnd")).toBeTruthy();
  });

  it("offers no assistant to a role that does not use it", async () => {
    mockRole = "front_desk";
    publish(build([dnd("214")]));
    const { queryByTestId } = await renderScreen();
    expect(queryByTestId("attention-ask-room:214:dnd")).toBeNull();
  });

  it("never lets the assistant act on the item: asking only opens the assistant", async () => {
    publish(build([dnd("214")]));
    const { getByTestId } = await renderScreen();
    fireEvent.press(getByTestId("attention-ask-room:214:dnd"));
    expect(router.push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(markNoteRead).not.toHaveBeenCalled();
  });
});

describe("attentionWhyLines", () => {
  const center = (rooms: ReturnType<typeof room>[]) => {
    const model = build(rooms);
    return { model, center: buildAttentionCenter(model) };
  };

  it("states an arrival only when the reservation says it is today in the hotel's calendar", () => {
    const today = center([dnd("214", { checkin_time: "2026-10-14T19:00:00.000Z" })]);
    const row = today.center.items.find((r) => r.item.roomNumber === "214")!;
    const lines = attentionWhyLines(row, today.model, ctx, NOW);
    expect(lines.find((l) => l.code === "arrival")?.values.time).toBe("2:00 PM");

    const later = center([dnd("215", { checkin_time: "2026-10-16T19:00:00.000Z" })]);
    const laterRow = later.center.items.find((r) => r.item.roomNumber === "215")!;
    expect(attentionWhyLines(laterRow, later.model, ctx, NOW).map((l) => l.code)).not.toContain("arrival");

    const none = center([dnd("216")]);
    expect(attentionWhyLines(none.center.items.find((r) => r.item.roomNumber === "216")!, none.model, ctx, NOW).map((l) => l.code)).not.toContain("arrival");
  });

  it("reads the work order off the room and never invents one", () => {
    const withWo = center([reclean("310")]);
    withWo.model.dashboard.all[0].room.open_work_order_id = "wo-1";
    withWo.model.dashboard.all[0].room.open_work_order_status = "in_progress";
    const row = withWo.center.items.find((r) => r.item.code === "reclean")!;
    const lines = attentionWhyLines(row, withWo.model, ctx, NOW);
    expect(lines.find((l) => l.code === "workOrder")?.values.status).toBe("in progress");
    const none = center([reclean("311")]);
    const plain = attentionWhyLines(none.center.items.find((r) => r.item.code === "reclean")!, none.model, ctx, NOW);
    expect(plain.map((l) => l.code)).not.toContain("workOrder");
  });

  it("returns nothing for a non-room item and never more than two lines", () => {
    const { model, center: c } = center([reclean("310"), dnd("214")]);
    for (const row of c.items) expect(attentionWhyLines(row, model, ctx, NOW).length).toBeLessThanOrEqual(2);
    const message = { ...c.items[0], item: { ...c.items[0].item, kind: "supervisor_message" as const }, entry: null };
    expect(attentionWhyLines(message, model, ctx, NOW)).toEqual([]);
  });
});

describe("IssueDetailsSheet assistant and procedure", () => {
  const props = (view: ReturnType<typeof resolveIssueDetails>, over = {}) => ({
    visible: true, view, note: null, t, ctx, onViewRoom: jest.fn(), onAddNote: jest.fn(), onViewWorkOrder: jest.fn(), onClose: jest.fn(), ...over,
  });
  const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);
  const dndView = () => resolveIssueDetails({ model: build([dnd("214")]), itemId: "room:214:dnd", role: "housekeeper", isOnline: true });

  it("links an approved procedure only when the hotel has one, and never offers Start", () => {
    mockRelated.mockReturnValue([{ id: "sop-9", title: "Do Not Disturb procedure" }]);
    const onOpenProcedure = jest.fn();
    const { getByTestId, queryByText } = wrap(<IssueDetailsSheet {...props(dndView(), { onOpenProcedure })} />);
    fireEvent.press(getByTestId("issue-open-procedure"));
    expect(onOpenProcedure).toHaveBeenCalledWith("sop-9");
    expect(queryByText(/Start/)).toBeNull();
  });

  it("shows no procedure row when none matches or the opener is absent", () => {
    mockRelated.mockReturnValue([]);
    expect(wrap(<IssueDetailsSheet {...props(dndView(), { onOpenProcedure: jest.fn() })} />).queryByTestId("issue-open-procedure")).toBeNull();
    mockRelated.mockReturnValue([{ id: "sop-9", title: "DND" }]);
    expect(wrap(<IssueDetailsSheet {...props(dndView())} />).queryByTestId("issue-open-procedure")).toBeNull();
  });

  it("looks up procedures only for conditions that have one, and only while the drawer is open", () => {
    wrap(<IssueDetailsSheet {...props(dndView(), { onOpenProcedure: jest.fn() })} />);
    expect(mockRelated).toHaveBeenLastCalledWith(["dnd"], true);
    mockRelated.mockClear();
    const recleanView = resolveIssueDetails({ model: build([reclean("310")]), itemId: "room:310:reclean", role: "housekeeper", isOnline: true });
    wrap(<IssueDetailsSheet {...props(recleanView, { onOpenProcedure: jest.fn() })} />);
    expect(mockRelated).toHaveBeenLastCalledWith([null], false);
  });

  it("asks the assistant about the room without changing anything", () => {
    const onAsk = jest.fn();
    const { getByTestId } = wrap(<IssueDetailsSheet {...props(dndView(), { onAsk })} />);
    fireEvent.press(getByTestId("issue-ask"));
    expect(onAsk).toHaveBeenCalledWith("214", "214", false);
  });

  it("closes safely when the item has been resolved", () => {
    const view = resolveIssueDetails({ model: build([room("112")]), itemId: "room:214:dnd", role: "housekeeper", isOnline: true });
    const { getByTestId } = wrap(<IssueDetailsSheet {...props(view, { onAsk: jest.fn() })} />);
    expect(getByTestId("issue-resolved")).toBeTruthy();
  });

  it("keeps the DND warning and offers no way to clear a restriction", () => {
    const { getByTestId, queryByText } = wrap(<IssueDetailsSheet {...props(dndView(), { onAsk: jest.fn() })} />);
    expect(getByTestId("issue-wait-notice")).toBeTruthy();
    expect(queryByText(/override|enter anyway|mark (the )?(room )?(as )?(clear|available)/i)).toBeNull();
  });
});

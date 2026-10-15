import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { useHomeBridge } from "@/stores/homeBridgeStore";
import { build, room } from "../helpers/homeModelFixture";

jest.mock("react-i18next", () => {
  const { makeTranslator } = require("../helpers/i18n");
  const t = makeTranslator(() => "en");
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

let mockOnline = true;
jest.mock("@/stores/appStore", () => {
  const state = () => ({
    user: { id: "user-1", tenant_id: "hotel-1", full_name: "Maria Vega", role: "housekeeper", language_pref: "en" },
    isOnline: mockOnline,
  });
  const useAppStore = (selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state());
  useAppStore.getState = state;
  return { useAppStore };
});

import { AttentionCenterScreen } from "@/components/home/AttentionCenterScreen";

const router = require("expo-router").router as { push: jest.Mock; replace: jest.Mock };
const dnd = (id: string, extra = {}) => room(id, { dnd_flag: true, status: "OCCUPIED", actual_checkout_at: null, ...extra });
const SCOPE = "hotel-1:user-1";
const NOTE = { id: "note-1", title: "Message from supervisor", body: "Finish 208 then 310.", createdAt: "2026-10-14T14:15:00.000Z", type: "direct_message", data: { room_id: "310" } };

const refresh = jest.fn().mockResolvedValue(undefined);
const markNoteRead = jest.fn();

function publish(model: ReturnType<typeof build>, scope: string | null = SCOPE) {
  act(() => {
    useHomeBridge.getState().publish({ scope, model, refresh, markNoteRead });
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
  // let the theme finish hydrating before anything is asserted
  await act(async () => {
    await Promise.resolve();
  });
  return screen;
}

const ROOMS = () => [
  dnd("214"),
  room("310", { reclean_requested_at: "2026-10-14T14:00:00.000Z", reclean_details: { inspection_id: "i1", inspected_at: null, overall_result: "failed", notes: null, items: [{ id: "c1", label: "Bathroom mirror", note: null }] } }),
  room("305", { actual_checkout_at: null, checkout_time: "2026-10-14T11:00:00.000Z" }),
  room("112"),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  markNoteRead.mockResolvedValue({ ok: true });
  act(() => useHomeBridge.getState().clear());
});

describe("Attention Center", () => {
  it("asks for Home first instead of inventing a list when Home has not published a model", async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId("attention-go-home")).toBeTruthy();
    fireEvent.press(getByTestId("attention-go-home"));
    expect(router.replace).toHaveBeenCalledWith("/(app)/home");
  });

  it("ignores a model that belongs to another signed-in person", async () => {
    publish(build(ROOMS()), "hotel-9:someone-else");
    const { getByTestId, queryByTestId } = await renderScreen();
    expect(getByTestId("attention-go-home")).toBeTruthy();
    expect(queryByTestId("attention-card-room:214:dnd")).toBeNull();
  });

  it("lists each real item once with accurate filter counts", async () => {
    publish(build(ROOMS(), { note: NOTE }));
    const { getByTestId, getAllByTestId } = await renderScreen();
    expect(getByTestId("attention-total").props.children).toBe(4);
    const cards = getAllByTestId(/^attention-card-/);
    expect(cards).toHaveLength(4);
    expect(getByTestId("attention-filter-all").props.accessibilityLabel).toBe("All, 4");
    expect(getByTestId("attention-filter-urgent").props.accessibilityLabel).toBe("Urgent, 1");
    expect(getByTestId("attention-filter-access").props.accessibilityLabel).toBe("Access, 2");
    expect(getByTestId("attention-filter-messages").props.accessibilityLabel).toBe("Messages, 1");
  });

  it("filters the real items and marks the selected filter", async () => {
    publish(build(ROOMS(), { note: NOTE }));
    const { getByTestId, queryByTestId, getAllByTestId } = await renderScreen();
    expect(getByTestId("attention-filter-all").props.accessibilityState).toMatchObject({ selected: true });

    fireEvent.press(getByTestId("attention-filter-access"));
    expect(getByTestId("attention-filter-access").props.accessibilityState).toMatchObject({ selected: true });
    expect(getByTestId("attention-filter-all").props.accessibilityState).toMatchObject({ selected: false });
    expect(getAllByTestId(/^attention-card-/)).toHaveLength(2);
    expect(queryByTestId("attention-card-message:note-1")).toBeNull();
  });

  it("updates immediately when a room changes, and drops a filter that has emptied", async () => {
    publish(build(ROOMS(), { note: NOTE }));
    const { getByTestId, queryByTestId, getAllByTestId } = await renderScreen();
    fireEvent.press(getByTestId("attention-filter-messages"));
    expect(getAllByTestId(/^attention-card-/)).toHaveLength(1);

    // the message is marked read elsewhere: that filter disappears and the list is not left blank
    publish(build(ROOMS()));
    expect(queryByTestId("attention-filter-messages")).toBeNull();
    expect(getAllByTestId(/^attention-card-/).length).toBeGreaterThan(0);
    expect(getByTestId("attention-filter-all").props.accessibilityState).toMatchObject({ selected: true });
  });

  it("shows an empty state when nothing needs attention", async () => {
    publish(build([room("112")]));
    const { getByText } = await renderScreen();
    expect(getByText("Nothing needs your attention")).toBeTruthy();
  });

  it("opens the DND details drawer, which can look at the room but never start it", async () => {
    publish(build(ROOMS()));
    const { getByTestId, queryByText } = await renderScreen();
    fireEvent.press(getByTestId("attention-primary-room:214:dnd"));
    expect(getByTestId("issue-sheet")).toBeTruthy();
    expect(getByTestId("issue-wait-notice")).toBeTruthy();
    expect(queryByText(/start cleaning/i)).toBeNull();

    fireEvent.press(getByTestId("issue-view-room"));
    expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/214?from=attention");
  });

  it("opens a reclean in the existing room workflow, coming back to the Attention Center", async () => {
    publish(build(ROOMS()));
    const { getByTestId } = await renderScreen();
    fireEvent.press(getByTestId("attention-primary-room:310:reclean"));
    expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/310?from=attention");
  });

  it("shows the inspector's actual corrections in the details drawer", async () => {
    publish(build(ROOMS()));
    const { getByTestId, getByText } = await renderScreen();
    fireEvent.press(getByTestId("attention-details-room:310:reclean"));
    expect(getByTestId("issue-sheet")).toBeTruthy();
    expect(getByText("Bathroom mirror")).toBeTruthy();
  });

  it("says the front desk has not confirmed an unverified checkout, apart from the scheduled time", async () => {
    publish(build(ROOMS()));
    const { getByTestId, getByText } = await renderScreen();
    fireEvent.press(getByTestId("attention-details-room:305:checkout_unverified"));
    expect(getByText(/Scheduled checkout:/)).toBeTruthy();
    expect(getByText(/hasn't confirmed checkout/)).toBeTruthy();
  });

  it("opens the supervisor message and marks it read; a failed write keeps it and says so", async () => {
    publish(build(ROOMS(), { note: NOTE }));
    const { getByTestId } = await renderScreen();
    fireEvent.press(getByTestId("attention-primary-message:note-1"));
    expect(getByTestId("message-body").props.children).toBe("Finish 208 then 310.");

    markNoteRead.mockResolvedValueOnce({ ok: false, reason: "failed" });
    fireEvent.press(getByTestId("message-mark-read"));
    await waitFor(() => expect(getByTestId("message-error")).toBeTruthy());
    expect(getByTestId("message-sheet")).toBeTruthy();

    fireEvent.press(getByTestId("message-mark-read"));
    await waitFor(() => expect(markNoteRead).toHaveBeenCalledTimes(2));
  });

  it("links the message to its room only because the record names a room on the list", async () => {
    publish(build(ROOMS(), { note: NOTE }));
    const { getByTestId } = await renderScreen();
    fireEvent.press(getByTestId("attention-primary-message:note-1"));
    fireEvent.press(getByTestId("message-open-link"));
    expect(router.push).toHaveBeenCalledWith("/(app)/my-rooms/310?from=attention");
  });

  it("pulls to refresh through the model Home already owns (no second fetch)", async () => {
    publish(build(ROOMS()));
    const { getByTestId } = await renderScreen();
    const list = getByTestId("attention-list");
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("goes back to Home from the header", async () => {
    publish(build(ROOMS()));
    const { getByTestId } = await renderScreen();
    fireEvent.press(getByTestId("attention-back"));
    expect(router.replace).toHaveBeenCalledWith("/(app)/home");
  });

  it("keeps every control a full-size touch target and labelled for a screen reader", async () => {
    publish(build(ROOMS(), { note: NOTE }));
    const { getByTestId } = await renderScreen();
    const chip = getByTestId("attention-filter-access");
    expect(chip.props.accessibilityRole).toBe("tab");
    expect(Number((require("react-native").StyleSheet.flatten(chip.props.style) as { minHeight: number }).minHeight)).toBeGreaterThanOrEqual(44);
    expect(getByTestId("attention-back").props.accessibilityLabel).toBe("Back to Home");
  });
});

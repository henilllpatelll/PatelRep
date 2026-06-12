import React from "react";
import { render, waitFor } from "@testing-library/react-native";

const mockSetMyRooms = jest.fn();

const mockRooms = [
  {
    id: "room-108",
    room_number: "108",
    floor: 1,
    status: "IN_PROGRESS",
    risk_level: null,
    dnd_flag: false,
    guest_name: "Guest still in",
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
  },
  {
    id: "room-112",
    room_number: "112",
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
  },
  {
    id: "room-115",
    room_number: "115",
    floor: 1,
    status: "DIRTY",
    risk_level: "HIGH",
    dnd_flag: false,
    guest_name: "Mr. Bell",
    predicted_ready_at: null,
    vip_flag: true,
    checkin_time: "2026-05-26T15:00:00.000Z",
  },
  {
    id: "room-101",
    room_number: "101",
    floor: 1,
    status: "INSPECTED",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
  },
];

const EN: Record<string, string> = {
  "home.greetingMorning": "Good morning, {{name}}.",
  "home.greetingAfternoon": "Good afternoon, {{name}}.",
  "home.greetingEvening": "Good evening, {{name}}.",
  "home.shiftSuffix": "Day shift",
  "home.openMyRooms": "Open My Rooms",
  "home.focus.reasonInProgress": "You're already in this one — pick up where you left off.",
  "home.focus.reasonVip": "VIP guest — a perfect room early goes a long way.",
  "home.focus.reasonArrival": "The next guest arrives soon.",
  "home.focus.reasonDeparture": "Guest checked out — it's all yours.",
  "home.focus.reasonDefault": "Fastest path through your list.",
  "home.focus.resume": "Resume {{room}}",
  "home.focus.inProgress": "in progress",
  "home.companion.kicker": "With you",
  "home.companion.empty": "Nothing on your board yet. Enjoy the calm — your rooms will appear here.",
  "home.companion.fresh": "One room at a time — that's all today is.",
  "home.companion.early": "{{done}} done already. You're finding your rhythm.",
  "home.companion.mid": "{{done}} of {{total}} handled — past the halfway feeling. Steady does it.",
  "home.companion.late": "Home stretch. Just {{count}} to go — you've got this.",
  "home.companion.done": "That's a wrap — every room handled. Be proud of today.",
  "home.companion.tipAttention": "{{count}} room(s) are waiting on review — that's not on you. Flag it and keep moving.",
  "home.companion.tipDnd": "DND is up on {{count}} room(s). Skip them guilt-free — they'll clear.",
  "home.companion.tipArrivals": "{{count}} arrival(s) coming up — your plan already puts them first.",
  "home.companion.tipVip": "{{count}} VIP room(s) still ahead — a little extra polish goes a long way.",
  "home.companion.tipBreather": "Good moment for water and a breath. The board can wait two minutes.",
  "home.startWith": "Start with {{room}}",
  "home.allDone": "All assigned rooms are done.",
  "home.pullToRefresh": "Pull to refresh if your supervisor adds more.",
  "ai.briefing.startWith": "Start with room {{room}} — it's the fastest path through your list.",
  "ai.briefing.startVip": "Start with room {{room}} — VIP guest, get it perfect early.",
  "ai.briefing.startArrival": "Start with room {{room}} — the next guest arrives soon.",
  "ai.briefing.allClear": "All caught up. Every assigned room is handled.",
  "ai.briefing.onlyAttentionLeft": "{{count}} room(s) need review before cleaning can start.",
  "ai.briefing.dndWatchout": "Do Not Disturb active on {{count}} room(s) — skip until cleared.",
  "ai.briefing.woWatchout": "Open work orders on {{count}} room(s).",
  "ai.briefing.arrivalWatchout": "Arrivals within 4 hours: {{count}} room(s).",
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`));
    },
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: mockRooms }),
    post: jest.fn().mockRejectedValue(new Error("ai offline")),
  },
}));

jest.mock("@/lib/offline/db", () => ({
  getRooms: jest.fn().mockResolvedValue(mockRooms),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    user: { id: "user-1", full_name: "Maria Vega", role: "housekeeper" },
    isOnline: true,
    myRooms: mockRooms,
    setMyRooms: mockSetMyRooms,
  }),
}));

import HousekeeperHomeScreen from "@/app/(app)/home";

describe("HousekeeperHomeScreen", () => {
  it("renders the redesigned housekeeper dashboard with next room, metrics, route preview, AI plan, and nudge", async () => {
    const { getByText, getByTestId, queryByTestId } = render(<HousekeeperHomeScreen />);

    await waitFor(() => expect(getByText(/Good (morning|afternoon|evening), Maria\./)).toBeTruthy());
    expect(getByTestId("housekeeping-home")).toBeTruthy();
    expect(getByTestId("shift-progress-card")).toBeTruthy();
    expect(getByText("1 / 4")).toBeTruthy();
    expect(getByText("25%")).toBeTruthy();
    expect(getByText(/3 left/)).toBeTruthy();

    expect(getByTestId("next-room-panel")).toBeTruthy();
    expect(getByText("Next best room")).toBeTruthy();
    expect(getByText("Room 112")).toBeTruthy();
    expect(getByText("Fastest path through your list.")).toBeTruthy();
    expect(getByText("Start with 112")).toBeTruthy();
    expect(getByTestId("next-room-resume")).toBeTruthy();
    expect(getByText(/Resume 108/)).toBeTruthy();

    expect(getByTestId("metric-done")).toBeTruthy();
    expect(getByTestId("metric-left")).toBeTruthy();
    expect(getByTestId("metric-attention")).toBeTruthy();
    expect(getByTestId("metric-time")).toBeTruthy();

    expect(getByTestId("queue-preview")).toBeTruthy();
    expect(getByTestId("queue-preview-108")).toBeTruthy();
    expect(getByTestId("queue-preview-112")).toBeTruthy();

    expect(getByTestId("ai-plan-card")).toBeTruthy();
    expect(getByText("AI plan")).toBeTruthy();
    expect(getByText("Start with room 112 — it's the fastest path through your list.")).toBeTruthy();
    expect(getByText("New plan")).toBeTruthy();
    expect(getByText("Ask AI")).toBeTruthy();

    expect(getByTestId("companion-nudge")).toBeTruthy();
    expect(getByText(/waiting on review — that's not on you/)).toBeTruthy();
    expect(queryByTestId("shift-mosaic")).toBeNull();
  });
});

import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator, localeHasKey } from "../helpers/i18n";
import { darkThemeV2, lightThemeV2 } from "@/components/shared/tokensV2";
import { getThemeTokens } from "@/components/shared/tokens";

/* Design System V2 Phase 3 (Housekeeper): the role gate, the legacy-off contract, and the behavior-preserving
   Home / My Rooms / Tasks presentation. Flag-off rendering must stay identical to before. */

let mockLanguage: "en" | "es" = "en";
let mockMode: "light" | "dark" = "light";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage), i18n: { language: mockLanguage, resolvedLanguage: mockLanguage } }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockMode }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ isOnline: true, pendingActions: [], user: { tenant_id: "t1" } }),
}));
jest.mock("@expo/vector-icons", () => {
  const ReactRuntime = require("react");
  const { Text: RNText } = require("react-native");
  return {
    Ionicons: ({ name, color }: { name: string; color: string }) =>
      ReactRuntime.createElement(RNText, { testID: `icon-${name}`, style: { color } }, name),
  };
});

import { DesignV2Scope, useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import { isHousekeeperV2Role, useV2Text } from "@/lib/design/housekeeperV2";
import { useHousekeeperAccent } from "@/lib/theme/useTheme";
import { HomeHeader } from "@/components/home/HomeHeader";
import { CurrentRoomCard } from "@/components/home/CurrentRoomCard";
import { HomeBriefingEntry } from "@/components/home/HomeBriefingEntry";
import { Kicker } from "@/components/home/homeUi";
import { MyRoomsHeader } from "@/components/housekeeping/MyRoomsHeader";
import { TasksHeader } from "@/components/tasks/TasksHeader";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import KnockModal from "@/components/housekeeping/KnockModal";
import type { ActiveRoomView } from "@/lib/housekeeping/homeModel";

const t = mockMakeTranslator(() => mockLanguage);
const flat = (node: { props: Record<string, unknown> }) => StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) as TextStyle;

// V2 is unconditional: the first argument is kept only so existing call sites read the same.
function gated(_enabled: boolean, ui: React.ReactElement) {
  return render(<DesignV2Scope>{ui}</DesignV2Scope>);
}

beforeEach(() => {
  mockLanguage = "en";
  mockMode = "light";
});

describe("role gate", () => {
  function Probe() {
    return <Text testID="probe">{useIsDesignV2() ? "v2" : "legacy"}</Text>;
  }

  it("only the Housekeeper role is migrated in Phase 3", () => {
    expect(isHousekeeperV2Role("housekeeper")).toBe(true);
    for (const role of ["inspector", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm", "", null, undefined]) {
      expect(isHousekeeperV2Role(role as string)).toBe(false);
    }
  });

  it("the scope is V2", () => {
    expect(gated(true, <Probe />).getByTestId("probe").props.children).toBe("v2");
  });

});

describe("V2 text overrides", () => {
  function Overrides() {
    const x = useV2Text();
    return (
      <>
        <Text testID="active">{String(x.active)}</Text>
        <Text testID="label" style={[{ textTransform: "uppercase", letterSpacing: 1 }, x.label]} />
        <Text testID="num" style={[{ fontFamily: "IBMPlexMono_500Medium" }, x.num]} />
        <Text testID="edge">{x.edge}</Text>
      </>
    );
  }

  it("removes shouting labels and the mono font inside the scope", () => {
    const view = gated(true, <Overrides />);
    expect(view.getByTestId("active").props.children).toBe("true");
    expect(flat(view.getByTestId("label")).textTransform).toBe("none");
    expect(flat(view.getByTestId("label")).letterSpacing).toBe(0);
    expect(flat(view.getByTestId("num")).fontFamily).not.toBe("IBMPlexMono_500Medium");
    expect(flat(view.getByTestId("num")).fontFamily).toBeTruthy();
    expect(flat(view.getByTestId("num")).fontVariant).toEqual(["tabular-nums"]);
    expect(view.getByTestId("edge").props.children).toBe(lightThemeV2.borderSubtle);
  });

  it("uses the dark separator in dark mode", () => {
    mockMode = "dark";
    expect(gated(true, <Overrides />).getByTestId("edge").props.children).toBe(darkThemeV2.borderSubtle);
  });

  it("the shouting Kicker becomes a sentence-case label", () => {
    expect(flat(gated(true, <Kicker>Your progress</Kicker>).getByText("Your progress")).textTransform).toBe("none");
  });

  it("the terracotta housekeeper accent is retired inside V2 only", () => {
    function Accent() {
      const a = useHousekeeperAccent();
      return <Text testID="accent">{a.bg}</Text>;
    }
    expect(gated(true, <Accent />).getByTestId("accent").props.children).toBe(lightThemeV2.primary);
  });
});

describe("Home header", () => {
  const sync = { icon: "cloud-done-outline", text: "All changes sent", tone: "ok" } as never;
  const base = {
    meta: "WEDNESDAY, OCT 14 · MORNING",
    metaPlain: "Wednesday, Oct 14 · Morning",
    greeting: "Good morning, Maria",
    status: "Your shift is underway.",
    sync,
    unreadCount: 3,
    topInset: 47,
    t,
    onOpenNotifications: jest.fn(),
    onOpenSync: jest.fn(),
  };

  it("V2 shows the hotel, a sentence-case date and keeps every control and test id", () => {
    const onOpenNotifications = jest.fn();
    const onOpenSync = jest.fn();
    const view = gated(true, <HomeHeader {...base} hotelName="Fossil Creek Inn" onOpenNotifications={onOpenNotifications} onOpenSync={onOpenSync} />);
    expect(view.getByTestId("home-hotel").props.children).toBe("Fossil Creek Inn");
    expect(view.getByText("Wednesday, Oct 14 · Morning")).toBeTruthy();
    expect(view.queryByText("WEDNESDAY, OCT 14 · MORNING")).toBeNull();
    expect(view.getByTestId("home-shift-status")).toBeTruthy();
    fireEvent.press(view.getByTestId("home-notifications"));
    fireEvent.press(view.getByTestId("home-sync-line"));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
    expect(onOpenSync).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("home-notifications-badge")).toBeTruthy();
  });

  it("V2 omits the hotel line when the hotel is unknown", () => {
    expect(gated(true, <HomeHeader {...base} hotelName={null} />).queryByTestId("home-hotel")).toBeNull();
  });
});

describe("Current room card", () => {
  const room = { id: "r1", room_number: "214", status: "IN_PROGRESS" } as never;
  const active = (over: Partial<ActiveRoomView> = {}): ActiveRoomView =>
    ({
      room,
      entry: {} as never,
      sessionState: "active",
      startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      startedAtVerified: true,
      elapsedSeconds: 720,
      estimateMinutes: 30,
      checklistDone: 3,
      checklistTotal: 8,
      pendingSync: false,
      completing: false,
      ...over,
    }) as ActiveRoomView;
  const ctx = { language: "en", timeZone: "America/Chicago" } as never;
  function card(a: ActiveRoomView, canMarkClean: boolean, handlers: Partial<Record<"open" | "mark", jest.Mock>> = {}) {
    return (
      <CurrentRoomCard
        active={a}
        recommendation={null}
        canMarkClean={canMarkClean}
        t={t}
        ctx={ctx}
        onOpenRoom={handlers.open ?? jest.fn()}
        onMarkClean={handlers.mark ?? jest.fn()}
        onMore={jest.fn()}
        onWhy={jest.fn()}
      />
    );
  }

  it("V2 explains what remains instead of offering an unrestricted completion", () => {
    const view = gated(true, card(active(), false));
    expect(view.queryByTestId("focus-mark-clean")).toBeNull();
    expect(view.getByTestId("focus-mark-clean-reason")).toBeTruthy();
    expect(view.getByText("5 checklist steps left before you can mark this room clean.")).toBeTruthy();
  });

  it("V2 offers Mark clean only when the existing rule allows it, with no reason line", () => {
    const mark = jest.fn();
    const view = gated(true, card(active({ checklistDone: 8 }), true, { mark }));
    expect(view.queryByTestId("focus-mark-clean-reason")).toBeNull();
    fireEvent.press(view.getByTestId("focus-mark-clean"));
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("the single primary action opens the existing room workflow", () => {
    const open = jest.fn();
    const view = gated(true, card(active(), false, { open }));
    fireEvent.press(view.getByTestId("focus-primary"));
    expect(open).toHaveBeenCalledWith("r1");
    expect(view.getByTestId("current-room-number").props.children).toBe("214");
    expect(view.getByTestId("current-room-checklist")).toBeTruthy();
  });

  it("a session with no timer start shows no elapsed time (never invented)", () => {
    const view = gated(true, card(active({ startedAt: null }), false));
    expect(view.queryByTestId("current-room-elapsed")).toBeNull();
  });

  it("recovery states keep one obvious route into the room", () => {
    const open = jest.fn();
    const view = gated(true, card(active({ sessionState: "missing", startedAt: null }), false, { open }));
    expect(view.getByTestId("current-room-recovery")).toBeTruthy();
    fireEvent.press(view.getByTestId("focus-primary"));
    expect(open).toHaveBeenCalledWith("r1");
  });
});

describe("AI briefing entry", () => {
  it("only opens the drawer; it carries no request of its own", () => {
    const onOpen = jest.fn();
    const view = gated(true, <HomeBriefingEntry headline="Start with room 214" t={t} onOpen={onOpen} />);
    expect(view.getByText("Start with room 214")).toBeTruthy();
    expect(view.getByText("AI")).toBeTruthy();
    expect(view.getByText(/AI writes a new version only when you ask/)).toBeTruthy();
    fireEvent.press(view.getByTestId("briefing-open"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("My Rooms header", () => {
  const progress = { serviceable: 10, completed: 4, workable: 5, attention: 1, unavailable: 1, percent: 40 } as never;
  it("V2 keeps the three list tabs, their test ids and the sync indicators", () => {
    const onTabChange = jest.fn();
    const view = gated(
      true,
      <MyRoomsHeader
        dateLabel="Wednesday, Oct 14"
        progress={progress}
        indicators={[{ key: "online", icon: "cloud-done-outline", text: "Updated 9:41 AM", tone: "ok" }]}
        tab="route"
        onTabChange={onTabChange}
        topInset={47}
      />,
    );
    expect(view.getByText("Updated 9:41 AM")).toBeTruthy();
    expect(view.getByTestId("my-rooms-summary")).toBeTruthy();
    for (const tab of ["route", "floors", "done"]) expect(view.getByTestId(`my-rooms-tab-${tab}`)).toBeTruthy();
    fireEvent.press(view.getByTestId("my-rooms-tab-done"));
    expect(onTabChange).toHaveBeenCalledWith("done");
    expect(view.getByTestId("my-rooms-tab-route").props.accessibilityState.selected).toBe(true);
  });
});

describe("Tasks header", () => {
  const summary = { remaining: { value: 4 }, inProgress: { value: 1 }, doneToday: { value: null } };
  it("V2 keeps the segments, the sync chip and the history entry; an unknown count is a dash", () => {
    const onSegmentChange = jest.fn();
    const onOpenSync = jest.fn();
    const view = gated(
      true,
      <TasksHeader
        dateLabel="Wednesday, Oct 14"
        sync="pending"
        summary={summary}
        segment="mine"
        counts={{ mine: 5, available: null }}
        onSegmentChange={onSegmentChange}
        onOpenHistory={jest.fn()}
        onOpenSync={onOpenSync}
        topInset={47}
      />,
    );
    expect(view.getByText("—")).toBeTruthy();
    fireEvent.press(view.getByTestId("segment-available"));
    expect(onSegmentChange).toHaveBeenCalledWith("available");
    fireEvent.press(view.getByTestId("sync-indicator"));
    expect(onOpenSync).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("segment-mine").props.accessibilityState.selected).toBe(true);
  });
});

describe("Sheets", () => {
  it("V2 sheets keep a named close control and a pinned footer", () => {
    const onClose = jest.fn();
    const view = gated(
      true,
      <BottomSheet visible title="Room information" onClose={onClose} footer={<Text>Footer action</Text>}>
        <Text>Body</Text>
      </BottomSheet>,
    );
    expect(view.getByText("Room information")).toBeTruthy();
    expect(view.getByText("Footer action")).toBeTruthy();
    fireEvent.press(view.getAllByLabelText("Close").slice(-1)[0]);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Guest knock guidance", () => {
  const knock = () => <KnockModal visible roomNumber="204" statusLabel="Vacant" onConfirm={jest.fn()} onCancel={jest.fn()} onCannotEnter={jest.fn()} />;

  it("V2 keeps every step, the disabled confirm and the exits, with the system-sans title", () => {
    const view = gated(true, knock());
    expect(view.getByTestId("knock-step-1")).toBeTruthy();
    expect(view.getByTestId("knock-disabled-reason")).toBeTruthy();
    expect(view.getByTestId("knock-cant-enter")).toBeTruthy();
    expect(view.getByTestId("knock-cancel")).toBeTruthy();
    const title = view.getAllByRole("header")[0];
    expect(flat(title).fontWeight).toBe("700");
  });

});

describe("copy", () => {
  const KEYS = [
    "home.current.title",
    "home.current.titleNext",
    "home.current.badgeInProgress",
    "home.current.badgeMissing",
    "home.current.badgeConflict",
    "home.current.remaining",
    "home.current.remaining_plural",
    "home.briefing.aiChip",
    "home.briefing.v2Provenance",
  ];
  it.each(KEYS)("%s exists in English and Spanish", (key) => {
    expect(localeHasKey("en", key)).toBe(true);
    expect(localeHasKey("es", key)).toBe(true);
  });

  it("the remaining-steps line pluralises in both languages", () => {
    expect(mockMakeTranslator("en")("home.current.remaining", { count: 1 })).toMatch(/^1 checklist step left/);
    expect(mockMakeTranslator("es")("home.current.remaining", { count: 1 })).toMatch(/^Falta 1 paso/);
    expect(mockMakeTranslator("es")("home.current.remaining", { count: 3 })).toMatch(/^Faltan 3 pasos/);
  });
});

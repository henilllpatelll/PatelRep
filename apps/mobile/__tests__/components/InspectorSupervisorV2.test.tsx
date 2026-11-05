import fs from "fs";
import path from "path";
import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { lightThemeV2 } from "@/components/shared/tokensV2";
import { getThemeTokens } from "@/components/shared/tokens";

/* Design System V2 Phase 4 (Inspector + Housekeeping Supervisor): the role gate, the flag-off contract, and the
   shared presentation pieces both roles use. Flag-off rendering must stay identical to before. */

let mockRole = "inspector";
let mockFlag = true;

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator("en"), i18n: { language: "en", resolvedLanguage: "en" } }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => "light" }));
jest.mock("@/lib/design/designV2", () => ({
  isDesignV2Enabled: () => mockFlag,
  resolveDesignV2Preview: () => mockFlag,
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const ReactRuntime = require("react");
  const { Text: RNText } = require("react-native");
  return {
    Ionicons: ({ name, color }: { name: string; color: string }) =>
      ReactRuntime.createElement(RNText, { testID: `icon-${name}`, style: { color } }, name),
  };
});
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => {
    const state = { user: { id: "u1", role: mockRole, effective_role: mockRole, tenant_id: "h1" }, isOnline: true, unreadCount: 0, hotelTimezone: "America/Chicago" };
    return selector ? selector(state) : state;
  },
}));
// Home routing: only the wiring is under test, so each role's screen is a marker.
jest.mock("@/components/home/HousekeeperHomeScreen", () => {
  const { Text: RNText } = require("react-native");
  return { HousekeeperHome: ({ enabled }: { enabled: boolean }) => <RNText testID="legacy-fallback">{String(enabled)}</RNText> };
});
jest.mock("@/components/home/InspectorHome", () => {
  const { Text: RNText } = require("react-native");
  return { InspectorHome: () => <RNText testID="inspector-home-marker">inspector</RNText> };
});
jest.mock("@/components/home/SupervisorHome", () => {
  const { Text: RNText } = require("react-native");
  return { SupervisorHome: () => <RNText testID="supervisor-home-marker">supervisor</RNText> };
});
jest.mock("@/components/engineering/EngineerHome", () => {
  const { Text: RNText } = require("react-native");
  return { EngineerHome: () => <RNText testID="engineer-home-marker">engineer</RNText> };
});

import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { isHousekeeperV2Role, isInspectorSupervisorV2Role, isV2SurfaceRole, useV2Text } from "@/lib/design/housekeeperV2";
import HomeRoute from "@/app/(app)/home/index";
import { RoleHomeHeader } from "@/components/home/RoleHomeHeader";
import { QuickActions } from "@/components/supervisor/today/QuickActions";
import { ReadinessCard } from "@/components/supervisor/today/ReadinessCard";
import { SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { ResultBadge } from "@/components/supervisor/inspect/history/ResultBadge";
import { DoneRow } from "@/components/supervisor/inspect/DoneRow";
import type { DoneItem } from "@/lib/inspections/lists";

const t = mockMakeTranslator("en");
const flat = (node: { props: Record<string, unknown> }) => StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) as TextStyle;
const gated = (enabled: boolean, ui: React.ReactElement) => render(<DesignV2Scope enabled={enabled}>{ui}</DesignV2Scope>);

beforeEach(() => {
  mockRole = "inspector";
  mockFlag = true;
});

describe("role gate", () => {
  it("Phase 4 adds exactly the Inspector and the Housekeeping Supervisor", () => {
    expect(isInspectorSupervisorV2Role("inspector")).toBe(true);
    expect(isInspectorSupervisorV2Role("housekeeping_supervisor")).toBe(true);
    for (const role of ["housekeeper", "engineer", "chief_engineer", "front_desk", "gm", "", null, undefined]) {
      expect(isInspectorSupervisorV2Role(role as string)).toBe(false);
    }
  });

  it("the migrated surface is housekeeper + inspector + supervisor + engineering (Phase 5), and nobody else", () => {
    for (const role of ["housekeeper", "inspector", "housekeeping_supervisor", "engineer", "chief_engineer"]) expect(isV2SurfaceRole(role)).toBe(true);
    for (const role of ["front_desk", "gm", "", null, undefined]) expect(isV2SurfaceRole(role as string)).toBe(false);
  });

  it("Phase 3's own gate is unchanged", () => {
    expect(isHousekeeperV2Role("housekeeper")).toBe(true);
    expect(isHousekeeperV2Role("inspector")).toBe(false);
  });
});

describe("Home routing", () => {
  const home = (enabled: boolean) => gated(enabled, <HomeRoute />);

  it("V2 on: an Inspector gets the purpose-built Home", () => {
    expect(home(true).getByTestId("inspector-home-marker")).toBeTruthy();
  });

  it("V2 off: the Inspector keeps the legacy fallback with housekeeper functionality disabled", () => {
    mockFlag = false;
    const screen = home(true);
    expect(screen.queryByTestId("inspector-home-marker")).toBeNull();
    expect(screen.getByTestId("legacy-fallback").props.children).toBe("false");
  });

  it("the Supervisor Home is chosen by role as before", () => {
    mockRole = "housekeeping_supervisor";
    expect(home(true).getByTestId("supervisor-home-marker")).toBeTruthy();
  });

  it("other roles never get the Inspector Home", () => {
    mockRole = "housekeeper";
    expect(home(true).queryByTestId("inspector-home-marker")).toBeNull();
    expect(home(true).getByTestId("legacy-fallback").props.children).toBe("true");
  });
});

describe("V2 text helpers added in Phase 4", () => {
  function Probe() {
    const x = useV2Text();
    return (
      <>
        <Text testID="caps">{x.caps("Room board")}</Text>
        <Text testID="pill" style={[{ textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.4 }, x.pill]} />
      </>
    );
  }

  it("inside the scope: sentence-case kickers and a readable pill", () => {
    const view = gated(true, <Probe />);
    expect(view.getByTestId("caps").props.children).toBe("Room board");
    expect(flat(view.getByTestId("pill")).textTransform).toBe("none");
    expect(flat(view.getByTestId("pill")).fontSize).toBeGreaterThanOrEqual(12);
  });

  it("outside the scope: exactly the legacy uppercase micro-label", () => {
    const view = gated(false, <Probe />);
    expect(view.getByTestId("caps").props.children).toBe("ROOM BOARD");
    expect(flat(view.getByTestId("pill")).textTransform).toBe("uppercase");
    expect(flat(view.getByTestId("pill")).fontSize).toBe(10.5);
  });
});

describe("shared pieces follow the scope", () => {
  it("a section label is sentence case in V2 and uppercase otherwise", () => {
    expect(gated(true, <SectionLabel>Selected rooms</SectionLabel>).getByText("Selected rooms")).toBeTruthy();
    expect(gated(false, <SectionLabel>Selected rooms</SectionLabel>).getByText("SELECTED ROOMS")).toBeTruthy();
  });

  it("a result badge never shouts in V2 but keeps its icon AND word", () => {
    const on = gated(true, <ResultBadge result="failed" t={t} />);
    expect(flat(on.getByText("Failed")).textTransform).toBe("none");
    expect(on.getByTestId("icon-close-circle")).toBeTruthy();
    const off = gated(false, <ResultBadge result="failed" t={t} />);
    expect(flat(off.getByText("Failed")).textTransform).toBe("uppercase");
  });

  const done: DoneItem = {
    id: "d1",
    roomId: "r1",
    roomNumber: "214",
    floor: 2,
    building: null,
    inspectorName: "Sam",
    completedAtMs: Date.parse("2026-10-20T18:00:00Z"),
    result: "passed",
    isReinspection: false,
    notes: null,
  };

  it("room numbers use tabular system figures in V2 and the legacy mono face otherwise", () => {
    const row = <DoneRow item={done} timeZone="America/Chicago" language="en" t={t} onPress={jest.fn()} />;
    const on = flat(gated(true, row).getByText("214"));
    expect(on.fontFamily).not.toMatch(/mono/i);
    expect(on.fontVariant).toEqual(["tabular-nums"]);
    expect(flat(gated(false, row).getByText("214")).fontFamily).toMatch(/mono/i);
  });

  it("the Readiness kicker is sentence case in V2", () => {
    const readiness = {
      status: "available",
      value: { ready: 5, inService: 8, toClean: 2, inProgress: 1, awaitingInspection: 1, outOfOrder: 0, progress: 0.62, inventoryTotal: 8 },
    } as never;
    const card = <ReadinessCard readiness={readiness} freshness={null} t={t} onOpen={jest.fn()} onRetry={jest.fn()} />;
    expect(gated(true, card).getByText("Readiness", { exact: false })).toBeTruthy();
    expect(gated(false, card).getByText(/READINESS/)).toBeTruthy();
  });
});

describe("role home header", () => {
  const header = (over: Partial<React.ComponentProps<typeof RoleHomeHeader>> = {}) => (
    <RoleHomeHeader
      prefix="x"
      hotelName="Fossil Creek Inn"
      greeting="Good afternoon, Priya"
      dateLine="Tuesday, October 20"
      unreadCount={4}
      topInset={0}
      t={t}
      onOpenNotifications={jest.fn()}
      {...over}
    />
  );

  it("shows property, greeting, date and an accessible unread bell", () => {
    const view = gated(true, header());
    expect(view.getByTestId("x-hotel").props.children).toBe("Fossil Creek Inn");
    expect(view.getByText("Good afternoon, Priya")).toBeTruthy();
    expect(view.getByText("Tuesday, October 20")).toBeTruthy();
    expect(view.getByLabelText("Notifications, 4 unread")).toBeTruthy();
  });

  it("omits the property line rather than inventing one", () => {
    expect(gated(true, header({ hotelName: null })).queryByTestId("x-hotel")).toBeNull();
  });

  it("caps the unread badge at 99+", () => {
    expect(gated(true, header({ unreadCount: 120 })).getByText("99+")).toBeTruthy();
  });

  it("a read-only status chip is text; an actionable one is a labelled button", () => {
    const status = { text: "Live · Updated just now", tone: "ok" as const, icon: "checkmark-circle-outline" as const };
    const quiet = gated(true, header({ status }));
    expect(quiet.getByLabelText("Live · Updated just now")).toBeTruthy();
    const onPress = jest.fn();
    const live = gated(true, header({ status, onPressStatus: onPress, statusActionLabel: "Refresh" }));
    fireEvent.press(live.getByTestId("x-status"));
    expect(onPress).toHaveBeenCalled();
    expect(live.getByLabelText("Live · Updated just now. Refresh")).toBeTruthy();
  });

  it("the profile entry exists only when asked for", () => {
    expect(gated(true, header()).queryByTestId("x-profile")).toBeNull();
    const withProfile = gated(true, header({ profileName: "Priya Shah", profileLabel: "Profile", onOpenProfile: jest.fn() }));
    expect(withProfile.getByTestId("x-profile")).toBeTruthy();
  });
});

describe("Supervisor quick actions", () => {
  const actions = <QuickActions t={t} onAction={jest.fn()} />;
  const bg = (view: ReturnType<typeof render>, key: string) => flat(view.getByTestId(`today-action-${key}`) as never) as unknown as { backgroundColor: string };

  it("V2 draws one calm surface for every action; legacy keeps its four status tints", () => {
    const on = gated(true, actions);
    const keys = ["shiftNote", "messageTeam", "messageStaff", "handoff"];
    const surfaces = new Set(keys.map((k) => bg(on, k).backgroundColor));
    expect(surfaces).toEqual(new Set([lightThemeV2.surface]));
    const off = gated(false, actions);
    expect(new Set(keys.map((k) => bg(off, k).backgroundColor)).size).toBeGreaterThan(1);
    expect(bg(off, "shiftNote").backgroundColor).toBe(getThemeTokens("light").status.cleanSoft);
  });

  it("keeps all four actions and their labels (nothing hidden by the redesign)", () => {
    const on = gated(true, actions);
    for (const key of ["shiftNote", "messageTeam", "messageStaff", "handoff"]) expect(on.getByTestId(`today-action-${key}`)).toBeTruthy();
  });
});

describe("no uppercase kicker survives outside the V2 helper", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const DIRS = ["components/supervisor", "components/scheduling", "app/(app)/inspect", "app/(app)/room-board", "app/(app)/assignments", "components/home/InspectorHome.tsx", "components/home/RoleHomeHeader.tsx"];
  const files: string[] = [];
  const walk = (p: string) => {
    if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((n) => walk(path.join(p, n)));
    else if (p.endsWith(".tsx")) files.push(p);
  };
  DIRS.forEach((d) => walk(path.join(ROOT, d)));

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("every translated heading goes through v2t.caps() instead of .toUpperCase()", () => {
    const offenders = files.filter((f) => /\.toUpperCase\(\)/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("no migrated screen imports the legacy serif face", () => {
    const offenders = files.filter((f) => /serifFont/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});

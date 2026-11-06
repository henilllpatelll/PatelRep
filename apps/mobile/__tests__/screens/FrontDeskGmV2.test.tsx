import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";

/* Design System V2 Phase 6: Front Desk and GM screens. These pin what the dashboards may claim (real rows only,
   lower bounds marked, failures shown as failures), that opening them writes nothing, and that the guest request
   detail only offers lifecycle steps the server allows. */

let mockOnline = true;
let mockRole = "front_desk";
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { requestId: "g1" };
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator("en"), i18n: { language: "en", resolvedLanguage: "en" } }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => "light" }));
jest.mock("@/lib/design/designV2", () => ({ isDesignV2Enabled: () => true, resolveDesignV2Preview: () => true }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/lib/housekeeping/useHotelName", () => ({ useHotelName: () => "Fossil Creek Inn" }));
jest.mock("@/components/security/SignOutSheet", () => ({ SignOutSheet: () => null }));
jest.mock("@/lib/settings/useOwnProfile", () => ({ useOwnProfile: () => ({ profile: null }) }));
jest.mock("@/lib/settings/useSettingsIdentity", () => ({
  useSettingsIdentity: () => ({ user: { id: "u1" }, name: "Maria Lopez", hotelName: "Fossil Creek Inn" }),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: { channel: () => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() }), removeChannel: jest.fn() },
}));
jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() } };
});
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      user: { id: "u1", role: mockRole, effective_role: mockRole, tenant_id: "h1", language_pref: "en" },
      isOnline: mockOnline,
      unreadCount: 2,
      hotelTimezone: "America/Chicago",
      pendingActions: [],
    };
    return selector ? selector(state) : state;
  },
}));

import { api, ApiError } from "@/lib/api/client";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { FrontDeskHome } from "@/components/home/FrontDeskHome";
import { GMHome } from "@/components/home/GMHome";
import { FrontDeskMore } from "@/components/frontDesk/FrontDeskMore";
import { GuestRequestsV2 } from "@/components/frontDesk/GuestRequestsV2";
import { AlertsV2 } from "@/components/gm/AlertsV2";
import { StaffV2 } from "@/components/gm/StaffV2";
import GuestRequestDetailScreen from "@/app/(app)/guest-requests/[requestId]";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

type Handler = () => unknown;
let routes: Record<string, Handler> = {};

function setRoutes(next: Record<string, Handler>) {
  routes = next;
}

const NOW_ISO = new Date().toISOString();
const request = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Request ${id}`,
  description: "Needs something",
  status: "open",
  priority: "normal",
  category: "service",
  created_at: NOW_ISO,
  rooms: { room_number: "214" },
  ...over,
});
const board = [
  { room_id: "1", status: "INSPECTED", fo_status: "VAC" },
  { room_id: "2", status: "CLEAN", fo_status: "VAC" },
  { room_id: "3", status: "DIRTY", fo_status: "OCC" },
  { room_id: "4", status: "OOO", fo_status: "VAC" },
];

function scoped(node: React.ReactElement) {
  return render(<DesignV2Scope>{node}</DesignV2Scope>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockRole = "front_desk";
  mockParams = { requestId: "g1" };
  routes = {};
  get.mockImplementation((path: string) => {
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) return Promise.reject(new Error(`unexpected GET ${path}`));
    const value = routes[key]();
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
  post.mockResolvedValue({ data: {} });
});

describe("Front Desk Home", () => {
  it("only reads on mount: two GETs, no writes, no AI", async () => {
    setRoutes({ "/guest-requests": () => ({ data: [request("a")] }), "/housekeeping/board": () => ({ data: board }) });
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    await screen.findByTestId("frontdesk-metric-open");
    expect(get.mock.calls.map((c) => String(c[0]).split("?")[0]).sort()).toEqual(["/guest-requests", "/housekeeping/board"]);
    expect(post).not.toHaveBeenCalled();
    expect((api.patch as jest.Mock).mock.calls.length + (api.put as jest.Mock).mock.calls.length + (api.delete as jest.Mock).mock.calls.length).toBe(0);
    expect(screen.getByTestId("frontdesk-hotel").props.children).toBe("Fossil Creek Inn");
    expect(screen.getByTestId("frontdesk-bell-badge")).toBeTruthy();
  });

  it("shows counts from the real rows and opens the next request", async () => {
    setRoutes({
      "/guest-requests": () => ({
        data: [request("a", { status: "open" }), request("b", { status: "arrived" }), request("c", { status: "open", priority: "urgent", title: "Water leak" })],
      }),
      "/housekeeping/board": () => ({ data: board }),
    });
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    const open = await screen.findByTestId("frontdesk-metric-open");
    expect(open.props.accessibilityLabel).toContain("2");
    expect(screen.getByTestId("frontdesk-metric-progress").props.accessibilityLabel).toContain("1");
    expect(screen.getByTestId("frontdesk-metric-urgent").props.accessibilityLabel).toContain("1");
    expect(screen.getByText("Water leak")).toBeTruthy(); // urgent goes first
    fireEvent.press(screen.getByTestId("frontdesk-next-open"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/guest-requests/c");
  });

  it("marks counts as lower bounds when the page is full", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => request(`r${i}`, { status: "open" }));
    setRoutes({ "/guest-requests": () => ({ data: rows }), "/housekeeping/board": () => ({ data: board }) });
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    const open = await screen.findByTestId("frontdesk-metric-open");
    expect(open.props.accessibilityLabel).toContain("100+");
    expect(screen.getByTestId("frontdesk-requests-provenance").props.children).toContain("latest 100");
  });

  it("keeps room condition, occupancy and availability apart", async () => {
    setRoutes({ "/guest-requests": () => ({ data: [] }), "/housekeeping/board": () => ({ data: board }) });
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    await screen.findByTestId("frontdesk-rooms");
    expect(screen.getByTestId("frontdesk-rooms-occupied").props.accessibilityLabel).toBe("Occupied, 1");
    expect(screen.getByTestId("frontdesk-rooms-vacant").props.accessibilityLabel).toBe("Vacant, 3");
    expect(screen.getByTestId("frontdesk-rooms-ooo").props.accessibilityLabel).toBe("Out of order, 1");
    expect(screen.getByTestId("frontdesk-rooms-ready")).toBeTruthy();
  });

  it("shows a failed source as a failure, never as zero or all-clear", async () => {
    setRoutes({ "/guest-requests": () => new Error("boom"), "/housekeeping/board": () => ({ data: board }) });
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    await screen.findByText("Couldn't load guest requests.");
    expect(screen.queryByTestId("frontdesk-metric-open")).toBeNull();
    expect(screen.queryByTestId("frontdesk-attention-none")).toBeNull();
    expect(screen.getByTestId("frontdesk-attention-review")).toBeTruthy();
    expect(screen.getByTestId("frontdesk-notice")).toBeTruthy();
  });

  it("offline with nothing loaded says so and claims nothing", async () => {
    mockOnline = false;
    setRoutes({});
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    expect(screen.getByTestId("frontdesk-notice")).toBeTruthy();
    expect(screen.getByText(/nothing has loaded yet/)).toBeTruthy();
    expect(screen.queryByTestId("frontdesk-attention-none")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("says there is nothing urgent only when both sources loaded and show none", async () => {
    setRoutes({ "/guest-requests": () => ({ data: [request("a")] }), "/housekeeping/board": () => ({ data: board.filter((r) => r.status !== "OOO") }) });
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    expect(await screen.findByTestId("frontdesk-attention-none")).toBeTruthy();
  });

  it("quick actions open the existing screens", async () => {
    setRoutes({ "/guest-requests": () => ({ data: [] }), "/housekeeping/board": () => ({ data: [] }) });
    const screen = scoped(<FrontDeskHome name="Maria Lopez" />);
    await screen.findByTestId("frontdesk-quick");
    fireEvent.press(screen.getByTestId("frontdesk-quick-logbook"));
    fireEvent.press(screen.getByTestId("frontdesk-quick-lost"));
    fireEvent.press(screen.getByTestId("frontdesk-quick-rooms"));
    fireEvent.press(screen.getByTestId("frontdesk-quick-requests"));
    expect(mockPush.mock.calls.map((c) => c[0])).toEqual(["/(app)/logbook", "/(app)/lost-found", "/(app)/room-status", "/(app)/guest-requests"]);
  });
});

describe("General Manager Home", () => {
  const stats = { open: 4, escalated: 1, in_progress: 2, on_hold: 0, overdue: 3, unassigned: 1, urgent: 2, completed_today: 5 };
  const okRoutes = (overrides: Record<string, Handler> = {}) =>
    setRoutes({
      "/housekeeping/board": () => ({ data: board }),
      "/work-orders/stats": () => ({ data: stats }),
      "/guest-requests": () => ({ data: [request("a", { priority: "urgent" })] }),
      "/ai/risk-alerts": () => ({ data: { sla_breaches: [{ work_order_number: 1, title: "AC", due_at: NOW_ISO }], maintenance_risks: [] } }),
      ...overrides,
    });

  it("uses exact work-order stats (not a page of rows) and writes nothing", async () => {
    mockRole = "gm";
    okRoutes();
    const screen = scoped(<GMHome name="Priya Shah" />);
    const tile = await screen.findByTestId("gm-metric-wo");
    await waitFor(() => expect(tile.props.accessibilityLabel).toContain("7")); // 4 + 1 + 2 + 0 active
    expect(tile.props.accessibilityLabel).toContain("3 overdue");
    const paths = get.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("/work-orders/stats"))).toBe(true);
    expect(paths.some((p) => p.includes("per_page=200"))).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("lists real exceptions that each lead to an existing destination", async () => {
    mockRole = "gm";
    okRoutes();
    const screen = scoped(<GMHome name="Priya Shah" />);
    await screen.findByTestId("gm-attention-overdue");
    expect(screen.getByTestId("gm-attention-urgentWo")).toBeTruthy();
    expect(screen.getByTestId("gm-attention-urgentGuest")).toBeTruthy();
    expect(screen.getByTestId("gm-attention-ooo")).toBeTruthy();
    expect(screen.getByTestId("gm-attention-alerts")).toBeTruthy();
    fireEvent.press(screen.getByTestId("gm-attention-ooo"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/room-status?filter=OOO");
    fireEvent.press(screen.getByTestId("gm-attention-alerts"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/alerts");
  });

  it("never turns a failed alerts source into zero or 'nothing urgent'", async () => {
    mockRole = "gm";
    okRoutes({
      "/ai/risk-alerts": () => new Error("down"),
      "/work-orders/stats": () => ({ data: { ...stats, overdue: 0, urgent: 0 } }),
      "/guest-requests": () => ({ data: [request("a")] }),
      "/housekeeping/board": () => ({ data: board.filter((r) => r.status !== "OOO") }),
    });
    const screen = scoped(<GMHome name="Priya Shah" />);
    await waitFor(() => expect(screen.getByTestId("gm-metric-alerts").props.accessibilityLabel).toContain("Unavailable"));
    expect(screen.getByTestId("gm-metric-alerts").props.accessibilityLabel).not.toMatch(/, 0/);
    expect(screen.queryByTestId("gm-attention-none")).toBeNull();
    expect(screen.getByTestId("gm-attention-unavailable")).toBeTruthy();
  });

  it("says nothing is urgent only when every source loaded and none had an exception", async () => {
    mockRole = "gm";
    okRoutes({
      "/ai/risk-alerts": () => ({ data: { sla_breaches: [], maintenance_risks: [] } }),
      "/work-orders/stats": () => ({ data: { ...stats, overdue: 0, urgent: 0 } }),
      "/guest-requests": () => ({ data: [request("a")] }),
      "/housekeeping/board": () => ({ data: board.filter((r) => r.status !== "OOO") }),
    });
    const screen = scoped(<GMHome name="Priya Shah" />);
    expect(await screen.findByTestId("gm-attention-none")).toBeTruthy();
  });

  it("does not invent staff coverage and links to the management destinations", async () => {
    mockRole = "gm";
    okRoutes();
    const screen = scoped(<GMHome name="Priya Shah" />);
    await screen.findByTestId("gm-quick");
    expect(screen.queryByTestId("gm-metric-staff")).toBeNull();
    fireEvent.press(screen.getByTestId("gm-quick-staff"));
    fireEvent.press(screen.getByTestId("gm-quick-alerts"));
    expect(mockPush.mock.calls.map((c) => c[0])).toEqual(["/(app)/staff", "/(app)/alerts"]);
  });
});

describe("Guest requests list", () => {
  it("renders the real row shape and filters by segment and search", async () => {
    setRoutes({
      "/guest-requests": () => ({
        data: [
          request("a", { title: "Extra towels", rooms: { room_number: "214" } }),
          request("b", { title: "Fix TV", status: "resolved", rooms: { room_number: "305" } }),
          request("c", { title: "Late checkout", status: "cancelled" }),
        ],
      }),
    });
    const screen = scoped(<GuestRequestsV2 />);
    await screen.findByTestId("request-a");
    expect(screen.queryByTestId("request-b")).toBeNull(); // resolved is not "active"
    expect(screen.queryByTestId("request-c")).toBeNull(); // cancelled is never listed
    fireEvent.press(screen.getByTestId("requests-segments-resolved"));
    expect(screen.getByTestId("request-b")).toBeTruthy();
    fireEvent.press(screen.getByTestId("requests-segments-all"));
    fireEvent.changeText(screen.getByTestId("requests-search"), "305");
    expect(screen.queryByTestId("request-a")).toBeNull();
    expect(screen.getByTestId("request-b")).toBeTruthy();
    fireEvent.press(screen.getByTestId("request-b"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/guest-requests/b");
  });

  it("shows a failed load as an error with retry, not as 'no requests'", async () => {
    setRoutes({ "/guest-requests": () => new Error("500") });
    const screen = scoped(<GuestRequestsV2 />);
    await screen.findByText(/Couldn't load guest requests/);
    expect(screen.queryByText("No active requests")).toBeNull();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("keeps the assistant entry for creating a request", async () => {
    setRoutes({ "/guest-requests": () => ({ data: [] }) });
    const screen = scoped(<GuestRequestsV2 />);
    await screen.findByText("No active requests");
    fireEvent.press(screen.getByTestId("requests-new"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/copilot");
  });
});

describe("Guest request detail", () => {
  const load = (status: string) => setRoutes({ "/guest-requests": () => ({ data: [request("g1", { status, title: "Extra towels" })] }) });

  it("offers only the steps the server's lifecycle allows from the current status", async () => {
    load("dispatched");
    const screen = scoped(<GuestRequestDetailScreen />);
    await screen.findByTestId("request-detail");
    expect(screen.getByTestId("request-action-arrived")).toBeTruthy();
    expect(screen.getByTestId("request-action-resolved")).toBeTruthy();
    expect(screen.queryByTestId("request-action-acknowledged")).toBeNull();
    expect(screen.queryByTestId("request-action-cancelled")).toBeNull(); // front desk cannot cancel
  });

  it("changes status only through the transition route, with the note", async () => {
    load("open");
    const screen = scoped(<GuestRequestDetailScreen />);
    await screen.findByTestId("request-detail");
    fireEvent.changeText(screen.getByTestId("request-detail-note"), "  Guest called  ");
    fireEvent.press(screen.getByTestId("request-action-acknowledged"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/guest-requests/g1/transition", { status: "acknowledged", detail: "Guest called" }));
    expect((api.patch as jest.Mock)).not.toHaveBeenCalled();
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Updated to Acknowledged"));
  });

  it("sends a double tap once", async () => {
    load("open");
    let release: () => void = () => undefined;
    post.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    const screen = scoped(<GuestRequestDetailScreen />);
    await screen.findByTestId("request-detail");
    fireEvent.press(screen.getByTestId("request-action-acknowledged"));
    fireEvent.press(screen.getByTestId("request-action-acknowledged"));
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
  });

  it("reports a refused step plainly and refreshes the request", async () => {
    load("open");
    post.mockRejectedValue(new ApiError("Cannot transition", 422));
    const screen = scoped(<GuestRequestDetailScreen />);
    await screen.findByTestId("request-detail");
    const before = get.mock.calls.length;
    fireEvent.press(screen.getByTestId("request-action-acknowledged"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining("isn't allowed from the current status")));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });

  it("asks twice before cancelling, and only management can", async () => {
    mockRole = "gm";
    load("open");
    const screen = scoped(<GuestRequestDetailScreen />);
    await screen.findByTestId("request-detail");
    fireEvent.press(screen.getByTestId("request-action-cancelled"));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByTestId("request-cancel-confirm")).toBeTruthy();
    fireEvent.press(screen.getByTestId("request-cancel-confirm-yes"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/guest-requests/g1/transition", { status: "cancelled" }));
  });

  it("does not write while offline", async () => {
    load("open");
    const screen = scoped(<GuestRequestDetailScreen />);
    await screen.findByTestId("request-detail");
    mockOnline = false;
    screen.rerender(
      <DesignV2Scope>
        <GuestRequestDetailScreen />
      </DesignV2Scope>,
    );
    fireEvent.press(screen.getByTestId("request-action-acknowledged"));
    expect(post).not.toHaveBeenCalled();
  });

  it("says so when the request is not in the newest page", async () => {
    mockParams = { requestId: "old" };
    load("open");
    const screen = scoped(<GuestRequestDetailScreen />);
    await screen.findByText("Request not found");
  });
});

describe("GM Alerts", () => {
  it("groups the real response by the server's own rules and labels each source", async () => {
    mockRole = "gm";
    setRoutes({
      "/ai/risk-alerts": () => ({
        data: {
          sla_breaches: [{ work_order_number: 9, title: "AC not cooling", due_at: NOW_ISO }],
          maintenance_risks: [{ id: "a1", name: "Chiller 2", failure_risk_score: 82 }],
          housekeeping_risks: [],
        },
      }),
    });
    const screen = scoped(<AlertsV2 />);
    await screen.findByTestId("alerts-attention");
    expect(screen.getByText("AC not cooling")).toBeTruthy();
    expect(screen.getByText("Overdue work order")).toBeTruthy();
    expect(screen.getByTestId("alerts-watch")).toBeTruthy();
    expect(screen.getByText("82% failure risk")).toBeTruthy();
    expect(screen.getByTestId("alerts-source")).toBeTruthy();
    fireEvent.press(screen.getByTestId("alert-asset-a1"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(app)/assets/a1"));
  });

  it("shows a failed read as a failure, never as 'all clear'", async () => {
    mockRole = "gm";
    setRoutes({ "/ai/risk-alerts": () => new Error("500") });
    const screen = scoped(<AlertsV2 />);
    await screen.findByText(/Couldn't load alerts/);
    expect(screen.queryByText("No alerts right now")).toBeNull();
  });

  it("says 'no alerts' only when the API returned nothing", async () => {
    mockRole = "gm";
    setRoutes({ "/ai/risk-alerts": () => ({ data: { sla_breaches: [], housekeeping_risks: [], maintenance_risks: [] } }) });
    const screen = scoped(<AlertsV2 />);
    await screen.findByText("No alerts right now");
  });
});

describe("GM Staff", () => {
  it("is a directory, says so, groups by role and filters by search", async () => {
    mockRole = "gm";
    setRoutes({
      "/staff": () => ({
        data: {
          total: 3,
          staff: [
            { id: "1", full_name: "Ana Cruz", email: "ana@x.com", role: "housekeeper", is_active: true, rooms_today: 12 },
            { id: "2", full_name: "Bo Lin", email: "bo@x.com", role: "engineer", is_active: true, orders_today: 3 },
            { id: "3", full_name: "Old Hand", email: "old@x.com", role: "engineer", is_active: false },
          ],
        },
      }),
    });
    const screen = scoped(<StaffV2 />);
    await screen.findByTestId("staff-1");
    expect(screen.getByTestId("staff-note").props.children).toMatch(/doesn't show who is on shift/);
    expect(screen.queryByTestId("staff-3")).toBeNull(); // inactive people are not listed
    expect(screen.getByTestId("staff-group-housekeeper")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("staff-search"), "bo@");
    expect(screen.queryByTestId("staff-1")).toBeNull();
    expect(screen.getByTestId("staff-2")).toBeTruthy();
  });

  it("shows a failed load as an error", async () => {
    mockRole = "gm";
    setRoutes({ "/staff": () => new Error("403") });
    const screen = scoped(<StaffV2 />);
    await screen.findByText(/Couldn't load staff/);
  });
});

describe("Front Desk More", () => {
  it("opens the screens that left the tab bar, and keeps sign out on its own row", () => {
    const screen = scoped(<FrontDeskMore />);
    fireEvent.press(screen.getByTestId("more-lost"));
    fireEvent.press(screen.getByTestId("more-profile"));
    fireEvent.press(screen.getByTestId("more-notifications"));
    fireEvent.press(screen.getByTestId("more-help"));
    expect(mockPush.mock.calls.map((c) => c[0])).toEqual(["/(app)/lost-found", "/(app)/profile", "/(app)/notifications", "/(app)/profile/help"]);
    expect(screen.getByTestId("more-signOut")).toBeTruthy();
    expect(screen.getByText("2 unread")).toBeTruthy();
  });
});

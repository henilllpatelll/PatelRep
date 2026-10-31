import React from "react";
import { Alert } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

/* Phase 7 on the phone: the publish review and confirmation, and the employee's offers / open shifts screen. Only the network,
   the router, the translator, the app store, the toast and the icon font are doubled; every sheet and hook is the real one. */

let mockLanguage: "en" | "es" = "en";
const mockParams: Record<string, string> = {};
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const mockAppState = { isOnline: true, hotelTimezone: "America/Chicago", user: { id: "u1", role: "housekeeper", tenant_id: "h1" } };
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { MyOffersScreen } from "@/components/scheduling/MyOffersScreen";
import { PublishSheet } from "@/components/scheduling/PublishSheet";
import { api } from "@/lib/api/client";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const tr = makeTranslator(() => mockLanguage);

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

const wrap = (node: React.ReactNode) => <ThemeProvider>{node}</ThemeProvider>;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
const text = (node: ReactTestInstance): string =>
  node
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => [n.props.children].flat(2).filter((part) => typeof part === "string" || typeof part === "number").join(""))
    .join(" ")
    .trim();
const press = async (screen: ReturnType<typeof render>, id: string) => {
  fireEvent.press(await screen.findByTestId(id));
  await settle();
};
const allText = (screen: ReturnType<typeof render>) => text(screen.root);

const REV = "b0000001-0000-4000-8000-000000000001";
const face = (start: string, end: string, user = "u1") => ({ user_id: user, shift_id: "t1", shift_name: "Morning", work_date: "2030-01-08", start_time: start, end_time: end });
function reviewBody(over: Record<string, unknown> = {}) {
  return {
    data: {
      revision: { id: REV, status: "draft", version: 4, department_id: "d1" }, department: "HK", can_publish: true,
      summary: { new: 2, modified: 1, cancelled: 1, reassigned: 0, employees_affected: 3, total_changes: 4 }, date_range: { from: "2030-01-08", to: "2030-01-09" },
      impact: [{ user_id: "u1", name: "Ana Torres", items: [{ kind: "changed", change_id: "c1", work_date: "2030-01-08", before: face("07:00:00", "15:00:00"), after: face("09:00:00", "17:00:00"), reason: null }] }],
      blocking: [], warnings: [{ code: "insufficient_rest", user_id: "u1", work_date: "2030-01-08", detail: "x", severity: "warn" }], forecast: { available: false, reason: "future_demand_unknown" },
      ...over,
    },
  };
}
const committed = (over: Record<string, unknown> = {}) => ({
  data: { publication_id: REV, published_at: "2030-01-01T18:00:00Z", created: 2, updated: 1, cancelled: 1, employees_affected: 3, notifications_queued: 3, replayed: false, ...over },
});
const notif = (state: string, extra: Record<string, unknown> = {}) => ({
  data: { state, total: 3, by_status: { queued: state === "processing" ? 3 : 0, sent: state === "in_app_available" ? 3 : 0 }, in_app_available: state === "in_app_available" ? 3 : 0, push: { accepted: 2, no_device: 1 }, failed: [], ...extra },
});

let review: ReturnType<typeof reviewBody>;
let notifications: Array<ReturnType<typeof notif>>;
const onClose = jest.fn();
const onPublished = jest.fn();
const onViewPublished = jest.fn();
const onViewDetails = jest.fn();

function sheet() {
  return render(wrap(<PublishSheet revisionId={REV} zone="America/Chicago" language="en" isOnline={mockAppState.isOnline} onClose={onClose} onPublished={onPublished} onViewPublished={onViewPublished} onViewDetails={onViewDetails} t={tr} />));
}
async function openSheet() {
  const screen = sheet();
  await screen.findByTestId("publish-impact");
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReset();
  post.mockReset();
  mockLanguage = "en";
  mockAppState.isOnline = true;
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  review = reviewBody();
  notifications = [notif("in_app_available")];
  get.mockImplementation(async (url: string) => {
    if (url === `/schedules/revisions/${REV}/review`) return review;
    if (url === `/schedules/revisions/${REV}/notifications`) return notifications[Math.min(notifications.length - 1, get.mock.calls.filter(([u]) => u === url).length - 1)];
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("the publish review", () => {
  it("shows real counts, who is affected with before and after, and an honest forecast line", async () => {
    const screen = await openSheet();
    expect(text(screen.getByTestId("publish-tile-new"))).toContain("2");
    expect(text(screen.getByTestId("publish-tile-modified"))).toContain("1");
    expect(text(screen.getByTestId("publish-tile-cancelled"))).toContain("1");
    expect(text(screen.getByTestId("publish-tile-employees"))).toContain("3");
    const impact = text(screen.getByTestId("publish-impact-u1"));
    expect(impact).toContain("Ana Torres");
    expect(impact).toContain("7:00 AM");
    expect(impact).toContain("9:00 AM");
    expect(text(screen.getByTestId("publish-forecast"))).toBe(tr("teamSchedule.publish.forecast.unavailable"));
    expect(text(screen.getByTestId("publish-warnings"))).toContain(tr("teamSchedule.publish.issue.insufficient_rest"));
    expect(get.mock.calls.map(([url]) => url)).toEqual([`/schedules/revisions/${REV}/review`]);
  });

  it("will not publish until the supervisor explicitly confirms what it does", async () => {
    const screen = await openSheet();
    expect(screen.getByTestId("publish-confirm").props.accessibilityState?.disabled).toBe(true);
    expect(text(screen.getByTestId("publish-confirm-check"))).toContain("publishes 4 changes");
    expect(text(screen.getByTestId("publish-confirm-check"))).toContain("notifies 3 employees");
    fireEvent.press(screen.getByTestId("publish-confirm"));
    expect(post).not.toHaveBeenCalled();
    await press(screen, "publish-confirm-check");
    expect(screen.getByTestId("publish-confirm").props.accessibilityState?.disabled).toBeFalsy();
  });

  it("lists blocking problems and keeps publishing impossible", async () => {
    review = reviewBody({ can_publish: false, blocking: [{ code: "overlapping_shift", change_id: "c1", user_id: "u1", work_date: "2030-01-08" }] });
    const screen = await openSheet();
    expect(text(screen.getByTestId("publish-blocking"))).toContain(tr("teamSchedule.publish.issue.overlapping_shift"));
    expect(screen.getByTestId("publish-confirm-check").props.accessibilityState?.disabled).toBe(true);
    await press(screen, "publish-confirm-check");
    fireEvent.press(screen.getByTestId("publish-confirm"));
    expect(post).not.toHaveBeenCalled();
  });

  it("cannot be published offline", async () => {
    mockAppState.isOnline = false;
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    expect(screen.getByTestId("publish-confirm").props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId("publish-offline")).toBeTruthy();
  });

  it("says so when the review itself cannot be read, and offers a retry", async () => {
    get.mockImplementation(async () => { throw Object.assign(new Error("server"), { status: 500 }); });
    const screen = sheet();
    expect(text(await screen.findByTestId("publish-review-failed"))).toBe(tr("teamSchedule.publish.reviewFailed"));
    expect(screen.queryByTestId("publish-confirm")).toBeNull();
    expect(screen.getByTestId("publish-reload")).toBeTruthy();
  });
});

describe("publishing", () => {
  it("sends the reviewed version with an idempotency key, and shows success only from the committed answer", async () => {
    post.mockResolvedValue(committed());
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(`/schedules/revisions/${REV}/publish`);
    expect(post.mock.calls[0][1]).toMatchObject({ expected_version: 4, confirm: true });
    expect(String(post.mock.calls[0][1].idempotency_key)).toMatch(/^publish-/);
    const done = await screen.findByTestId("publish-done");
    expect(text(done)).toContain(tr("teamSchedule.publish.done"));
    expect(text(done)).toContain("2 new, 1 changed, 1 cancelled");
    expect(text(done)).toContain("3");
  });

  it("describes the notifications as queued first, then in-app, and never as delivered", async () => {
    post.mockResolvedValue(committed());
    notifications = [notif("processing")];
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    await waitFor(() => expect(text(screen.getByTestId("publish-notify-headline"))).toContain("queued"));
    expect(allText(screen).toLowerCase()).not.toMatch(/delivered/);
    expect(text(screen.getByTestId("publish-notify-headline"))).toContain("Being processed");
  });

  it("reports in-app availability and provider acceptance separately, with the limits of what is known", async () => {
    post.mockResolvedValue(committed());
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    await waitFor(() => expect(text(screen.getByTestId("publish-notify-headline"))).toContain("available in the app"));
    const notify = text(screen.getByTestId("publish-notify"));
    expect(notify).toContain("accepted by the provider");
    expect(notify).toContain("no phone registered");
    expect(notify).toContain("isn't proof the phone received it");
    expect(notify.toLowerCase().replace("read receipts aren't tracked", "")).not.toMatch(/delivered|\bread\b/);   // it may say receipts are NOT tracked, never that anything was read
  });

  it("offers a retry for notifications that failed, without touching the published schedule", async () => {
    post.mockImplementation(async (url: string) => (url.endsWith("/notifications/retry") ? { data: { reset: 1 } } : committed()));
    notifications = [notif("failed", { by_status: { failed: 1, sent: 2 }, failed: [{ user_id: "u9", retryable: true }] }), notif("in_app_available")];
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    await press(screen, "publish-notify-retry");
    expect(post.mock.calls.map(([url]) => url)).toContain(`/schedules/revisions/${REV}/notifications/retry`);
    expect(post.mock.calls.filter(([url]) => String(url).endsWith("/publish"))).toHaveLength(1);
  });

  it("never claims success when the server refuses: a shift changed under the draft", async () => {
    post.mockRejectedValue(Object.assign(new Error("stale"), { status: 409, code: "stale_shift", body: { code: "stale_shift" } }));
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    expect(text(await screen.findByTestId("publish-failed"))).toContain("Nothing was published");
    expect(screen.queryByTestId("publish-done")).toBeNull();
    expect(onPublished).not.toHaveBeenCalled();
    await press(screen, "publish-reload");                                    // a NEW review is needed before anything can be published
    expect(get.mock.calls.filter(([url]) => String(url).endsWith("/review"))).toHaveLength(2);
    expect(await screen.findByTestId("publish-confirm")).toBeTruthy();
  });

  it("shows the server's blocking list when it refuses a blocked draft", async () => {
    post.mockRejectedValue(Object.assign(new Error("blocked"), { status: 409, code: "publish_blocked", body: { code: "publish_blocked", blocking: [{ code: "approved_time_off", change_id: "c1" }] } }));
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    const failed = await screen.findByTestId("publish-failed");
    expect(text(failed)).toContain("problems that must be fixed");
    expect(allText(screen)).toContain(tr("teamSchedule.publish.issue.approved_time_off"));
  });

  it("treats no answer as 'maybe published' and checks again with the SAME key, never a new one", async () => {
    post.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce(committed({ replayed: true }));
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    expect(text(await screen.findByTestId("publish-unconfirmed"))).toContain("whether the schedule was published");
    expect(screen.queryByTestId("publish-done")).toBeNull();
    await press(screen, "publish-check-again");
    expect(await screen.findByTestId("publish-done")).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1].idempotency_key).toBe(post.mock.calls[0][1].idempotency_key);
    expect(post.mock.calls[1][1].expected_version).toBe(post.mock.calls[0][1].expected_version);
  });

  it("opens the schedule and the publication details from the confirmation", async () => {
    post.mockResolvedValue(committed());
    const screen = await openSheet();
    await press(screen, "publish-confirm-check");
    await press(screen, "publish-confirm");
    await press(screen, "publish-view-published");
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(onViewPublished).toHaveBeenCalledTimes(1);
    await press(screen, "publish-view-details");
    expect(onViewDetails).toHaveBeenCalledWith(REV);
  });

  it("is available in Spanish", async () => {
    mockLanguage = "es";
    const screen = await openSheet();
    expect(allText(screen)).toContain("Publicar horario");
    expect(text(screen.getByTestId("publish-forecast"))).toBe(makeTranslator("es")("teamSchedule.publish.forecast.unavailable"));
  });
});

/* ─── Employee: shift offers and open shifts ───────────────────────────────── */
const GAP = "b0000009-0000-4000-8000-000000000009";
const shiftWire = (id: string, over: Record<string, unknown> = {}) => ({ id, shift_name: "Morning", work_date: "2030-01-08", start_time: "07:00:00", end_time: "15:00:00", starts_at: "2030-01-08T13:00:00Z", ends_at: "2030-01-08T21:00:00Z", required_role: null, status: "open", version: 1, ...over });

describe("employee offers and open shifts", () => {
  let alertSpy: jest.SpyInstance;
  let world: { offers: Array<Record<string, unknown>>; open: Array<Record<string, unknown>>; claims: Array<Record<string, unknown>> };

  beforeEach(() => {
    world = {
      offers: [
        { id: "o1", status: "pending", expires_at: "2030-01-07T20:00:00Z", shift: shiftWire("g1") },
        { id: "o2", status: "declined", expires_at: null, shift: shiftWire("g2", { work_date: "2030-01-03" }) },
        { id: "o3", status: "accepted", expires_at: null, shift: shiftWire("g3", { work_date: "2030-01-04" }) },
      ],
      open: [{ shift: shiftWire(GAP), can_claim: true, blockers: [], my_claim_id: null }, { shift: shiftWire("g5"), can_claim: false, blockers: ["overlapping_shift"], my_claim_id: null }, { shift: shiftWire("g6"), can_claim: false, blockers: [], my_claim_id: "k9" }],
      claims: [{ id: "k1", status: "approved", decided_at: null, shift: shiftWire("g7") }, { id: "k2", status: "declined", decided_at: null, shift: shiftWire("g8") }, { id: "k3", status: "pending", decided_at: null, shift: shiftWire("g9") }],
    };
    get.mockImplementation(async (url: string) => {
      if (url === "/schedules/me/offers?history=true") return { data: world.offers };
      if (url === "/schedules/me/open-shifts") return { data: world.open };
      if (url === "/schedules/me/claims") return { data: world.claims };
      throw new Error(`unexpected GET ${url}`);
    });
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style !== "cancel")?.onPress?.();
    });
  });
  afterEach(() => alertSpy.mockRestore());

  const open = async () => {
    const screen = render(wrap(<MyOffersScreen />));
    await settle();
    await screen.findByTestId("my-offers");
    return screen;
  };

  it("lists pending offers with their expiry and says they are not on the schedule, and shows how earlier ones ended", async () => {
    const screen = await open();
    const card = text(await screen.findByTestId("offer-o1"));
    expect(card).toContain("Morning");
    expect(card).toContain("Offer expires");
    expect(card).toContain(tr("scheduling.offers.notYet"));
    expect(text(screen.getByTestId("offer-past-o2"))).toContain(tr("scheduling.offers.status.declined"));
    expect(text(screen.getByTestId("offer-past-o3"))).toContain(tr("scheduling.offers.status.accepted"));
    expect(screen.queryByTestId("offer-accept-o2")).toBeNull();                       // a finished offer has no buttons
  });

  it("accepts only after an explicit confirmation, and reads the result from the server", async () => {
    post.mockResolvedValue({ data: { offer_id: "o1", status: "accepted", assignment_id: "a1" } });
    const screen = await open();
    await press(screen, "offer-accept-o1");
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(String(alertSpy.mock.calls[0][1])).toContain("once the system confirms it");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/offers/o1/respond", { accept: true }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(tr("scheduling.offers.accepted")));
    expect(get.mock.calls.filter(([url]) => url === "/schedules/me/offers?history=true").length).toBeGreaterThanOrEqual(2);
  });

  it("declines without a confirmation step", async () => {
    post.mockResolvedValue({ data: { offer_id: "o1", status: "declined" } });
    const screen = await open();
    await press(screen, "offer-decline-o1");
    expect(alertSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/offers/o1/respond", { accept: false }));
  });

  it("explains an expired offer and a filled shift instead of failing silently", async () => {
    post.mockRejectedValue(Object.assign(new Error("gone"), { status: 409, code: "gap_not_fillable", body: { code: "gap_not_fillable" } }));
    const screen = await open();
    await press(screen, "offer-accept-o1");
    expect(text(await screen.findByTestId("my-offers-failure"))).toBe(tr("teamSchedule.requests.failure.gap_not_fillable"));
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("shows open shifts with a request button only where the server says the employee may take them", async () => {
    mockParams.tab = "open";
    const screen = await open();
    expect(await screen.findByTestId(`open-claim-${GAP}`)).toBeTruthy();
    expect(text(screen.getByTestId("open-g5"))).toContain(tr("scheduling.offers.cannotClaim"));
    expect(screen.queryByTestId("open-claim-g5")).toBeNull();
    expect(text(screen.getByTestId("open-g6"))).toContain(tr("scheduling.offers.status.claimPending"));
    expect(screen.getByTestId("open-withdraw-g6")).toBeTruthy();
    expect(allText(screen).toLowerCase()).not.toMatch(/called out|absent/);          // another employee's absence is never shown
  });

  it("sends a claim, which is a request and not a shift", async () => {
    mockParams.tab = "open";
    post.mockResolvedValue({ data: { claim_id: "k5", status: "pending", shift: shiftWire(GAP) } });
    const screen = await open();
    await press(screen, `open-claim-${GAP}`);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/schedules/gaps/${GAP}/claims`, {}));
    expect(text(await screen.findByTestId(`open-${GAP}`))).toContain(tr("scheduling.offers.claimHint"));
  });

  it("shows the employee's own requests with the supervisor's decision, and lets a pending one be withdrawn", async () => {
    mockParams.tab = "requests";
    post.mockResolvedValue({ data: { claim_id: "k3", status: "withdrawn" } });
    const screen = await open();
    expect(text(await screen.findByTestId("claim-k1"))).toContain(tr("scheduling.offers.claimStatus.approved"));
    expect(text(screen.getByTestId("claim-k2"))).toContain(tr("scheduling.offers.claimStatus.declined"));
    expect(screen.queryByTestId("claim-withdraw-k1")).toBeNull();
    await press(screen, "claim-withdraw-k3");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/claims/k3/withdraw", {}));
  });

  it("says when there is nothing, and when the list cannot be read", async () => {
    world.offers = [];
    const screen = await open();
    expect(await screen.findByTestId("my-offers-empty")).toBeTruthy();
    get.mockImplementation(async () => { throw Object.assign(new Error("server"), { status: 500 }); });
    const failing = await open();
    expect(await failing.findByTestId("my-offers-retry")).toBeTruthy();
  });
});

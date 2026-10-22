import React from "react";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import { BackHandler, Image } from "react-native";
import { makeTranslator } from "../helpers/i18n";

/* ─── Harness ───────────────────────────────────────────────────────────────
   The real record screen, hooks, models and components; only the network, router, translator and Android back
   button are replaced. */

let mockParams: Record<string, string | undefined> = {};
let mockLanguage: "en" | "es" = "en";
let mockScheme: "light" | "dark" = "light";
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => {
  const react = require("react");
  return {
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      replace: (...args: unknown[]) => mockReplace(...args),
      back: () => mockBack(),
      canGoBack: () => mockCanGoBack(),
      setParams: jest.fn(),
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(callback, [callback]),
  };
});
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const english = translator("en");
  const spanish = translator("es");
  const i18n = { get language() { return mockLanguage; } };
  return { useTranslation: () => ({ t: mockLanguage === "es" ? spanish : english, i18n }) };
});
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
jest.mock("@/lib/api/inspections", () => ({ fetchInspectionDetail: jest.fn() }));
jest.mock("@/lib/api/inspectionHistory", () => ({ fetchInspectionTimeline: jest.fn(), fetchEvidenceUrl: jest.fn() }));
jest.setTimeout(30000);

import { fetchInspectionDetail, type InspectionDetail } from "@/lib/api/inspections";
import { fetchEvidenceUrl, fetchInspectionTimeline, type InspectionTimeline } from "@/lib/api/inspectionHistory";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import InspectionRecordScreen from "@/app/(app)/inspect/record/[inspectionId]";

const mockDetail = fetchInspectionDetail as jest.Mock;
const mockTimeline = fetchInspectionTimeline as jest.Mock;
const mockEvidence = fetchEvidenceUrl as jest.Mock;
const en = makeTranslator("en");
const es = makeTranslator("es");

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
async function settle() {
  await flush();
  await flush();
}
const renderScreen = () =>
  render(
    <ThemeProvider>
      <InspectionRecordScreen />
    </ThemeProvider>,
  );

const answer = (id: string, section: string, result: string, over: Record<string, unknown> = {}) => ({
  template_item_id: id,
  section,
  description: `Standard ${id}`,
  is_required: true,
  requires_photo_on_fail: false,
  result,
  note: null,
  severity: null,
  photo_url: null,
  ...over,
});

const detail = (over: Partial<InspectionDetail> = {}): InspectionDetail =>
  ({
    id: "insp-1",
    room_id: "room-205",
    room_number: "205",
    floor: 2,
    building: null,
    room_type_id: null,
    template_id: "t1",
    template_name: "Standard King",
    overall_result: "passed",
    notes: null,
    completed_at: "2026-10-21T17:04:00.000Z", // 12:04 PM in Chicago
    inspected_by: "sup-1",
    inspector_name: "Ana Supervisor",
    housekeeper_id: "hk-1",
    housekeeper_name: "Maria S.",
    service_type: "DEP",
    correction_kind: null,
    reinspection_of: null,
    items: [answer("a", "Bathroom", "pass"), answer("b", "Bathroom", "pass"), answer("c", "Bathroom", "na"), answer("d", "Bedroom", "pass")],
    correction: null,
    ...over,
  }) as InspectionDetail;

const failedDetail = (over: Partial<InspectionDetail> = {}) =>
  detail({
    id: "insp-f",
    overall_result: "failed",
    notes: "Bathroom needs another pass.",
    correction_kind: "reclean",
    items: [
      answer("t", "Bathroom", "fail", { description: "Towels and amenities", note: "Two bath towels missing.", severity: "minor", photo_url: "https://signed.example/t.jpg", has_evidence: true }),
      answer("m", "Bathroom", "pass"),
      answer("b", "Bedroom", "pass"),
    ],
    ...over,
  });

const timeline = (over: Partial<InspectionTimeline> = {}): InspectionTimeline => ({
  inspection_id: "insp-f",
  room_id: "room-205",
  room_number: "205",
  truncated: false,
  inspections: [
    { id: "insp-f", overall_result: "failed", completed_at: "2026-10-21T17:04:00.000Z", inspected_by: "s1", inspector_name: "Ana Supervisor", reinspection_of: null, is_reinspection: false, correction_kind: "reclean", failed_items: [{ template_item_id: "t", section: "Bathroom", description: "Towels and amenities", note: null, severity: "minor" }], verified_by: "insp-p", repeated_by: null },
    { id: "insp-p", overall_result: "passed", completed_at: "2026-10-21T17:31:00.000Z", inspected_by: "s2", inspector_name: "Ben Supervisor", reinspection_of: "insp-f", is_reinspection: true, correction_kind: null, failed_items: [], verified_by: null, repeated_by: null },
  ],
  events: [
    { key: "k1", type: "inspection_failed", at: "2026-10-21T17:04:00.000Z", actor_name: "Ana Supervisor", inspection_id: "insp-f" },
    { key: "k2", type: "correction_created", at: "2026-10-21T17:04:30.000Z", actor_name: null, inspection_id: "insp-f" },
    { key: "k3", type: "reinspection_passed", at: "2026-10-21T17:31:00.000Z", actor_name: "Ben Supervisor", inspection_id: "insp-p" },
  ],
  ...over,
});

const verifiedCorrection = { status: "verified", reinspection_id: "insp-p", kind: "reclean", task: null } as unknown as InspectionDetail["correction"];

let backHandler: (() => boolean) | null = null;
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { inspectionId: "insp-1", from: "done" };
  mockLanguage = "en";
  mockScheme = "light";
  mockCanGoBack.mockReturnValue(true);
  mockDetail.mockResolvedValue(detail());
  mockTimeline.mockResolvedValue(timeline());
  mockEvidence.mockResolvedValue({ url: "https://signed.example/fresh.jpg", expiresIn: 600 });
  backHandler = null;
  jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_: string, handler: () => boolean) => {
    backHandler = handler;
    return { remove: jest.fn() };
  }) as never);
  useAppStore.setState({ hotelTimezone: "America/Chicago", isOnline: true, user: { id: "sup-1", tenant_id: "hotel-1", role: "housekeeping_supervisor" } as never });
});

describe("a passed inspection", () => {
  it("shows the room, outcome, hotel-local time and the information that was recorded", async () => {
    const screen = renderScreen();
    await settle();
    expect(mockDetail).toHaveBeenCalledWith("insp-1");
    expect(screen.getByTestId("record-room").props.children).toBe("Room 205");
    expect(within(screen.getByTestId("record-result")).getByText("Passed")).toBeTruthy();
    expect(screen.getByTestId("record-when").props.children).toBe("Oct 21 · 12:04 PM");
    const info = (key: string) => screen.getByTestId(`record-info-${key}`).props.accessibilityLabel as string;
    expect(info("inspector")).toBe("Inspector: Ana Supervisor");
    expect(info("housekeeper")).toBe("Cleaned by: Maria S.");
    expect(info("template")).toBe("Checklist: Standard King");
    expect(info("service")).toBe("Service: Departure");
    expect(info("type")).toBe("Inspection: Initial inspection");
  });

  it("tallies each section out of what was answered, leaving N/A out, and expands on demand", async () => {
    const screen = renderScreen();
    await settle();
    const bathroom = screen.getByTestId("record-section-toggle-section-0");
    expect(bathroom.props.accessibilityLabel).toBe("Bathroom, 2/2 passed, 1 not applicable. Double tap to expand or collapse.");
    expect(bathroom.props.accessibilityState).toEqual({ expanded: true }); // nothing failed: the first section opens
    expect(screen.getByText("Standard a")).toBeTruthy();
    expect(screen.queryByText("Standard d")).toBeNull(); // Bedroom starts collapsed
    await act(async () => fireEvent.press(screen.getByTestId("record-section-toggle-section-1")));
    expect(screen.getByText("Standard d")).toBeTruthy();
    await act(async () => fireEvent.press(bathroom));
    expect(screen.queryByText("Standard a")).toBeNull();
  });

  it("says plainly when there are no notes, and is read-only", async () => {
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-notes-text").props.children).toBe("No additional notes recorded.");
    expect(screen.queryByTestId("record-issues")).toBeNull();
    expect(screen.queryByTestId("record-correction")).toBeNull();
    expect(screen.queryByTestId("record-related")).toBeNull(); // not part of any correction cycle
    expect(mockTimeline).not.toHaveBeenCalled();
  });

  it("shows a long inspector note in full", async () => {
    const note = "Very long note. ".repeat(60).trim();
    mockDetail.mockResolvedValue(detail({ notes: note }));
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-notes-text").props.children).toBe(note);
  });
});

describe("what was never stored is not made up", () => {
  it("an older inspection with no checklist rows says so instead of listing passes", async () => {
    mockDetail.mockResolvedValue(detail({ items: [] }));
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-checklist-missing")).toBeTruthy();
    expect(screen.queryByTestId("record-section-section-0")).toBeNull();
    expect(within(screen.getByTestId("record-result")).getByText("Passed")).toBeTruthy();
  });

  it("missing facts read 'Not recorded'", async () => {
    mockDetail.mockResolvedValue(detail({ housekeeper_name: null, template_name: null, service_type: null, completed_at: null }));
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-info-housekeeper").props.accessibilityLabel).toBe("Cleaned by: Not recorded");
    expect(screen.getByTestId("record-info-template").props.accessibilityLabel).toBe("Checklist: Not recorded");
    expect(screen.getByTestId("record-info-service").props.accessibilityLabel).toBe("Service: Not recorded");
    expect(screen.getByTestId("record-when").props.children).toBe("Time not recorded");
  });

  it("a historical conditional is its own outcome with an explanation", async () => {
    mockDetail.mockResolvedValue(detail({ overall_result: "conditional" }));
    const screen = renderScreen();
    await settle();
    expect(within(screen.getByTestId("record-result")).getByText("Conditional (historical)")).toBeTruthy();
    expect(screen.getByTestId("record-conditional-note")).toBeTruthy();
  });

  it("a failed inspection with no recorded failed items says that, rather than listing none silently", async () => {
    mockDetail.mockResolvedValue(detail({ overall_result: "failed", items: [] }));
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-issues-missing")).toBeTruthy();
  });
});

describe("a failed inspection", () => {
  beforeEach(() => {
    mockParams = { inspectionId: "insp-f", from: "done" };
    mockDetail.mockResolvedValue(failedDetail({ correction: verifiedCorrection }));
  });

  it("shows each failed standard exactly as recorded, with severity, note and evidence", async () => {
    const screen = renderScreen();
    await settle();
    const issue = within(screen.getByTestId("record-issue-t"));
    expect(issue.getByText("Towels and amenities")).toBeTruthy();
    expect(issue.getByText("Result: Failed")).toBeTruthy();
    expect(screen.getByTestId("record-issue-severity-t").props.children).toBe("Severity: Minor");
    expect(screen.getByTestId("record-issue-note-t").props.children).toBe("Two bath towels missing.");
    expect(screen.getByTestId("evidence-thumb-t")).toBeTruthy();
    expect(screen.getByTestId("record-notes-text").props.children).toBe("Bathroom needs another pass.");
  });

  it("the failure stays Failed after a later reinspection verified it - and the status says so", async () => {
    const screen = renderScreen();
    await settle();
    expect(within(screen.getByTestId("record-result")).getByText("Failed")).toBeTruthy();
    expect(screen.getByTestId("record-correction-status").props.children).toBe("Verified by a passing reinspection");
  });

  it("opens the photo, and asks for a fresh link when the first one fails to load", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("evidence-thumb-t")));
    expect(screen.getByTestId("workspace-photo-viewer")).toBeTruthy();
    const viewerImage = screen.getByTestId("workspace-photo-viewer-image");
    await act(async () => fireEvent(viewerImage, "error"));
    await settle();
    expect(mockEvidence).toHaveBeenCalledWith("insp-f", "t");
    expect(screen.getByTestId("workspace-photo-viewer-image").props.source).toEqual({ uri: "https://signed.example/fresh.jpg" });
  });

  it("when the photo is gone the viewer says so", async () => {
    mockEvidence.mockRejectedValue({ status: 404 });
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("evidence-thumb-t")));
    await act(async () => fireEvent(screen.getByTestId("workspace-photo-viewer-image"), "error"));
    await settle();
    expect(screen.getByTestId("workspace-photo-viewer-lost").props.children).toBe("This photo is no longer available.");
  });

  it("evidence the record has but cannot link right now is unavailable (with a retry), never hidden", async () => {
    mockDetail.mockResolvedValue(failedDetail({ items: [answer("t", "Bathroom", "fail", { description: "Towels", severity: "minor", photo_url: null, has_evidence: true })] }));
    const screen = renderScreen();
    await settle();
    const gone = screen.getByTestId("evidence-unavailable-t");
    expect(within(gone).getByText("Photo unavailable. Tap to try again.")).toBeTruthy();
    await act(async () => fireEvent.press(gone));
    await settle();
    expect(mockEvidence).toHaveBeenCalledWith("insp-f", "t");
    expect(screen.getByTestId("evidence-thumb-t")).toBeTruthy(); // the retry produced a link
  });

  it("an image that fails to load falls back to the unavailable state", async () => {
    const screen = renderScreen();
    await settle();
    const thumb = within(screen.getByTestId("evidence-thumb-t")).UNSAFE_getByType(Image);
    await act(async () => fireEvent(thumb, "error"));
    expect(screen.getByTestId("evidence-unavailable-t")).toBeTruthy();
  });

  it("a failed standard is flagged with the word Fail, not only a colour", async () => {
    const screen = renderScreen();
    await settle();
    // the section holding a failure opens by itself
    expect(screen.getByTestId("record-answer-t").props.accessibilityLabel).toBe("Towels and amenities: Fail");
  });
});

describe("the correction cycle", () => {
  beforeEach(() => {
    mockParams = { inspectionId: "insp-f", from: "done" };
    mockDetail.mockResolvedValue(failedDetail({ correction: verifiedCorrection }));
  });

  it("lists every inspection of the cycle and opens another by its id", async () => {
    const screen = renderScreen();
    await settle();
    expect(mockTimeline).toHaveBeenCalledWith("insp-f");
    expect(screen.getByTestId("record-related-insp-f").props.accessibilityState).toMatchObject({ disabled: true, selected: true });
    await act(async () => fireEvent.press(screen.getByTestId("record-related-insp-p")));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/inspect/record/[inspectionId]",
      params: { inspectionId: "insp-p", from: "cycle", roomId: "room-205", roomNumber: "205" },
    });
  });

  it("links to the reinspection that verified the correction", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("record-view-followup")));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ inspectionId: "insp-p" }) }));
  });

  it("opens the correction timeline with only the recorded events, oldest first", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("record-view-timeline")));
    const sheet = within(screen.getByTestId("timeline-sheet"));
    expect(sheet.getByText("Room 205 · Correction history")).toBeTruthy();
    expect(sheet.getAllByText(/Original inspection|Correction created|Reinspection passed, room approved/).map((n) => n.props.children)).toEqual([
      "Original inspection",
      "Correction created",
      "Reinspection passed, room approved",
    ]);
    expect(sheet.queryByText("Work started")).toBeNull(); // nobody started the work: no such event
  });

  it("a timeline that can't be loaded says so, and the record stays usable", async () => {
    mockTimeline.mockRejectedValue({ status: 500 });
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-related-retry")).toBeTruthy();
    expect(screen.getByTestId("record-correction-status")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("record-view-timeline")));
    expect(within(screen.getByTestId("timeline-sheet")).getByTestId("timeline-failed")).toBeTruthy();
  });

  it("a reinspection says it is one and links back to the original", async () => {
    mockParams = { inspectionId: "insp-p", from: "cycle" };
    mockDetail.mockResolvedValue(detail({ id: "insp-p", reinspection_of: "insp-f", correction: null }));
    mockTimeline.mockResolvedValue(timeline({ inspection_id: "insp-p" }));
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-info-type").props.accessibilityLabel).toBe("Inspection: Reinspection");
    expect(screen.getByTestId("record-related-insp-p").props.accessibilityState).toMatchObject({ selected: true });
    await act(async () => fireEvent.press(screen.getByTestId("record-related-insp-f")));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ inspectionId: "insp-f" }) }));
  });
});

describe("failures are told apart", () => {
  it.each([
    [{ status: 404 }, "Inspection not found", "Back to inspections"],
    [{ status: 403 }, "You can't open this", "Back to inspections"],
    [{ status: 500 }, "Couldn't load this inspection", "Try again"],
  ])("%j", async (error, title, action) => {
    mockDetail.mockRejectedValue(error);
    const screen = renderScreen();
    await settle();
    const notice = within(screen.getByTestId("record-failed"));
    expect(notice.getByText(title)).toBeTruthy();
    expect(notice.getByText(action)).toBeTruthy();
    expect(screen.queryByTestId("record-notes")).toBeNull(); // never an empty record
  });

  it("offline is its own message, and Try again re-reads the record", async () => {
    useAppStore.setState({ isOnline: false });
    mockDetail.mockRejectedValueOnce(new Error("network"));
    const screen = renderScreen();
    await settle();
    expect(within(screen.getByTestId("record-failed")).getByText("You're offline")).toBeTruthy();
    mockDetail.mockResolvedValue(detail());
    await act(async () => fireEvent.press(screen.getByTestId("record-failed-action")));
    await settle();
    expect(screen.getByTestId("record-room")).toBeTruthy();
  });

  it("a link without an inspection id is refused plainly", async () => {
    mockParams = {};
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-invalid")).toBeTruthy();
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it("'View room' opens that room on the Room Board", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("record-view-room")));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-205" } });
  });
});

describe("navigation", () => {
  it("the header Back pops the stack", async () => {
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("workspace-back")));
    expect(mockBack).toHaveBeenCalled();
  });

  it("Android back closes an open drawer first, then leaves", async () => {
    mockParams = { inspectionId: "insp-f", from: "done" };
    mockDetail.mockResolvedValue(failedDetail({ correction: verifiedCorrection }));
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("record-view-timeline")));
    expect(screen.getByTestId("timeline-sheet")).toBeTruthy();
    let handled = false;
    await act(async () => { handled = backHandler!(); });
    expect(handled).toBe(true);
    expect(mockBack).not.toHaveBeenCalled();
    await act(async () => { backHandler!(); });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("from the Room Board, Back reopens that room's drawer", async () => {
    mockParams = { inspectionId: "insp-1", from: "board", roomId: "room-205" };
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("workspace-back")));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-205" } });
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("with nothing to go back to, Back falls back to where the supervisor came from", async () => {
    mockCanGoBack.mockReturnValue(false);
    mockParams = { inspectionId: "insp-1", from: "corrections" };
    const screen = renderScreen();
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId("workspace-back")));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/(app)/inspect", params: { tab: "corrections" } });
  });

  it("signing in to another hotel leaves the record instead of showing the old hotel's data", async () => {
    const screen = renderScreen();
    await settle();
    expect(screen.getByText("Ana Supervisor")).toBeTruthy();
    mockDetail.mockRejectedValue({ status: 404 }); // the other hotel's server does not know this inspection
    await act(async () => useAppStore.setState({ user: { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" } as never }));
    await settle();
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/(app)/inspect" });
    expect(screen.queryByText("Ana Supervisor")).toBeNull();
    expect(within(screen.getByTestId("record-failed")).getByText("Inspection not found")).toBeTruthy();
  });
});

describe("Spanish and dark mode", () => {
  it("renders real Spanish and never a raw key", async () => {
    mockLanguage = "es";
    mockParams = { inspectionId: "insp-f", from: "done" };
    mockDetail.mockResolvedValue(failedDetail({ correction: verifiedCorrection }));
    const screen = renderScreen();
    await settle();
    expect(screen.getByText(es("inspect.history.record.title"))).toBeTruthy();
    expect(screen.getByTestId("record-room").props.children).toBe("Habitación 205");
    expect(screen.getByTestId("record-correction-status").props.children).toBe(es("inspect.correction.detail.verified"));
    expect(screen.queryAllByText(/^inspect\.[A-Za-z]/)).toHaveLength(0);
    expect(en("inspect.history.record.title")).not.toBe(es("inspect.history.record.title"));
  });

  it("renders the same content in dark mode", async () => {
    mockScheme = "dark";
    const screen = renderScreen();
    await settle();
    expect(screen.getByTestId("record-room").props.children).toBe("Room 205");
    expect(screen.getByTestId("record-notes-text").props.children).toBe("No additional notes recorded.");
  });
});

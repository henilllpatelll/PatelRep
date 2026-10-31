import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/assets", () => ({
  recordMeterReading: jest.fn(),
  listMeterReadings: jest.fn(),
  acknowledgePrediction: jest.fn(),
  createWorkOrderFromPrediction: jest.fn(),
}));
jest.mock("@/lib/api/workOrders", () => ({ createWorkOrder: jest.fn() }));

import * as assetsApi from "@/lib/api/assets";
import { createWorkOrder } from "@/lib/api/workOrders";
import CreateWorkOrderModal, { type LinkedAsset } from "@/components/engineering/CreateWorkOrderModal";
import { AssetReliabilityPanel } from "@/components/engineering/assets/AssetReliabilityPanel";
import { RecordReadingSheet } from "@/components/engineering/assets/RecordReadingSheet";
import { ReadingTrend } from "@/components/engineering/assets/ReadingTrend";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import type { AssetMeter } from "@/lib/engineering/assetReadings";

const api = assetsApi as unknown as Record<string, jest.Mock>;
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const meter: AssetMeter = { id: "m1", name: "Pressure", meter_type: "pressure", unit: "PSI", warning_high: 20, critical_high: 25 };
const noLimits: AssetMeter = { id: "m2", name: "Runtime", meter_type: "runtime_hours", unit: "hours" };

function sheet(over: Partial<React.ComponentProps<typeof RecordReadingSheet>> = {}) {
  const props = { visible: true, meters: [meter], isOnline: true, onClose: jest.fn(), onRecorded: jest.fn(), ...over };
  return { ...wrap(<RecordReadingSheet {...props} />), props };
}

beforeEach(() => jest.clearAllMocks());

describe("Record reading sheet", () => {
  it("won't send a missing, non-numeric, out-of-range or over-precise value", async () => {
    const { getByTestId, queryByTestId } = sheet();
    expect(getByTestId("reading-save").props.accessibilityState).toMatchObject({ disabled: true });
    for (const bad of ["abc", "1,5", "1e3", "2000000000", "1.1234567"]) {
      fireEvent.changeText(getByTestId("reading-value"), bad);
      expect(getByTestId("reading-value-error")).toBeTruthy();
      expect(getByTestId("reading-save").props.accessibilityState).toMatchObject({ disabled: true });
    }
    fireEvent.changeText(getByTestId("reading-value"), "18.5");
    expect(queryByTestId("reading-value-error")).toBeNull();
    expect(api.recordMeterReading).not.toHaveBeenCalled();
  });

  it("uses the meter's own unit and limits, and warns without ever calling a value safe", () => {
    const { getByTestId, getByLabelText } = sheet();
    expect(getByLabelText("Pressure, PSI")).toBeTruthy();
    fireEvent.changeText(getByTestId("reading-value"), "21");
    expect(getByTestId("reading-limit")).toHaveTextContent(/limit\.warning/);
    fireEvent.changeText(getByTestId("reading-value"), "30");
    expect(getByTestId("reading-limit")).toHaveTextContent(/limit\.critical/);
    fireEvent.changeText(getByTestId("reading-value"), "10");
    expect(() => getByTestId("reading-limit")).toThrow();
  });

  it("says a meter without limits won't be judged", () => {
    const { getByTestId } = sheet({ meters: [noLimits] });
    fireEvent.changeText(getByTestId("reading-value"), "4280");
    expect(getByTestId("reading-limit")).toHaveTextContent(/limit\.none/);
  });

  it("reports success only after the server confirmed, then closes", async () => {
    api.recordMeterReading.mockResolvedValue({ id: "r1", value: 18.5, recorded_at: iso(0) });
    const { getByTestId, props } = sheet();
    fireEvent.changeText(getByTestId("reading-value"), "18.5");
    fireEvent.changeText(getByTestId("reading-notes"), " after filter change ");
    fireEvent.press(getByTestId("reading-save"));
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    expect(api.recordMeterReading).toHaveBeenCalledWith("m1", { value: 18.5, notes: " after filter change " });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("sends once however many times Save is pressed", async () => {
    let finish!: (v: unknown) => void;
    api.recordMeterReading.mockImplementation(() => new Promise((res) => (finish = res)));
    const { getByTestId, props } = sheet();
    fireEvent.changeText(getByTestId("reading-value"), "5");
    fireEvent.press(getByTestId("reading-save"));
    fireEvent.press(getByTestId("reading-save"));
    fireEvent.press(getByTestId("reading-save"));
    expect(api.recordMeterReading).toHaveBeenCalledTimes(1);
    await act(async () => finish({ id: "r1", value: 5, recorded_at: iso(0) }));
    expect(props.onRecorded).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet open with the reason when the server rejects or refuses", async () => {
    api.recordMeterReading.mockRejectedValueOnce(apiError(422)).mockRejectedValueOnce(apiError(403));
    const { getByTestId, props } = sheet();
    fireEvent.changeText(getByTestId("reading-value"), "5");
    fireEvent.press(getByTestId("reading-save"));
    await waitFor(() => expect(getByTestId("reading-error")).toHaveTextContent(/rejected/));
    fireEvent.press(getByTestId("reading-save"));
    await waitFor(() => expect(getByTestId("reading-error")).toHaveTextContent(/forbidden/));
    expect(props.onRecorded).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("is unavailable offline: nothing is queued for later, because a replay could record twice", () => {
    const { getByTestId } = sheet({ isOnline: false });
    fireEvent.changeText(getByTestId("reading-value"), "5");
    expect(getByTestId("reading-offline")).toBeTruthy();
    expect(getByTestId("reading-save").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(getByTestId("reading-save"));
    expect(api.recordMeterReading).not.toHaveBeenCalled();
  });

  it("after an unanswered attempt, re-reads the meter before sending again so it can't record twice", async () => {
    api.recordMeterReading.mockRejectedValueOnce(new Error("Network request failed"));
    const { getByTestId, props } = sheet();
    fireEvent.changeText(getByTestId("reading-value"), "7");
    fireEvent.press(getByTestId("reading-save"));
    await waitFor(() => expect(getByTestId("reading-error")).toHaveTextContent(/unconfirmed/));

    // The first attempt had in fact landed.
    api.listMeterReadings.mockResolvedValue([{ id: "r-landed", value: 7, recorded_at: new Date().toISOString() }]);
    fireEvent.press(getByTestId("reading-save"));
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    expect(api.recordMeterReading).toHaveBeenCalledTimes(1);
    expect((props.onRecorded as jest.Mock).mock.calls[0][0].id).toBe("r-landed");
  });

  it("sends the retry only when the re-read shows the first attempt did not land", async () => {
    api.recordMeterReading.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce({ id: "r2", value: 7, recorded_at: iso(0) });
    api.listMeterReadings.mockResolvedValue([]);
    const { getByTestId, props } = sheet();
    fireEvent.changeText(getByTestId("reading-value"), "7");
    fireEvent.press(getByTestId("reading-save"));
    await waitFor(() => expect(getByTestId("reading-error")).toBeTruthy());
    fireEvent.press(getByTestId("reading-save"));
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    expect(api.recordMeterReading).toHaveBeenCalledTimes(2);
  });
});

describe("Reading trend", () => {
  const points = [100, 110, 130, 125, 150].map((value, i) => ({ at: `2026-10-0${i + 1}T12:00:00Z`, value }));

  it("draws from real points and carries a text alternative with the same facts", () => {
    const { getByTestId } = wrap(<ReadingTrend name="Runtime" unit="hours" points={points} language="en" timezone="America/Chicago" />);
    const chart = getByTestId("reading-trend");
    expect(chart.props.accessibilityLabel).toMatch(/assets\.readings\.trendSummary/);
    expect(chart.props.accessibilityLabel).toMatch(/count=5/);
    expect(chart.props.accessibilityLabel).toMatch(/unit=hours/);
  });

  it("draws nothing for fewer than two points", () => {
    const { queryByTestId } = wrap(<ReadingTrend name="Runtime" unit="hours" points={points.slice(0, 1)} language="en" timezone="America/Chicago" />);
    expect(queryByTestId("reading-trend")).toBeNull();
  });
});

const prediction = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  asset_id: "a1",
  risk_score: 82,
  recommendation: "Inspect the compressor",
  failure_indicators: ["Rising amperage", "Two repairs in 60 days"],
  generated_at: iso(-1),
  is_acknowledged: false,
  ...over,
});

describe("Reliability panel", () => {
  const panel = (predictions: unknown[], canAct = true) => {
    const onChanged = jest.fn();
    return { ...wrap(<AssetReliabilityPanel predictions={predictions as never} canAct={canAct} language="en" timezone="America/Chicago" onChanged={onChanged} />), onChanged };
  };

  it("renders nothing when there is no open signal", () => {
    expect(panel([]).toJSON()).toBeNull();
  });

  it("shows the model's own recommendation and indicators, labelled as a prediction, not a failure", () => {
    const { getByText, getByTestId } = panel([prediction()]);
    expect(getByText("Inspect the compressor")).toBeTruthy();
    expect(getByText("Rising amperage")).toBeTruthy();
    expect(getByTestId("asset-reliability-panel")).toHaveTextContent(/assets\.signals\.band\.high/);
    expect(getByTestId("asset-reliability-panel")).toHaveTextContent(/assets\.signals\.disclaimer/);
    expect(getByTestId("asset-reliability-panel")).not.toHaveTextContent(/confidence|%/i);
  });

  it("flags an old signal with its age", () => {
    const { getByTestId } = panel([prediction({ generated_at: iso(-30) })]);
    expect(getByTestId("asset-reliability-panel")).toHaveTextContent(/assets\.signals\.stale:count=30/);
  });

  it("creates one work order however many taps, then acknowledges so it can't be created twice", async () => {
    let finish!: () => void;
    api.createWorkOrderFromPrediction.mockImplementation(() => new Promise<void>((res) => (finish = res)));
    api.acknowledgePrediction.mockResolvedValue(undefined);
    const { getByTestId, onChanged } = panel([prediction({ id: "p-once" })]);
    fireEvent.press(getByTestId("asset-signal-create"));
    fireEvent.press(getByTestId("asset-signal-create"));
    fireEvent.press(getByTestId("asset-signal-create"));
    expect(api.createWorkOrderFromPrediction).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(api.acknowledgePrediction).toHaveBeenCalledWith("p-once");
    expect(getByTestId("asset-signal-create").props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("changes nothing and says so when creating fails", async () => {
    api.createWorkOrderFromPrediction.mockRejectedValue(apiError(500));
    const { getByTestId, onChanged } = panel([prediction({ id: "p-fail" })]);
    fireEvent.press(getByTestId("asset-signal-create"));
    await waitFor(() => expect(getByTestId("asset-signal-create").props.accessibilityState).toMatchObject({ disabled: false }));
    expect(api.acknowledgePrediction).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("acknowledges without creating anything", async () => {
    api.acknowledgePrediction.mockResolvedValue(undefined);
    const { getByTestId, onChanged } = panel([prediction({ id: "p-ack" })]);
    fireEvent.press(getByTestId("asset-signal-ack"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.createWorkOrderFromPrediction).not.toHaveBeenCalled();
  });

  it("offers no actions to a role that may not act on signals", () => {
    const { queryByTestId, getByTestId } = panel([prediction()], false);
    expect(getByTestId("asset-reliability-panel")).toBeTruthy();
    expect(queryByTestId("asset-signal-create")).toBeNull();
    expect(queryByTestId("asset-signal-ack")).toBeNull();
  });
});

describe("Create work order from equipment", () => {
  const linked: LinkedAsset = { id: "a1", name: "PTAC Unit", locationText: "Hall", categoryCode: "HVAC", roomId: "r312", roomNumber: "312" };
  const open = (asset?: LinkedAsset | null, extra: Record<string, unknown> = {}) =>
    wrap(<CreateWorkOrderModal visible onClose={jest.fn()} asset={asset} {...extra} />);
  const fill = (screen: ReturnType<typeof open>) => fireEvent.changeText(screen.getByPlaceholderText("workOrders.whatNeedsFixing"), "No cooling");

  it("sends the canonical asset id, room and a request key, with the category matched but never the issue prefilled", async () => {
    (createWorkOrder as jest.Mock).mockResolvedValue("wo-1");
    const screen = open(linked);
    expect(screen.getByTestId("create-wo-asset")).toBeTruthy();
    expect(screen.getByPlaceholderText("workOrders.whatNeedsFixing").props.value).toBe("");
    fill(screen);
    fireEvent.press(screen.getByText("Create Work Order"));
    await waitFor(() => expect(createWorkOrder).toHaveBeenCalledTimes(1));
    const body = (createWorkOrder as jest.Mock).mock.calls[0][0];
    expect(body).toMatchObject({ asset_id: "a1", room_id: "r312", category: "hvac", title: "No cooling" });
    expect(body.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty("room_unavailability");
  });

  it("reuses the same request key when the first attempt gets no answer, so a retry can't duplicate", async () => {
    (createWorkOrder as jest.Mock).mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce("wo-1");
    const screen = open(linked);
    fill(screen);
    fireEvent.press(screen.getByText("Create Work Order"));
    await waitFor(() => expect(createWorkOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((createWorkOrder as jest.Mock).mock.calls.length).toBe(1));
    fireEvent.press(screen.getByText("Create Work Order"));
    await waitFor(() => expect(createWorkOrder).toHaveBeenCalledTimes(2));
    const [first, second] = (createWorkOrder as jest.Mock).mock.calls.map((c) => c[0].client_request_id);
    expect(first).toBe(second);
  });

  it("without equipment it behaves exactly as before: no asset id", async () => {
    (createWorkOrder as jest.Mock).mockResolvedValue("wo-2");
    const screen = open(null, { roomId: "r9", roomNumber: "9" });
    fill(screen);
    fireEvent.press(screen.getByText("Create Work Order"));
    await waitFor(() => expect(createWorkOrder).toHaveBeenCalled());
    const body = (createWorkOrder as jest.Mock).mock.calls[0][0];
    expect(body).toMatchObject({ room_id: "r9" });
    expect(body).not.toHaveProperty("asset_id");
  });

  it("does not pre-select a category the work order list doesn't have", async () => {
    (createWorkOrder as jest.Mock).mockResolvedValue("wo-3");
    const screen = open({ ...linked, categoryCode: "ELEV", roomId: null, roomNumber: null });
    fill(screen);
    fireEvent.press(screen.getByText("Create Work Order"));
    await waitFor(() => expect(createWorkOrder).toHaveBeenCalled());
    expect((createWorkOrder as jest.Mock).mock.calls[0][0]).toMatchObject({ category: "general", asset_id: "a1" });
  });
});

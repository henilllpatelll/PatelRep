import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/assets", () => ({ startAssetDowntime: jest.fn(), restoreAssetDowntime: jest.fn() }));

import * as assetsApi from "@/lib/api/assets";
import { DowntimeSheet } from "@/components/engineering/assets/DowntimeSheet";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";

const api = assetsApi as unknown as Record<string, jest.Mock>;
const wrap = (node: React.ReactElement) => render(<ThemeProvider><ToastProvider>{node}</ToastProvider></ThemeProvider>);
const open = { id: "dt1", started_at: "2026-11-01T15:00:00Z", impact_level: "out_of_service" };

function sheet(activeDowntime: typeof open | null, over: Partial<React.ComponentProps<typeof DowntimeSheet>> = {}) {
  const props = { visible: true, asset: { id: "a1", name: "Boiler", activeDowntime }, timezone: "America/Chicago", language: "en", isOnline: true, onClose: jest.fn(), onDone: jest.fn(), onNeedsRefresh: jest.fn(), ...over };
  return { ...wrap(<DowntimeSheet {...props} />), props };
}

beforeEach(() => jest.clearAllMocks());

describe("Downtime sheet", () => {
  it("starting sends the chosen condition and type, with no client-side timestamp, and says it does not touch rooms", async () => {
    api.startAssetDowntime.mockResolvedValue({ created: true, period: open });
    const { getByTestId, getByText, props } = sheet(null);
    expect(getByText("assets.downtime.startScope")).toBeTruthy();
    fireEvent.press(getByTestId("asset-downtime-impact-degraded"));
    fireEvent.press(getByTestId("asset-downtime-kind-planned"));
    fireEvent.changeText(getByTestId("asset-downtime-notes"), "  Replacing the pump  ");
    fireEvent.press(getByTestId("asset-downtime-submit"));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("started"));
    expect(api.startAssetDowntime).toHaveBeenCalledWith("a1", { downtimeType: "planned", impactLevel: "degraded", notes: "  Replacing the pump  ", workOrderId: null });
    expect(api.restoreAssetDowntime).not.toHaveBeenCalled();
  });

  it("an optional linked repair travels as its id; choosing none sends no link", async () => {
    api.startAssetDowntime.mockResolvedValue({ created: true, period: open });
    const { getByTestId, props } = sheet(null, { repairs: [{ id: "wo9", label: "WO-9" }] });
    fireEvent.press(getByTestId("asset-downtime-repair-wo9"));
    fireEvent.press(getByTestId("asset-downtime-submit"));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("started"));
    expect(api.startAssetDowntime).toHaveBeenCalledWith("a1", expect.objectContaining({ workOrderId: "wo9" }));
  });

  it("an already-open period is reported as such, not as a new record", async () => {
    api.startAssetDowntime.mockResolvedValue({ created: false, period: open });
    const { getByTestId, props } = sheet(null);
    fireEvent.press(getByTestId("asset-downtime-submit"));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("already_open"));
  });

  it("ending targets the open period and offers no start fields", async () => {
    api.restoreAssetDowntime.mockResolvedValue({ restored: true, period: open });
    const { getByTestId, getByText, queryByTestId, props } = sheet(open);
    expect(queryByTestId("asset-downtime-impact-degraded")).toBeNull();
    expect(getByText("assets.downtime.endScope")).toBeTruthy();
    fireEvent.press(getByTestId("asset-downtime-submit"));
    await waitFor(() => expect(props.onDone).toHaveBeenCalledWith("ended"));
    expect(api.restoreAssetDowntime).toHaveBeenCalledWith("a1", "dt1", "");
    expect(api.startAssetDowntime).not.toHaveBeenCalled();
  });

  it("a double tap sends one request", async () => {
    let release: (v: unknown) => void = () => undefined;
    api.restoreAssetDowntime.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { getByTestId } = sheet(open);
    fireEvent.press(getByTestId("asset-downtime-submit"));
    fireEvent.press(getByTestId("asset-downtime-submit"));
    expect(api.restoreAssetDowntime).toHaveBeenCalledTimes(1);
    release({ restored: true, period: open });
  });

  it("a failure is explained and nothing is reported as done; offline cannot submit", async () => {
    api.startAssetDowntime.mockRejectedValue(Object.assign(new Error("Network request failed")));
    const { getByTestId, getByText, props } = sheet(null);
    fireEvent.press(getByTestId("asset-downtime-submit"));
    await waitFor(() => expect(getByText("pmMgmt.failure.unconfirmed")).toBeTruthy());
    expect(props.onDone).not.toHaveBeenCalled();
    const offline = sheet(null, { isOnline: false });
    expect(offline.getAllByTestId("asset-downtime-submit")[0].props.accessibilityState).toMatchObject({ disabled: true });
  });
});

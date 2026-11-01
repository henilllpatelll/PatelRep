import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/housekeeping/roomDetail/BottomSheet", () => {
  const { View } = require("react-native");
  return {
    MAX_FONT_SCALE: 1.6,
    BottomSheet: ({ visible, children, footer }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
      visible ? (
        <View>
          {children}
          {footer}
        </View>
      ) : null,
  };
});
jest.mock("@/lib/api/repairAssist", () => ({ requestRepairAssist: jest.fn() }));

import { requestRepairAssist } from "@/lib/api/repairAssist";
import { RepairAssistSheet } from "@/components/engineering/workorder/RepairAssistSheet";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const ask = requestRepairAssist as jest.Mock;
const facts = {
  work_order: { number: 1042, title: "PTAC not cooling", category: "hvac", priority: "urgent", status: "in_progress", room: "312" },
  asset: { name: "PTAC Unit 312", tag: "PT-312", manufacturer: null, category: null, location: null },
  previous_repairs: [] as { work_order_number: number; title: string; completed_at: string }[],
  pm_results_count: 0,
  has_asset: true,
  manuals_consulted: false,
};
const suggestion = (over = {}) => ({ summary: "No cooling.", checks: ["Check the filter"], needs_info: ["Setpoint?"], safety: ["Lock out power"], uncertainty: "Low confidence.", answer: "", draft_notes: "", ...over });

function renderSheet(over: Partial<React.ComponentProps<typeof RepairAssistSheet>> = {}) {
  const props = {
    visible: true, onClose: jest.fn(), workOrderId: "wo-1", online: true, language: "en" as const, technicianNotes: "Cleaned coil",
    onUseInCompletion: jest.fn(), onSaveAsNote: jest.fn().mockResolvedValue(undefined), ...over,
  };
  const utils = render(
    <ThemeProvider>
      <RepairAssistSheet {...props} />
    </ThemeProvider>,
  );
  return { ...utils, props };
}

beforeEach(() => jest.clearAllMocks());

describe("AI repair assist sheet", () => {
  it("makes no request (and so no charge) until the technician asks", () => {
    const { getByTestId, queryByTestId } = renderSheet();
    expect(ask).not.toHaveBeenCalled();
    expect(queryByTestId("assist-suggestion")).toBeNull();
    expect(getByTestId("assist-get")).toBeTruthy();
  });

  it("shows suggestions under an AI label, apart from the records, and states what is missing", async () => {
    ask.mockResolvedValueOnce({ mode: "suggest", facts, suggestion: suggestion() });
    const { getByTestId, getByText } = renderSheet();
    await act(async () => {
      fireEvent.press(getByTestId("assist-get"));
    });
    await waitFor(() => expect(getByTestId("assist-suggestion")).toBeTruthy());
    expect(ask).toHaveBeenCalledWith("wo-1", expect.objectContaining({ mode: "suggest", technicianNotes: "Cleaned coil" }), expect.anything());
    expect(getByText("repairAssist.aiSuggestion")).toBeTruthy();
    expect(getByText("repairAssist.fromRecords")).toBeTruthy();
    expect(getByTestId("assist-no-history")).toBeTruthy();
    expect(getByTestId("assist-no-manuals")).toBeTruthy();
    expect(getByTestId("assist-safety")).toBeTruthy();
  });

  it("says plainly when no equipment is linked", async () => {
    ask.mockResolvedValueOnce({ mode: "suggest", facts: { ...facts, asset: null, has_asset: false }, suggestion: suggestion() });
    const { getByTestId, queryByTestId } = renderSheet();
    await act(async () => {
      fireEvent.press(getByTestId("assist-get"));
    });
    await waitFor(() => expect(getByTestId("assist-asset-line")).toBeTruthy());
    expect(queryByTestId("assist-no-history")).toBeNull();
  });

  it("an unavailable service shows a message and no answer, and repairs are not blocked", async () => {
    ask.mockRejectedValueOnce(Object.assign(new Error("HTTP 503"), { status: 503 }));
    const { getByTestId, queryByTestId, props } = renderSheet();
    await act(async () => {
      fireEvent.press(getByTestId("assist-get"));
    });
    await waitFor(() => expect(getByTestId("assist-error")).toBeTruthy());
    expect(queryByTestId("assist-suggestion")).toBeNull();
    expect(props.onUseInCompletion).not.toHaveBeenCalled();
    expect(props.onSaveAsNote).not.toHaveBeenCalled();
  });

  it("a draft is editable text and nothing is saved until an explicit tap", async () => {
    ask.mockResolvedValueOnce({ mode: "suggest", facts, suggestion: suggestion() });
    ask.mockResolvedValueOnce({ mode: "draft_notes", facts, suggestion: suggestion({ draft_notes: "Cleaned coil. [add detail]" }) });
    const { getByTestId, props } = renderSheet();
    await act(async () => {
      fireEvent.press(getByTestId("assist-get"));
    });
    await waitFor(() => expect(getByTestId("assist-draft")).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId("assist-draft"));
    });
    await waitFor(() => expect(getByTestId("assist-draft-input").props.value).toBe("Cleaned coil. [add detail]"));
    expect(props.onUseInCompletion).not.toHaveBeenCalled();
    expect(props.onSaveAsNote).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId("assist-draft-input"), "Cleaned coil and replaced filter.");
    fireEvent.press(getByTestId("assist-use-draft"));
    expect(props.onUseInCompletion).toHaveBeenCalledWith("Cleaned coil and replaced filter.");
    expect(props.onSaveAsNote).not.toHaveBeenCalled();
  });

  it("saves a draft as a note only on the explicit save tap, and surfaces a failed save", async () => {
    ask.mockResolvedValueOnce({ mode: "suggest", facts, suggestion: suggestion() });
    ask.mockResolvedValueOnce({ mode: "draft_notes", facts, suggestion: suggestion({ draft_notes: "Draft text" }) });
    const { getByTestId, props, findByText } = renderSheet({ onSaveAsNote: jest.fn().mockRejectedValue(new Error("Could not store the note")) });
    await act(async () => {
      fireEvent.press(getByTestId("assist-get"));
    });
    await act(async () => {
      fireEvent.press(await findByTestId(getByTestId, "assist-draft"));
    });
    await waitFor(() => expect(getByTestId("assist-save-note")).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId("assist-save-note"));
    });
    expect(props.onSaveAsNote).toHaveBeenCalledWith("Draft text");
    expect(await findByText("Could not store the note")).toBeTruthy();
    expect(getByTestId("assist-draft-input").props.value).toBe("Draft text"); // the draft is kept after a failed save
  });

  it("cannot ask while offline", () => {
    const { getByTestId } = renderSheet({ online: false });
    expect(getByTestId("assist-get").props.accessibilityState?.disabled).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});

async function findByTestId(getByTestId: (id: string) => unknown, id: string) {
  await waitFor(() => expect(getByTestId(id)).toBeTruthy());
  return getByTestId(id) as never;
}

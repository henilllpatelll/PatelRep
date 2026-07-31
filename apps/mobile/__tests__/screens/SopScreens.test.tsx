import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

let mockSopId = "sop-1";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ sopId: mockSopId }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/lib/api/sop", () => ({
  listDocuments: jest.fn(),
  getDocument: jest.fn(),
}));

import { getDocument, listDocuments } from "@/lib/api/sop";
import { router } from "expo-router";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import SopLibraryScreen from "@/app/(app)/sop/index";
import SopDetailScreen from "@/app/(app)/sop/[sopId]";

const mockListDocuments = listDocuments as jest.Mock;
const mockGetDocument = getDocument as jest.Mock;

const documentFixture = {
  id: "sop-1",
  title: "Night audit checklist",
  description: "Close the business day and verify the ledger.",
  category: "Front Desk",
  page_count: 3,
  indexing_status: "indexed" as const,
  created_at: "2026-07-30T12:00:00.000Z",
};

function renderWithTheme(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSopId = "sop-1";
  mockListDocuments.mockResolvedValue({ data: [documentFixture] });
  mockGetDocument.mockResolvedValue({ data: documentFixture });
});

describe("SOP screens", () => {
  it("loads the SOP list and keeps document rows navigable to the existing detail route", async () => {
    const { getByRole, getByText } = renderWithTheme(<SopLibraryScreen />);

    await waitFor(() => expect(getByText("Night audit checklist")).toBeTruthy());
    expect(mockListDocuments).toHaveBeenCalledTimes(1);

    fireEvent.press(getByRole("button", { name: "Night audit checklist" }));
    expect(router.push).toHaveBeenCalledWith("/(app)/sop/sop-1");
  });

  it("loads the route SOP and exposes the existing AI affordance as a button", async () => {
    mockSopId = "sop-42";
    const { getAllByText, getByRole } = renderWithTheme(<SopDetailScreen />);

    await waitFor(() => expect(getAllByText("Night audit checklist").length).toBeGreaterThan(0));
    expect(mockGetDocument).toHaveBeenCalledWith("sop-42");
    expect(getByRole("button", { name: "Ask about this SOP" })).toBeTruthy();
  });
});

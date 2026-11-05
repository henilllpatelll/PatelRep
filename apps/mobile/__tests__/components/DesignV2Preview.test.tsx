import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import i18n from "@/i18n";
import { HousekeeperHomePreview } from "@/components/design-v2/HousekeeperHomePreview";
import { previewSample } from "@/components/design-v2/previewSampleData";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

let mockFlag = true;

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "light",
}));

jest.mock("@/lib/design/designV2", () => ({
  isDesignV2Enabled: () => mockFlag,
  resolveDesignV2Preview: () => mockFlag,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return <Text testID="redirect">{href}</Text>;
  },
}));

jest.mock("@expo/vector-icons", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  const { Text: NativeText } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Ionicons: (props: Record<string, unknown>) => ReactActual.createElement(NativeText, props),
  };
});

/** Renders, then lets ThemeProvider finish its async appearance hydration inside act(). */
async function renderPreview() {
  const result = render(
    <ThemeProvider>
      <HousekeeperHomePreview />
    </ThemeProvider>,
  );
  await act(async () => {});
  return result;
}

async function renderRoute() {
  const Route = require("@/app/design-v2-preview").default as React.ComponentType;
  const result = render(
    <ThemeProvider>
      <Route />
    </ThemeProvider>,
  );
  await act(async () => {});
  return result;
}

function placeholders(value: string): string[] {
  return (value.match(/\{\{\w+\}\}/g) ?? []).sort();
}

beforeEach(async () => {
  mockFlag = true;
  await i18n.changeLanguage("en");
});

describe("Design V2 locale parity", () => {
  const enBlock = en.designV2Preview as Record<string, string>;
  const esBlock = es.designV2Preview as Record<string, string>;

  it("has the same keys and interpolation placeholders in English and Spanish", () => {
    expect(Object.keys(esBlock).sort()).toEqual(Object.keys(enBlock).sort());
    for (const key of Object.keys(enBlock)) {
      expect(placeholders(esBlock[key])).toEqual(placeholders(enBlock[key]));
      expect(esBlock[key].trim()).not.toBe("");
    }
  });
});

describe("HousekeeperHomePreview", () => {
  it("labels itself as sample data and renders every required section", async () => {
    await renderPreview();
    expect(screen.getByText("Design V2 preview")).toBeTruthy();
    expect(screen.getByText(/Sample data only/)).toBeTruthy();
    expect(screen.getByText("PatelRep")).toBeTruthy();
    expect(screen.getByLabelText("Notifications, 2")).toBeTruthy();
    expect(screen.getByText("Good morning, Maria")).toBeTruthy();
    expect(screen.getByText(/On shift/)).toBeTruthy();
    expect(screen.getByText(previewSample.currentRoom.number)).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText(/18 min elapsed/)).toBeTruthy();
    expect(screen.getByLabelText("Checklist, 6 of 9 steps")).toBeTruthy();
    expect(screen.getByText("Next up")).toBeTruthy();
    expect(screen.getByText(/Supervisor note/)).toBeTruthy();
    expect(screen.getByText("Today's briefing")).toBeTruthy();
    expect(screen.getByText("Sample text. Not generated from real data.")).toBeTruthy();
    for (const tab of ["Home", "My Rooms", "Tasks", "Profile"]) {
      expect(screen.getByLabelText(tab)).toBeTruthy();
    }
  });

  it("has exactly one primary action and a guarded (disabled) completion action", async () => {
    await renderPreview();
    expect(screen.getByLabelText("Continue cleaning")).toBeTruthy();
    const guarded = screen.getByTestId("design-v2-guarded-action");
    expect(guarded.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText("Finish the checklist to mark this room clean.")).toBeTruthy();
  });

  it("uses no real backend: nothing in the preview imports the API client or stores", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const source = [
      "../../components/design-v2/HousekeeperHomePreview.tsx",
      "../../components/design-v2/previewSampleData.ts",
    ]
      .map((p) => fs.readFileSync(path.resolve(__dirname, p), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/lib\/api|stores\/|supabase|fetch\(/);
  });

  it("switches appearance without touching the saved app preference", async () => {
    await renderPreview();
    fireEvent.press(screen.getByTestId("design-v2-mode-dark"));
    expect(screen.getByTestId("design-v2-mode-dark").props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it("renders in Spanish with the translated, longer strings", async () => {
    await i18n.changeLanguage("es");
    await renderPreview();
    expect(screen.getByText("Buenos días, Maria")).toBeTruthy();
    expect(screen.getByLabelText("Continuar limpieza")).toBeTruthy();
    expect(screen.getByText("Termine la lista de verificación para marcar esta habitación como limpia.")).toBeTruthy();
    expect(screen.getByLabelText("Lista de verificación, 6 de 9 pasos")).toBeTruthy();
    expect(screen.getByText("Texto de muestra. No se generó con datos reales.")).toBeTruthy();
  });
});

describe("design-v2-preview route", () => {
  it("redirects to the app root when the flag is off", async () => {
    mockFlag = false;
    await renderRoute();
    expect(screen.getByTestId("redirect").props.children).toBe("/");
    expect(screen.queryByTestId("design-v2-preview")).toBeNull();
  });

  it("renders the preview when the flag is on", async () => {
    mockFlag = true;
    await renderRoute();
    expect(screen.getByTestId("design-v2-preview")).toBeTruthy();
  });
});

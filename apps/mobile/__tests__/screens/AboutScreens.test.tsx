import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { makeAppStoreMock as mockMakeAppStore } from "../helpers/appStoreMock";
import { getThemeTokens } from "@/components/shared/tokens";

let mockLanguage: "en" | "es" = "en";
let mockMode: "light" | "dark" = "light";
let mockOnline = true;
let mockInfo = { name: "PatelRep", version: "2.1.0" as string | null, build: "45" as string | null, updateId: null as string | null };
let mockLegal: { privacyPolicyUrl?: string; termsOfServiceUrl?: string } = {};
let mockNotes: import("@/lib/app/releaseNotes").ReleaseNote[] = [];
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage), i18n: { language: mockLanguage } }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require("react-native");
    return <Text testID={`icon-${name}`}>{name}</Text>;
  },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock("@/lib/theme/ThemeProvider", () => ({ useThemeMode: () => mockMode }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: () => mockBack(), canGoBack: () => true },
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { legal: mockLegal } };
    },
  },
}));
jest.mock("@/lib/app/appInfo", () => ({
  ...jest.requireActual("@/lib/app/appInfo"),
  getAppInfo: () => mockInfo,
}));
jest.mock("@/lib/app/releaseNotes", () => {
  const actual = jest.requireActual("@/lib/app/releaseNotes");
  return { ...actual, findReleaseNotes: (version: string | null) => actual.findReleaseNotes(version, mockNotes) };
});
jest.mock("@/stores/appStore", () => ({ useAppStore: mockMakeAppStore(() => ({ isOnline: mockOnline })) }));

import AboutScreen from "@/app/(app)/profile/about";
import WhatsNewScreen from "@/app/(app)/profile/whats-new";
import LicensesScreen from "@/app/(app)/profile/licenses";

const NOTES = {
  version: "2.1.0",
  date: "2026-11-02",
  features: [{ en: "Report a problem from Settings", es: "Reporta un problema desde Ajustes" }],
  improvements: [{ en: "Settings is easier to read", es: "Ajustes es más fácil de leer" }],
};

beforeEach(() => {
  mockLanguage = "en";
  mockMode = "light";
  mockOnline = true;
  mockInfo = { name: "PatelRep", version: "2.1.0", build: "45", updateId: null };
  mockLegal = {};
  mockNotes = [];
  jest.clearAllMocks();
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

const text = (node: { props: { children?: unknown } }) => String(node.props.children);

describe("About PatelRep", () => {
  it("shows the app name, the product line and the installed version and build", () => {
    const { getByTestId, getByText } = render(<AboutScreen />);
    expect(getByTestId("about-name").props.children).toBe("PatelRep");
    expect(getByText("Property operations, simplified.")).toBeTruthy();
    expect(getByTestId("about-version-line").props.children).toBe("Version 2.1.0");
    expect(getByTestId("about-version-value").props.children).toBe("2.1.0");
    expect(getByTestId("about-build-value").props.children).toBe("45");
    expect(getByTestId("settings-title").props.children).toBe("About PatelRep");
  });

  it("falls back to Unavailable for a version it cannot read, and hides a build it does not have", () => {
    mockInfo = { ...mockInfo, version: null, build: null };
    const { getByTestId, queryByTestId } = render(<AboutScreen />);
    expect(getByTestId("about-version-value").props.children).toBe("Unavailable");
    expect(getByTestId("about-version-line").props.children).toBe("Unavailable");
    expect(queryByTestId("about-build")).toBeNull();
  });

  it("shows a short update id only when a downloaded update is running", () => {
    const none = render(<AboutScreen />);
    expect(none.queryByTestId("about-update-id")).toBeNull();
    none.unmount();
    mockInfo = { ...mockInfo, updateId: "0a1b2c3d-1111-2222-3333-444455556666" };
    const some = render(<AboutScreen />);
    expect(some.getByTestId("about-update-id-value").props.children).toBe("0a1b2c3d");
    // The update id never replaces or alters the version.
    expect(some.getByTestId("about-version-value").props.children).toBe("2.1.0");
  });

  it("offers no update check, because no update channel is published", () => {
    const { queryByText } = render(<AboutScreen />);
    expect(queryByText(/check for updates/i)).toBeNull();
    expect(queryByText(/up to date/i)).toBeNull();
  });

  it("goes back from the header", () => {
    const { getByTestId } = render(<AboutScreen />);
    fireEvent.press(getByTestId("settings-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("sends Contact Support to the existing Help & Support screen", () => {
    const { getByTestId } = render(<AboutScreen />);
    fireEvent.press(getByTestId("row-contact-support"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/help");
  });

  it("opens the bundled licenses screen", () => {
    const { getByTestId } = render(<AboutScreen />);
    fireEvent.press(getByTestId("row-licenses"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/licenses");
  });

  describe("What's New row", () => {
    it("is hidden when the installed version has no release notes, so there is no dead link", () => {
      const { queryByTestId } = render(<AboutScreen />);
      expect(queryByTestId("row-whats-new")).toBeNull();
    });

    it("is hidden when notes exist only for a different version", () => {
      mockNotes = [{ ...NOTES, version: "9.9.9" }];
      const { queryByTestId } = render(<AboutScreen />);
      expect(queryByTestId("row-whats-new")).toBeNull();
    });

    it("appears and opens What's New when the installed version has notes", () => {
      mockNotes = [NOTES];
      const { getByTestId } = render(<AboutScreen />);
      expect(getByTestId("row-whats-new").props.accessibilityLabel).toBe("What’s New, Changes in version 2.1.0");
      fireEvent.press(getByTestId("row-whats-new"));
      expect(mockPush).toHaveBeenCalledWith("/(app)/profile/whats-new");
    });
  });

  describe("Privacy Policy and Terms of Service", () => {
    it("shows neither row while no real address is configured", () => {
      const { queryByTestId } = render(<AboutScreen />);
      expect(queryByTestId("row-privacy")).toBeNull();
      expect(queryByTestId("row-terms")).toBeNull();
    });

    it("never shows a row for an address that is not a safe https link", () => {
      mockLegal = { privacyPolicyUrl: "patelrep://profile/security", termsOfServiceUrl: "http://example.com/terms" };
      const { queryByTestId } = render(<AboutScreen />);
      expect(queryByTestId("row-privacy")).toBeNull();
      expect(queryByTestId("row-terms")).toBeNull();
    });

    it("opens the configured addresses in the browser", async () => {
      mockLegal = { privacyPolicyUrl: "https://example.com/privacy", termsOfServiceUrl: "https://example.com/terms" };
      const { getByTestId } = render(<AboutScreen />);
      expect(getByTestId("row-privacy").props.accessibilityLabel).toContain("Privacy Policy");
      await act(async () => {
        fireEvent.press(getByTestId("row-privacy"));
      });
      expect(Linking.openURL).toHaveBeenCalledWith("https://example.com/privacy");
      await act(async () => {
        fireEvent.press(getByTestId("row-terms"));
      });
      expect(Linking.openURL).toHaveBeenLastCalledWith("https://example.com/terms");
    });

    it("explains that it needs a connection instead of opening anything while offline", async () => {
      mockLegal = { privacyPolicyUrl: "https://example.com/privacy" };
      mockOnline = false;
      const { getByTestId } = render(<AboutScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("row-privacy"));
      });
      expect(Linking.openURL).not.toHaveBeenCalled();
      expect(text(getByTestId("about-link-error").findByProps({ children: "You’re offline. Connect to the internet to open the Privacy Policy." }))).toContain("offline");
    });

    it("reports a link that fails to open, offers Retry, and clears the error once it opens", async () => {
      mockLegal = { termsOfServiceUrl: "https://example.com/terms" };
      (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error("no browser"));
      const { getByTestId, queryByTestId, getByText } = render(<AboutScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("row-terms"));
      });
      expect(getByText("We couldn’t open the Terms of Service. Try again.")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("about-link-retry"));
      });
      expect(Linking.openURL).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(queryByTestId("about-link-error")).toBeNull());
    });

    it("ignores a second tap while a link is still opening", async () => {
      mockLegal = { privacyPolicyUrl: "https://example.com/privacy" };
      let finish: (v: boolean) => void = () => undefined;
      (Linking.openURL as jest.Mock).mockReturnValueOnce(new Promise<boolean>((resolve) => (finish = resolve)));
      const { getByTestId } = render(<AboutScreen />);
      await act(async () => {
        fireEvent.press(getByTestId("row-privacy"));
        fireEvent.press(getByTestId("row-privacy"));
      });
      expect(Linking.openURL).toHaveBeenCalledTimes(1);
      await act(async () => finish(true));
    });
  });

  describe("language and theme", () => {
    it("renders in Spanish", () => {
      mockLanguage = "es";
      mockNotes = [NOTES];
      const { getByText, getByTestId } = render(<AboutScreen />);
      expect(getByTestId("settings-title").props.children).toBe("Acerca de PatelRep");
      expect(getByText("Operaciones del hotel, simplificadas.")).toBeTruthy();
      expect(getByTestId("about-version-line").props.children).toBe("Versión 2.1.0");
      expect(getByText("Número de compilación")).toBeTruthy();
      expect(getByText("Contactar con soporte")).toBeTruthy();
      expect(getByTestId("row-whats-new").props.accessibilityLabel).toBe("Novedades, Cambios de la versión 2.1.0");
      expect(getByTestId("row-licenses").props.accessibilityLabel).toContain("Licencias de código abierto");
    });

    it("uses the dark palette in dark mode and the light one in light mode", () => {
      const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));
      const light = render(<AboutScreen />);
      expect(flat(light.getByTestId("settings-title")).color).toBe(getThemeTokens("light").textPrimary);
      light.unmount();
      mockMode = "dark";
      const dark = render(<AboutScreen />);
      expect(flat(dark.getByTestId("settings-title")).color).toBe(getThemeTokens("dark").textPrimary);
      expect(getThemeTokens("dark").textPrimary).not.toBe(getThemeTokens("light").textPrimary);
    });

    it("does not clip the longer Spanish labels: every label wraps and caps font scaling", () => {
      mockLanguage = "es";
      mockLegal = { privacyPolicyUrl: "https://example.com/p", termsOfServiceUrl: "https://example.com/t" };
      const { UNSAFE_getAllByType } = render(<AboutScreen />);
      const { Text } = require("react-native");
      const texts = UNSAFE_getAllByType(Text);
      expect(texts.length).toBeGreaterThan(8);
      // Content wraps; only the header title is limited, and to two lines rather than one.
      for (const node of texts) {
        if (node.props.testID === "settings-title") expect(node.props.numberOfLines).toBe(2);
        else expect(node.props.numberOfLines).toBeUndefined();
      }
    });
  });

  it("is the same for all six roles: it reads no role and exposes no administrative route", () => {
    for (const _role of ["housekeeper", "inspector", "engineer", "housekeeping_supervisor", "front_desk", "gm"]) {
      mockPush.mockClear();
      const { getAllByRole, unmount } = render(<AboutScreen />);
      const destinations = getAllByRole("button").length;
      expect(destinations).toBeGreaterThan(0);
      unmount();
    }
    const source = require("fs").readFileSync(require("path").join(__dirname, "../../app/(app)/profile/about.tsx"), "utf8");
    expect(source).not.toMatch(/effective_role|.role|useRole|property-admin/i);
  });
});

describe("What's New", () => {
  it("shows the verified notes for the installed version, grouped, with the version and date", () => {
    mockNotes = [NOTES];
    const { getByTestId, getByText, queryByTestId } = render(<WhatsNewScreen />);
    expect(getByTestId("settings-title").props.children).toBe("What’s New");
    expect(getByText("What’s New in PatelRep")).toBeTruthy();
    expect(text(getByTestId("whats-new-version"))).toContain("Version 2.1.0");
    expect(text(getByTestId("whats-new-version"))).toContain("November 2, 2026");
    expect(getByText("New features")).toBeTruthy();
    expect(getByText("Report a problem from Settings")).toBeTruthy();
    expect(getByText("Improvements")).toBeTruthy();
    // A section with no lines is not shown at all.
    expect(queryByTestId("whats-new-fixes")).toBeNull();
    expect(queryByTestId("whats-new-empty")).toBeNull();
  });

  it("shows the notes in Spanish", () => {
    mockLanguage = "es";
    mockNotes = [NOTES];
    const { getByText } = render(<WhatsNewScreen />);
    expect(getByText("Novedades de PatelRep")).toBeTruthy();
    expect(getByText("Nuevas funciones")).toBeTruthy();
    expect(getByText("Reporta un problema desde Ajustes")).toBeTruthy();
  });

  it("says plainly that notes are not available instead of inventing any", () => {
    const { getByText, getByTestId, queryByTestId } = render(<WhatsNewScreen />);
    expect(getByText("Release notes aren’t available for this version.")).toBeTruthy();
    expect(getByTestId("whats-new-empty")).toBeTruthy();
    expect(queryByTestId("whats-new-notes")).toBeNull();
  });

  it("does not show another version's notes", () => {
    mockNotes = [{ ...NOTES, version: "1.0.0" }];
    const { getByTestId, queryByTestId } = render(<WhatsNewScreen />);
    expect(getByTestId("whats-new-empty")).toBeTruthy();
    expect(queryByTestId("whats-new-notes")).toBeNull();
  });

  it("does not show an invalid date", () => {
    mockNotes = [{ ...NOTES, date: "2026-99-99" }];
    const { getByTestId } = render(<WhatsNewScreen />);
    expect(text(getByTestId("whats-new-version"))).toBe("Version 2.1.0");
  });

  it("works offline: it never touches the network", () => {
    mockOnline = false;
    mockNotes = [NOTES];
    const { getByTestId } = render(<WhatsNewScreen />);
    expect(getByTestId("whats-new-notes")).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});

describe("Open-source licenses", () => {
  it("lists the bundled packages and the honest scope of the list", () => {
    const { getByTestId } = render(<LicensesScreen />);
    expect(getByTestId("settings-title").props.children).toBe("Open-source licenses");
    expect(text(getByTestId("licenses-intro"))).toMatch(/^PatelRep is built with open-source software\. These \d+ packages are the ones PatelRep uses directly/);
    expect(getByTestId("license-react-native")).toBeTruthy();
    expect(getByTestId("license-zustand")).toBeTruthy();
  });

  it("shows the license text of a package on demand, and hides it again", () => {
    const { getByTestId, queryByTestId } = render(<LicensesScreen />);
    expect(queryByTestId("license-text-zustand")).toBeNull();
    fireEvent.press(getByTestId("license-zustand"));
    expect(getByTestId("license-zustand").props.accessibilityState).toEqual({ expanded: true });
    expect(getByTestId("license-text-zustand")).toBeTruthy();
    fireEvent.press(getByTestId("license-zustand"));
    expect(queryByTestId("license-text-zustand")).toBeNull();
  });

  it("shows one package open at a time", () => {
    const { getByTestId, queryByTestId } = render(<LicensesScreen />);
    fireEvent.press(getByTestId("license-zustand"));
    fireEvent.press(getByTestId("license-react-native"));
    expect(queryByTestId("license-text-zustand")).toBeNull();
    expect(getByTestId("license-text-react-native")).toBeTruthy();
  });

  it("says so when a package ships no license file, rather than printing a made-up text", () => {
    const { getByTestId, getByText } = render(<LicensesScreen />);
    fireEvent.press(getByTestId("license-expo-router"));
    expect(getByText("This package does not include a separate license file. It is released under the MIT license.")).toBeTruthy();
  });

  it("includes the font license text for the bundled typefaces", () => {
    const { getByTestId } = render(<LicensesScreen />);
    fireEvent.press(getByTestId("license-@expo-google-fonts/instrument-serif"));
    expect(text(getByTestId("license-text-@expo-google-fonts/instrument-serif").findAllByType(require("react-native").Text)[0])).toMatch(/SIL OPEN FONT LICENSE/);
  });

  it("renders in Spanish and in dark mode", () => {
    mockLanguage = "es";
    mockMode = "dark";
    const { getByTestId } = render(<LicensesScreen />);
    expect(getByTestId("settings-title").props.children).toBe("Licencias de código abierto");
    expect(text(getByTestId("licenses-intro"))).toMatch(/^PatelRep está creado con software de código abierto/);
  });

  it("works offline: the notices are bundled", () => {
    mockOnline = false;
    const { getByTestId } = render(<LicensesScreen />);
    expect(getByTestId("licenses-list")).toBeTruthy();
  });
});

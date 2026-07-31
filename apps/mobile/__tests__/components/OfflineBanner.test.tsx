import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { render } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { darkTheme, lightTheme } from "@/components/shared/tokens";
import i18n from "@/i18n";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const mockUseAppStore = jest.fn();
let mockSystemScheme: "light" | "dark" = "light";

jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => mockUseAppStore(selector),
}));

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));

function renderBanner(mode: "light" | "dark" = "light") {
  mockSystemScheme = mode;
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <OfflineBanner />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

function flattenedStyle(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style) as ViewStyle & TextStyle;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSystemScheme = "light";
  mockUseAppStore.mockImplementation((selector: (state: { isOnline: boolean }) => unknown) =>
    selector({ isOnline: false }),
  );
  (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise(() => undefined));
  await i18n.changeLanguage("en");
});

it("renders nothing while the device is online", () => {
  mockUseAppStore.mockImplementation((selector: (state: { isOnline: boolean }) => unknown) =>
    selector({ isOnline: true }),
  );

  expect(renderBanner().toJSON()).toBeNull();
});

it.each([
  ["en", "You're offline — changes will sync when connected"],
  ["es", "Sin conexión — los cambios se sincronizarán al conectarse"],
] as const)("renders the existing common.offline translation in %s", async (language, message) => {
  await i18n.changeLanguage(language);

  expect(renderBanner().getByText(message)).toBeTruthy();
});

it.each([
  ["light", lightTheme],
  ["dark", darkTheme],
] as const)("uses the %s semantic fill, foreground, and visible boundary", (mode, theme) => {
  const screen = renderBanner(mode);
  const banner = screen.UNSAFE_getAllByType(View)[0];
  const message = screen.UNSAFE_getByType(Text);

  expect(flattenedStyle(banner)).toMatchObject({
    backgroundColor: theme.banner.offline.background,
    borderColor: theme.banner.offline.border,
    borderBottomWidth: 1,
    width: "100%",
  });
  expect(flattenedStyle(message).color).toBe(theme.banner.offline.foreground);
});

it("announces the complete offline message as an assertive alert", () => {
  const screen = renderBanner();
  const banner = screen.getByRole("alert");

  expect(banner.props.accessibilityLiveRegion).toBe("assertive");
  expect(banner.props.accessibilityLabel).toBe(
    "You're offline — changes will sync when connected",
  );
});

it("keeps measured inline layout while allowing 200% text to wrap", () => {
  const screen = renderBanner();
  const banner = screen.getByRole("alert");
  const message = screen.UNSAFE_getByType(Text);
  const bannerStyle = flattenedStyle(banner);

  expect(bannerStyle.width).toBe("100%");
  expect(bannerStyle.height).toBeUndefined();
  expect(bannerStyle.maxHeight).toBeUndefined();
  expect(message.props.numberOfLines).toBeUndefined();
  expect(flattenedStyle(message).flexShrink).toBe(1);
});

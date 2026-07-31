import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import { Pressable, Text, View } from "react-native";
import {
  ThemeProvider,
  useAppearancePreference,
  useThemeMode,
} from "@/lib/theme/ThemeProvider";
import { APPEARANCE_STORAGE_KEY } from "@/lib/theme/appearance";

let mockSystemScheme: "light" | "dark" | null = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ThemeProbe() {
  const mode = useThemeMode();
  const { preference, setPreference, isHydrated } =
    useAppearancePreference();

  return (
    <View>
      <Text testID="preference">{preference}</Text>
      <Text testID="mode">{mode}</Text>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Pressable
        testID="set-system"
        onPress={() => void setPreference("system")}
      />
      <Pressable
        testID="set-light"
        onPress={() => void setPreference("light")}
      />
      <Pressable
        testID="set-dark"
        onPress={() => void setPreference("dark")}
      />
    </View>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

async function expectHydrated(
  screen: ReturnType<typeof renderProvider>,
  preference: "system" | "light" | "dark",
  mode: "light" | "dark",
) {
  await waitFor(() =>
    expect(screen.getByTestId("hydrated").props.children).toBe("true"),
  );
  expect(screen.getByTestId("preference").props.children).toBe(preference);
  expect(screen.getByTestId("mode").props.children).toBe(mode);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSystemScheme = "light";
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

it("rejects theme hooks used outside ThemeProvider", () => {
  expect(() => renderHook(() => useThemeMode())).toThrow(
    "useThemeMode must be used within a ThemeProvider",
  );
  expect(() =>
    renderHook(() => useAppearancePreference()),
  ).toThrow(
    "useAppearancePreference must be used within a ThemeProvider",
  );
});

it("defaults missing storage to System and follows the current OS scheme", async () => {
  mockSystemScheme = "dark";
  const screen = renderProvider();

  await expectHydrated(screen, "system", "dark");
});

it.each([
  ["light", "dark", "light"],
  ["dark", "light", "dark"],
] as const)(
  "restores saved %s and overrides an OS %s scheme",
  async (savedPreference, systemScheme, expectedMode) => {
    mockSystemScheme = systemScheme;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(savedPreference);

    const screen = renderProvider();

    await expectHydrated(screen, savedPreference, expectedMode);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(APPEARANCE_STORAGE_KEY);
  },
);

it("normalizes an invalid saved value to System", async () => {
  mockSystemScheme = "dark";
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue("sepia");

  const screen = renderProvider();

  await expectHydrated(screen, "system", "dark");
});

it("reports hydration false until the storage read settles", async () => {
  const read = deferred<string | null>();
  (AsyncStorage.getItem as jest.Mock).mockReturnValue(read.promise);

  const screen = renderProvider();

  expect(screen.getByTestId("hydrated").props.children).toBe("false");

  await act(async () => {
    read.resolve("dark");
    await read.promise;
  });

  await expectHydrated(screen, "dark", "dark");
});

it("updates visible state before persistence settles and writes the exact key/value", async () => {
  const write = deferred<void>();
  (AsyncStorage.setItem as jest.Mock).mockReturnValue(write.promise);
  const screen = renderProvider();
  await expectHydrated(screen, "system", "light");

  fireEvent.press(screen.getByTestId("set-dark"));

  expect(screen.getByTestId("preference").props.children).toBe("dark");
  expect(screen.getByTestId("mode").props.children).toBe("dark");
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    APPEARANCE_STORAGE_KEY,
    "dark",
  );

  await act(async () => {
    write.resolve();
    await write.promise;
  });
});

it("reacts to live OS changes only while System is selected", async () => {
  const screen = renderProvider();
  await expectHydrated(screen, "system", "light");

  mockSystemScheme = "dark";
  screen.rerender(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId("mode").props.children).toBe("dark");

  fireEvent.press(screen.getByTestId("set-light"));
  mockSystemScheme = "dark";
  screen.rerender(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId("mode").props.children).toBe("light");
});

it("settles hydration after a failed read without crashing", async () => {
  mockSystemScheme = "dark";
  (AsyncStorage.getItem as jest.Mock).mockRejectedValue(
    new Error("storage unavailable"),
  );

  const screen = renderProvider();

  await expectHydrated(screen, "system", "dark");
});

it("keeps the immediate preference after a failed write", async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValue(
    new Error("storage unavailable"),
  );
  const screen = renderProvider();
  await expectHydrated(screen, "system", "light");

  fireEvent.press(screen.getByTestId("set-dark"));

  await waitFor(() =>
    expect(screen.getByTestId("preference").props.children).toBe("dark"),
  );
  expect(screen.getByTestId("mode").props.children).toBe("dark");
});

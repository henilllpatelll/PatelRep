import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import type { ThemeMode } from "@/components/shared/tokens";
import {
  APPEARANCE_STORAGE_KEY,
  normalizeAppearancePreference,
  resolveThemeMode,
  type AppearancePreference,
} from "./appearance";

type AppearanceContextValue = {
  preference: AppearancePreference;
  mode: ThemeMode;
  setPreference: (next: AppearancePreference) => Promise<void>;
  isHydrated: boolean;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] =
    useState<AppearancePreference>("system");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function hydratePreference() {
      try {
        const savedPreference = await AsyncStorage.getItem(
          APPEARANCE_STORAGE_KEY,
        );
        if (isMounted) {
          setPreferenceState(
            normalizeAppearancePreference(savedPreference),
          );
        }
      } catch {
        if (isMounted) {
          setPreferenceState("system");
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    }

    void hydratePreference();

    return () => {
      isMounted = false;
    };
  }, []);

  const setPreference = useCallback(
    async (next: AppearancePreference) => {
      setPreferenceState(next);
      try {
        await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next);
      } catch {
        // Appearance persistence must never block floor work.
      }
    },
    [],
  );

  const mode = resolveThemeMode(preference, systemScheme);

  const value = useMemo(
    () => ({ preference, mode, setPreference, isHydrated }),
    [preference, mode, setPreference, isHydrated],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useThemeMode(): ThemeMode {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error("useThemeMode must be used within a ThemeProvider");
  }
  return ctx.mode;
}

export function useAppearancePreference(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error(
      "useAppearancePreference must be used within a ThemeProvider",
    );
  }
  return ctx;
}

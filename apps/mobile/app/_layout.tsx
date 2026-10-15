import { useEffect } from "react";
import { Stack } from "expo-router";
import { ThemeProvider as NavigationThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import NetInfo from "@react-native-community/netinfo";
import { useFonts } from "expo-font";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from "@expo-google-fonts/ibm-plex-sans";
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";
import "@/i18n";
import { useAppStore } from "@/stores/appStore";
import { syncOnConnect } from "@/lib/offline/sync";
import { supabase, toAppRole } from "@/lib/supabase";
import type { UserProfile } from "@/lib/supabase";
import { api } from "@/lib/api/client";
import { deferAuthHydration } from "@/lib/auth/deferAuthHydration";
import { useRecoveryStore } from "@/lib/auth/recoveryStore";
import {
  ThemeProvider,
  useAppearancePreference,
} from "@/lib/theme/ThemeProvider";
import { useTheme } from "@/lib/theme/useTheme";
import { getNavigationTheme } from "@/lib/theme/navigationTheme";
import {
  clearActiveLanguageUser,
  hydrateLanguageForUser,
  restoreDeviceLanguage,
  retryPendingLanguageSync,
} from "@/lib/language/languageSync";

// Must be at module scope — calling inside a component or useEffect is too late.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootChrome />
    </ThemeProvider>
  );
}

function RootChrome() {
  const { setUser, setIsOnline, setIsLoading, isLoading } = useAppStore();
  const { mode, isHydrated } = useAppearancePreference();
  const theme = useTheme();
  const [fontsLoaded] = useFonts({
    InstrumentSerif_400Regular,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Set synchronously so the (auth) layout never redirects before the reset screen opens.
      if (event === "PASSWORD_RECOVERY") useRecoveryStore.getState().setPending(true);
      deferAuthHydration(async () => {
        try {
          if (session?.user) {
          // Decode JWT custom claims (migration 019 hook). The app role lives in
          // `user_role`; top-level `role` stays "authenticated" for PostgREST.
          let jwtHotelId: string | undefined;
          let jwtRole: ReturnType<typeof toAppRole> = null;
          try {
            const payload = JSON.parse(atob(session.access_token.split(".")[1]));
            jwtHotelId = payload.hotel_id;
            jwtRole = toAppRole(payload.user_role, payload.role);
          } catch { /* malformed JWT — unlikely */ }

          const { data: profile } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("id", session.user.id)
            .maybeSingle();

          // user_profiles has no role column — the JWT claim is the only base source.
          const baseUser: UserProfile | null = profile
            ? ({ ...profile, role: jwtRole ?? "housekeeper" } as UserProfile)
            : jwtHotelId && jwtRole
              ? {
                  id: session.user.id,
                  tenant_id: jwtHotelId,
                  role: jwtRole,
                  full_name: session.user.email?.split("@")[0] ?? "User",
                  language_pref: "en",
                }
              : null;

          if (baseUser) {
            // Fetch effective_role for schedule overrides (non-blocking)
            try {
              const me = await api.get<{ data?: { effective_role?: string } }>("/staff/me/effective-role");
              const effectiveRole = toAppRole(me?.data?.effective_role);
              setUser(effectiveRole ? { ...baseUser, effective_role: effectiveRole } : baseUser);
            } catch {
              setUser(baseUser);
            }
            // This person's own language (pending local choice > account > cached > device). Only a
            // real saved profile counts as the account preference, not the "en" fallback above.
            await hydrateLanguageForUser(baseUser.id, profile ? baseUser.language_pref : null).catch(() => undefined);
          } else {
            clearActiveLanguageUser();
            setUser(null);
          }
          } else {
            clearActiveLanguageUser();
            setUser(null);
          }
        } finally {
          setIsLoading(false);
        }
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  // Hide splash only after auth, the saved appearance, and fonts have all resolved.
  useEffect(() => {
    if (!isLoading && isHydrated && fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [isLoading, isHydrated, fontsLoaded]);

  // Safety timeout: prevent permanent splash lock on slow devices or network errors.
  useEffect(() => {
    const timeout = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timeout);
  }, []);

  // Before anyone signs in, show the language this phone last used.
  useEffect(() => {
    void restoreDeviceLanguage().catch(() => undefined);
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected;
      setIsOnline(online);
      if (online) {
        syncOnConnect();
        void retryPendingLanguageSync().catch(() => undefined);
      }
    });

    return () => unsubscribe();
  }, []);

  // Notification taps are handled in one place, once the person is signed in: (app)/_layout.tsx via
  // lib/notifications/lifecycle.ts, which validates the payload before navigating.

  if (!isHydrated) return null;

  return (
    <NavigationThemeProvider value={getNavigationTheme(mode)}>
      <StatusBar
        style={mode === "dark" ? "light" : "dark"}
        animated={false}
      />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </NavigationThemeProvider>
  );
}

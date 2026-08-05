import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { ThemeProvider as NavigationThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import NetInfo from "@react-native-community/netinfo";
import "@/i18n";
import { useAppStore } from "@/stores/appStore";
import { syncOnConnect } from "@/lib/offline/sync";
import { supabase, toAppRole } from "@/lib/supabase";
import type { UserProfile } from "@/lib/supabase";
import { api } from "@/lib/api/client";
import { deferAuthHydration } from "@/lib/auth/deferAuthHydration";
import {
  ThemeProvider,
  useAppearancePreference,
} from "@/lib/theme/ThemeProvider";
import { useTheme } from "@/lib/theme/useTheme";
import { getNavigationTheme } from "@/lib/theme/navigationTheme";

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
  const router = useRouter();
  const { setUser, setIsOnline, setIsLoading, isLoading } = useAppStore();
  const { mode, isHydrated } = useAppearancePreference();
  const theme = useTheme();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
          } else {
            setUser(null);
          }
          } else {
            setUser(null);
          }
        } finally {
          setIsLoading(false);
        }
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  // Hide splash only after auth and the saved appearance have both resolved.
  useEffect(() => {
    if (!isLoading && isHydrated) {
      SplashScreen.hideAsync();
    }
  }, [isLoading, isHydrated]);

  // Safety timeout: prevent permanent splash lock on slow devices or network errors.
  useEffect(() => {
    const timeout = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected;
      setIsOnline(online);
      if (online) {
        syncOnConnect();
      }
    });

    return () => unsubscribe();
  }, []);

  // Notification deep link handler — dual-path for backgrounded AND killed states
  useEffect(() => {
    // Path 1: Killed state — app cold-started by tapping a notification.
    // addNotificationResponseReceivedListener is NOT called in this case.
    // Must check getLastNotificationResponseAsync() once on mount.
    Notifications.getLastNotificationResponseAsync().then((lastResponse) => {
      if (lastResponse) {
        const url = lastResponse.notification.request.content.data?.url as
          | string
          | undefined;
        if (url) router.push(url as never);
      }
    });

    // Path 2: Backgrounded or foregrounded — standard listener.
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const url = response.notification.request.content.data?.url as
          | string
          | undefined;
        if (url) router.push(url as never);
      }
    );

    return () => subscription.remove();
  }, []);

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

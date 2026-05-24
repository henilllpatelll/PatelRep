import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import NetInfo from "@react-native-community/netinfo";
import "@/i18n";
import { useAppStore } from "@/stores/appStore";
import { setupPushNotifications } from "@/lib/notifications";
import { syncOnConnect } from "@/lib/offline/sync";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/lib/supabase";

// Must be at module scope — calling inside a component or useEffect is too late.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const { setUser, setIsOnline, setIsLoading, isLoading } = useAppStore();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (session?.user) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();

          if (profile) {
            setUser(profile as UserProfile);
            try { await setupPushNotifications(); } catch { /* unavailable in Expo Go */ }
          }
        } else {
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Hide splash screen once auth state has resolved.
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

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

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

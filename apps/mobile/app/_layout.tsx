import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
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
  const { setUser, setIsOnline, setIsLoading, isLoading } = useAppStore();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("*")
          .eq("id", session.user.id)
          .single();

        if (profile) {
          setUser(profile as UserProfile);
          await setupPushNotifications();
        }
      } else {
        setUser(null);
      }
      // Fires on every auth state change, including the initial hydration event.
      setIsLoading(false);
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
    const timeout = setTimeout(() => setIsLoading(false), 5000);
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

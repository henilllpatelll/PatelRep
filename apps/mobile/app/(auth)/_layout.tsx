import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { useAppStore } from "@/stores/appStore";
import { useRecoveryStore } from "@/lib/auth/recoveryStore";

export default function AuthLayout() {
  const { isAuthenticated, isLoading } = useAppStore(
    (s) => ({ isAuthenticated: s.isAuthenticated, isLoading: s.isLoading })
  );

  const recoveryPending = useRecoveryStore((s) => s.pending);

  useEffect(() => {
    // A recovery link signs the person in; let them finish choosing a password before entering the app.
    if (!isLoading && isAuthenticated && !recoveryPending) {
      router.replace("/(app)/home");
    }
  }, [isAuthenticated, isLoading, recoveryPending]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

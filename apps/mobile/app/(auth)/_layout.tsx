import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { useAppStore } from "@/stores/appStore";
import { useRecoveryStore } from "@/lib/auth/recoveryStore";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";

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

  // Every signed-out screen is fully migrated, so the whole stack takes the V2 theme when the
  // preview flag is on. With the flag off DesignV2Scope is a pass-through.
  return (
    <DesignV2Scope>
      <Stack screenOptions={{ headerShown: false }} />
    </DesignV2Scope>
  );
}

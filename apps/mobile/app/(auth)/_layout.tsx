import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { useAppStore } from "@/stores/appStore";

export default function AuthLayout() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/(app)");
    }
  }, [isAuthenticated]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

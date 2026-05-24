import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { useAppStore } from "@/stores/appStore";

export default function AuthLayout() {
  const { isAuthenticated, isLoading } = useAppStore(
    (s) => ({ isAuthenticated: s.isAuthenticated, isLoading: s.isLoading })
  );

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/(app)/my-rooms");
    }
  }, [isAuthenticated, isLoading]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

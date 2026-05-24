import { useEffect } from "react";
import { Tabs, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/stores/appStore";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import type { UserRole } from "@/lib/supabase";

type TabDef = { name: string; title: string; icon: string };

function getTabsForRole(role: UserRole): TabDef[] {
  const common: TabDef[] = [
    { name: "copilot/index", title: "tabs.copilot", icon: "chatbubble-ellipses" },
    { name: "profile/index", title: "tabs.profile", icon: "person" },
  ];

  switch (role) {
    case "housekeeper":
      return [
        { name: "my-rooms/index", title: "tabs.myRooms", icon: "bed" },
        { name: "tasks/index", title: "tabs.tasks", icon: "checkmark-circle" },
        ...common,
      ];
    case "engineer":
      return [
        { name: "work-orders/index", title: "tabs.workOrders", icon: "construct" },
        { name: "tasks/index", title: "tabs.tasks", icon: "checkmark-circle" },
        ...common,
      ];
    default:
      return [
        { name: "my-rooms/index", title: "tabs.myRooms", icon: "bed" },
        { name: "work-orders/index", title: "tabs.workOrders", icon: "construct" },
        { name: "tasks/index", title: "tabs.tasks", icon: "checkmark-circle" },
        ...common,
      ];
  }
}

export default function AppLayout() {
  const { t } = useTranslation();
  const { user, isAuthenticated, isLoading } = useAppStore();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/(auth)/login");
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading || !user) return null;

  return (
    <>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: "#b8431c",
          tabBarInactiveTintColor: "#a8a195",
          tabBarStyle: { backgroundColor: "#f7f4ee", borderTopColor: "#e6dfd1" },
          headerStyle: { backgroundColor: "#f7f4ee" },
          headerTintColor: "#1a1815",
          headerTitleStyle: { fontWeight: "600", color: "#1a1815" },
          headerShadowVisible: false,
        }}
      >
        {getTabsForRole(user.role).map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.title),
              tabBarIcon: ({ color, size }) => (
                <Ionicons name={tab.icon as "bed"} size={size} color={color} />
              ),
            }}
          />
        ))}
      </Tabs>
    </>
  );
}

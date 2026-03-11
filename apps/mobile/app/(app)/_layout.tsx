import { useEffect } from "react";
import { Tabs, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/stores/appStore";
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
  const { user, isAuthenticated } = useAppStore();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/(auth)/login");
    }
  }, [isAuthenticated]);

  if (!user) return null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#1E40AF",
        tabBarInactiveTintColor: "#9CA3AF",
        headerStyle: { backgroundColor: "#1E40AF" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
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
  );
}

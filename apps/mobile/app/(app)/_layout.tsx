import { useEffect } from "react";
import { Tabs, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/stores/appStore";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { C } from "@/components/shared/tokens";
import { ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";

export default function AppLayout() {
  const { t } = useTranslation();
  const { user, isAuthenticated, isLoading } = useAppStore();
  const visibleTabs = user ? getTabsForRole(user.role) : [];
  const visibleNames = new Set(visibleTabs.map((tab) => tab.name));

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
          tabBarActiveTintColor: C.accent,
          tabBarInactiveTintColor: C.ink4,
          tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
          tabBarStyle: {
            backgroundColor: C.surface,
            borderTopColor: C.line,
            height: 72,
            paddingTop: 8,
            paddingBottom: 12,
          },
          headerStyle: { backgroundColor: C.paper },
          headerTintColor: C.ink,
          headerTitleStyle: { fontWeight: "600", color: C.ink },
          headerShadowVisible: false,
        }}
      >
        {visibleTabs.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.titleKey),
              headerShown: false,
              tabBarIcon: ({ color, size }) => (
                <Ionicons
                  name={tab.icon}
                  size={tab.special ? size + 2 : size}
                  color={tab.special ? C.accent : color}
                  style={
                    tab.special
                      ? {
                          backgroundColor: C.ink,
                          borderRadius: 20,
                          marginTop: -18,
                          width: 40,
                          height: 40,
                          padding: 10,
                          borderWidth: 3,
                          borderColor: C.surface,
                        }
                      : undefined
                  }
                />
              ),
            }}
          />
        ))}
        {ALL_ROLE_TAB_ROUTES.filter((name) => !visibleNames.has(name)).map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
        {HIDDEN_APP_ROUTES.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>
    </>
  );
}

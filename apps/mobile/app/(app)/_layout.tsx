import { useEffect } from "react";
import { Tabs, router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/stores/appStore";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { C } from "@/components/shared/tokens";
import { ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";
import { setupPushNotifications } from "@/lib/notifications";
import { listNotifications } from "@/lib/api/notifications";

export default function AppLayout() {
  const { t } = useTranslation();
  const { user, isAuthenticated, isLoading, loadPendingActions, unreadCount, setUnreadCount } = useAppStore();
  const effectiveRole = user?.effective_role ?? user?.role;
  const visibleTabs = effectiveRole ? getTabsForRole(effectiveRole) : [];
  const visibleNames = new Set(visibleTabs.map((tab) => tab.name));

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/(auth)/login");
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (!isAuthenticated) return;

    setupPushNotifications().catch(console.warn);
    loadPendingActions().catch(console.warn);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        type?: string;
        url?: string;
        requestId?: string;
      };

      if (data.url) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.push(data.url as any);
        return;
      }

      if (data.type === "task_assigned") {
        router.push("/(app)/tasks" as never);
      } else if (data.type === "guest_request" && data.requestId) {
        router.push({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pathname: "/(app)/guest-requests/[requestId]" as any,
          params: { requestId: data.requestId },
        });
      } else if (data.type === "room_inspection") {
        router.push("/(app)/inspect" as never);
      }
    });

    return () => subscription.remove();
  }, [isAuthenticated, loadPendingActions]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const poll = () => {
      listNotifications(false)
        .then((res) => setUnreadCount(res.data?.length ?? 0))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => clearInterval(id);
  }, [isAuthenticated, setUnreadCount]);

  if (isLoading || !user) return null;

  return (
    <>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: C.shellInk,
          tabBarInactiveTintColor: C.shellInk3,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
          tabBarStyle: {
            backgroundColor: C.shell,
            borderTopColor: C.shellLine,
            borderTopWidth: 1,
            height: 76,
            paddingTop: 8,
            paddingBottom: 12,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: -4 },
            elevation: 10,
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
                  color={tab.special ? "#fff" : color}
                  style={
                    tab.special
                      ? {
                          backgroundColor: C.ai,
                          borderRadius: 20,
                          marginTop: -18,
                          width: 40,
                          height: 40,
                          padding: 10,
                          borderWidth: 3,
                          borderColor: C.shell,
                          shadowColor: C.ai,
                          shadowOpacity: 0.45,
                          shadowRadius: 10,
                          shadowOffset: { width: 0, height: 3 },
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
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              href: null,
              headerShown: false,
              tabBarBadge: name === "notifications/index" && unreadCount > 0 ? unreadCount : undefined,
            }}
            listeners={name === "notifications/index" ? { focus: () => setUnreadCount(0) } : undefined}
          />
        ))}
      </Tabs>
    </>
  );
}

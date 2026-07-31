import { useEffect, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Tabs, router, usePathname } from "expo-router";
import * as Notifications from "expo-notifications";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/stores/appStore";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";
import { setupPushNotifications } from "@/lib/notifications";
import { listNotifications } from "@/lib/api/notifications";
import { ToastProvider, ToastViewport } from "@/lib/theme/ToastProvider";
import { useTheme } from "@/lib/theme/useTheme";

export default function AppLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user, isAuthenticated, isLoading, loadPendingActions, unreadCount, setUnreadCount } = useAppStore();
  const pathname = usePathname();
  const [bannerHeight, setBannerHeight] = useState(0);
  const hideFab = /^\/my-rooms\/.+/.test(pathname);
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
    <ToastProvider>
      <View style={styles.root}>
        <View onLayout={(e) => setBannerHeight(e.nativeEvent.layout.height)}>
          <OfflineBanner />
        </View>
        <ToastViewport topOffset={insets.top + bannerHeight} />
        <Tabs
          screenOptions={{
            tabBarActiveTintColor: theme.shell.ink,
            tabBarInactiveTintColor: theme.shell.ink3,
            tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
            tabBarStyle: {
              backgroundColor: theme.shell.bg,
              borderTopColor: theme.shell.line,
              borderTopWidth: 1,
              height: 76,
              paddingTop: 8,
              paddingBottom: 12,
              shadowColor: theme.shell.bg,
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: -4 },
              elevation: 10,
            },
            headerStyle: { backgroundColor: theme.shell.surface },
            headerTintColor: theme.shell.ink,
            headerTitleStyle: { fontWeight: "600", color: theme.shell.ink },
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
                tabBarAccessibilityLabel: t(tab.titleKey),
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name={tab.icon} size={size} color={color} />
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
        {!hideFab ? (
          <TouchableOpacity
            accessibilityLabel={t("tabs.copilot")}
            accessibilityRole="button"
            style={[
              styles.fab,
              {
                bottom: insets.bottom + 92,
                backgroundColor: theme.ai.primary,
                shadowColor: theme.ai.primary,
              },
            ]}
            onPress={() => router.push("/(app)/copilot" as never)}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={22} color={theme.onAi} />
          </TouchableOpacity>
        ) : null}
      </View>
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fab: {
    position: "absolute",
    right: 18,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Tabs, router, usePathname } from "expo-router";
import * as Notifications from "expo-notifications";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/stores/appStore";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { CopilotCard } from "@/components/shared/CopilotCard";
import { CopilotBubble, BUBBLE_RIGHT_INSET, type CopilotBubbleState } from "@/components/shared/CopilotBubble";
import { useCopilotBrief } from "@/lib/ai/copilotCard";
import { speechModule, useSpeechRecognitionEvent } from "@/lib/voice/speechModule";
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
  // cardOpen is the logical intent (drives the X button / bubble tap / voice
  // result); cardMounted keeps CopilotCard in the tree for the shrink-back-
  // into-the-bubble animation to finish playing before it actually unmounts.
  const [cardOpen, setCardOpen] = useState(false);
  const [cardMounted, setCardMounted] = useState(false);
  const [briefSeen, setBriefSeen] = useState(true);
  const [listening, setListening] = useState(false);
  // 0 = collapsed bubble, 1 = fully expanded card — drives both sides of the
  // "grows out of the bubble" transition (design spec 1a/2a) from one value.
  const cardProgress = useSharedValue(0);
  const hideFab = /^\/my-rooms\/.+/.test(pathname);
  const effectiveRole = user?.effective_role ?? user?.role;
  const visibleTabs = effectiveRole ? getTabsForRole(effectiveRole) : [];
  const visibleNames = new Set(visibleTabs.map((tab) => tab.name));
  const { brief, loading: briefLoading, error: briefError, reload: reloadBrief } = useCopilotBrief();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/(auth)/login");
    }
  }, [isAuthenticated, isLoading]);

  // Leaving the screen entirely (not a user dismiss) resets instantly —
  // no point animating a card shut on a screen the user is already leaving.
  useEffect(() => {
    setCardOpen(false);
    setCardMounted(false);
    cardProgress.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // A freshly-loaded brief is "unread" until the card is opened to see it.
  useEffect(() => {
    if (brief) setBriefSeen(false);
  }, [brief]);

  useSpeechRecognitionEvent("result", (event) => {
    setListening(false);
    const transcript = event.results[0]?.transcript?.trim();
    if (transcript) {
      router.push({ pathname: "/(app)/copilot", params: { prefill: transcript } });
    }
  });
  useSpeechRecognitionEvent("error", () => setListening(false));

  // Tap opens the card by expanding out of the bubble; per design, the ONLY
  // way back is the card's own header close button (closeCard) — no
  // backdrop-tap, no re-tapping the bubble (it's hidden while the card is
  // open anyway), no secondary-button dismiss.
  function openCard() {
    setCardMounted(true);
    setCardOpen(true);
    setBriefSeen(true);
    cardProgress.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
  }

  function closeCard() {
    setCardOpen(false);
    cardProgress.value = withTiming(
      0,
      { duration: 220, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setCardMounted)(false);
      },
    );
  }

  function startVoiceCapture() {
    if (!speechModule) {
      openCard();
      return;
    }
    setListening(true);
    speechModule.start({ lang: "en-US", continuous: false, interimResults: false });
  }

  function stopVoiceCapture() {
    if (!listening) return;
    speechModule?.stop();
  }

  const bubbleState: CopilotBubbleState = listening
    ? "listening"
    : briefLoading
      ? "thinking"
      : brief && !briefSeen
        ? "unread"
        : "idle";

  const bubbleBottomOffset = insets.bottom + 92;

  // As the card expands, the bubble doesn't just fade/shrink in place — it
  // drifts toward the literal screen corner too, converging on the same
  // point the card's transformOrigin scales from (cardOrigin below), so both
  // halves of the transition read as anchored to one shared spot.
  const bubbleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - cardProgress.value,
    transform: [
      { translateX: cardProgress.value * BUBBLE_RIGHT_INSET },
      { translateY: cardProgress.value * bubbleBottomOffset },
      { scale: 1 - cardProgress.value * 0.5 },
    ],
  }));

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cardProgress.value,
    transform: [{ scale: 0.15 + cardProgress.value * 0.85 }],
  }));

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
          <Animated.View
            style={[StyleSheet.absoluteFill, bubbleAnimatedStyle]}
            pointerEvents={cardOpen ? "none" : "box-none"}
          >
            <CopilotBubble
              state={bubbleState}
              bottom={bubbleBottomOffset}
              accessibilityLabel={t("tabs.copilot")}
              onPress={openCard}
              onLongPress={startVoiceCapture}
              onPressOut={stopVoiceCapture}
            />
          </Animated.View>
        ) : null}
        {cardMounted && !hideFab ? (
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.cardOrigin, cardAnimatedStyle]}
            pointerEvents="box-none"
          >
            <CopilotCard
              onClose={closeCard}
              insetsBottom={insets.bottom}
              brief={brief}
              loading={briefLoading}
              error={briefError}
              reload={reloadBrief}
            />
          </Animated.View>
        ) : null}
      </View>
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Anchors the card's scale-in/out to the screen's bottom-right corner, near
  // where the bubble sits, so it reads as "growing out of the bubble" rather
  // than scaling from its own center.
  cardOrigin: { transformOrigin: ["100%", "100%", 0] },
});

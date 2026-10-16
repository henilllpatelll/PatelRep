import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { AttentionSheetHost } from "@/components/supervisor/attention/AttentionSheetHost";
import { AttentionPreview } from "@/components/supervisor/today/AttentionPreview";
import { QuickActions, type QuickActionKey } from "@/components/supervisor/today/QuickActions";
import { ReadinessCard } from "@/components/supervisor/today/ReadinessCard";
import { TeamPulseCard } from "@/components/supervisor/today/TeamPulseCard";
import { TodayHeader } from "@/components/supervisor/today/TodayHeader";
import BroadcastModal from "@/components/supervisor/BroadcastModal";
import DirectMessageModal from "@/components/supervisor/DirectMessageModal";
import EndShiftModal from "@/components/supervisor/EndShiftModal";
import ShiftNoteModal from "@/components/supervisor/ShiftNoteModal";
import { StaffPickerSheet } from "@/components/supervisor/StaffPickerSheet";
import { StaffQuickViewSheet } from "@/components/supervisor/StaffQuickViewSheet";
import { resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { firstNameOf } from "@/lib/housekeeping/homeText";
import { buildFloorSnapshot, type AssignableStaff, type FloorSnapshot } from "@/lib/housekeeping/supervisor";
import { availabilityKey, roleKey, type StaffQuickView } from "@/lib/housekeeping/supervisorComms";
import { isVerified, knownValue } from "@/lib/housekeeping/supervisorSources";
import { describeFreshness, freshnessLabel, greetingPart } from "@/lib/housekeeping/supervisorTodayView";
import { subscribeSupervisorRealtime } from "@/lib/housekeeping/supervisorRealtime";
import { useSupervisorToday } from "@/lib/housekeeping/useSupervisorToday";
import { supervisorHref, type SupervisorScreen } from "@/lib/navigation/supervisorRoutes";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore } from "@/stores/appStore";

/* ─── Supervisor Today ──────────────────────────────────────────────────────
   One screen, three questions: how is the hotel doing, what needs me first,
   what do I do next. All numbers come from the Phase 1 model (supervisorToday);
   this file only lays them out and wires navigation and the existing modals.

   The floating PatelRep assistant is mounted once by the (app) layout — it is
   deliberately NOT rendered here. */

/** Let one modal finish dismissing before the next presents. */
const MODAL_SWAP_MS = 300;

function go(screen: SupervisorScreen) {
  router.push(supervisorHref({ screen }).pathname as never);
}

export function SupervisorHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const unreadCount = useAppStore((state) => state.unreadCount);
  const hotelTimezone = useAppStore((state) => state.hotelTimezone);
  const tenantId = user?.tenant_id ?? null;
  const userId = user?.id ?? null;
  const language = user?.language_pref ?? "en";

  const { today, refresh } = useSupervisorToday({
    viewerId: userId,
    scopeKey: tenantId && userId ? `${tenantId}:${userId}` : null,
  });
  const [pulling, setPulling] = useState(false);
  const [showShiftNote, setShowShiftNote] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  // The counts the handoff will report, frozen when it opens so a background refresh cannot change them mid-form.
  const [handoff, setHandoff] = useState<FloorSnapshot | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<{ id: string; name: string; meta: string | null } | null>(null);
  const [attentionItemId, setAttentionItemId] = useState<string | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime: the one shared channel per hotel (the Attention Center reuses it), refreshing the shared snapshot.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!tenantId) return;
    return subscribeSupervisorRealtime(tenantId, () => refreshRef.current());
  }, [tenantId]);

  useEffect(
    () => () => {
      if (swapTimer.current) clearTimeout(swapTimer.current);
    },
    [],
  );

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);

  const now = today.generatedAt;
  const zone = hotelTimezone;
  const part = greetingPart(zone, new Date(now));
  const first = firstNameOf(name);
  const greeting = first ? t(`supervisorToday.greeting.${part}Name`, { name: first }) : t(`supervisorToday.greeting.${part}`);
  const dateLine = useMemo(
    () =>
      new Intl.DateTimeFormat(language.startsWith("es") ? "es-US" : "en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: resolveTimeZone(zone),
      }).format(new Date(now)),
    [now, zone, language],
  );

  const freshness = useMemo(
    () => freshnessLabel(describeFreshness(today.sources.board, now), t, zone, language),
    [today.sources.board, now, t, zone, language],
  );

  const board = knownValue(today.sources.board, { rooms: [], invalidRows: 0, duplicateRows: 0 });
  const boardVerified = isVerified(today.sources.board);
  const handoffSnapshot = useMemo(() => (board && boardVerified ? buildFloorSnapshot(board.rooms) : null), [board, boardVerified]);

  const onQuickAction = useCallback(
    (key: QuickActionKey) => {
      // Every action sends something, so each needs a connection. Say so rather than failing silently.
      if (!isOnline) {
        toast.error(t("supervisorToday.actions.offline"));
        return;
      }
      switch (key) {
        case "shiftNote":
          setShowShiftNote(true);
          return;
        case "messageTeam":
          setShowBroadcast(true);
          return;
        case "messageStaff":
          // The picker explains a loading, failed or empty staff list itself.
          setShowPicker(true);
          return;
        case "handoff":
          // The handoff reports room counts; never send counts the app could not verify.
          if (!handoffSnapshot) {
            toast.error(t("supervisorToday.actions.handoffUnavailable"));
            return;
          }
          setHandoff(handoffSnapshot);
          return;
      }
    },
    [isOnline, handoffSnapshot, toast, t],
  );

  /** Role · shift status · rooms cleaned, from the live team snapshot; only what is known. */
  const describeRecipient = useCallback(
    (id: string, role: string | null): string | null => {
      const member = today.team.value?.members.find((m) => m.userId === id);
      const roleText = roleKey(role);
      const parts = [
        roleText ? t(roleText) : null,
        t(availabilityKey(member?.availability ?? "unknown")),
        member?.load && member.load.total > 0 ? t("supervisorComms.quick.progress", { done: member.load.done, count: member.load.total }) : null,
      ];
      return parts.filter(Boolean).join(" · ");
    },
    [today.team.value, t],
  );

  /** One sheet finishes dismissing before the composer presents, so the two never stack. */
  const openComposer = useCallback(
    (target: { id: string; name: string; role: string | null }) => {
      if (swapTimer.current) clearTimeout(swapTimer.current);
      swapTimer.current = setTimeout(
        () => setMessageTarget({ id: target.id, name: target.name, meta: describeRecipient(target.id, target.role) }),
        MODAL_SWAP_MS,
      );
    },
    [describeRecipient],
  );

  const onPickRecipient = useCallback(
    (member: AssignableStaff) => {
      setShowPicker(false);
      openComposer({ id: member.userId, name: member.name, role: member.role });
    },
    [openComposer],
  );

  const onQuickViewMessage = useCallback(
    (view: StaffQuickView) => {
      setQuickViewId(null);
      openComposer({ id: view.userId, name: view.name ?? t("supervisorToday.attention.someone"), role: view.role });
    },
    [openComposer, t],
  );

  const onQuickViewAssignments = useCallback(() => {
    setQuickViewId(null);
    go("team");
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="supervisor-today">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <TodayHeader
          greeting={greeting}
          dateLine={dateLine}
          name={name.trim() || "?"}
          unreadCount={unreadCount}
          topInset={insets.top}
          t={t}
          onOpenNotifications={() => go("notifications")}
          onOpenProfile={() => router.push("/(app)/profile" as never)}
        />

        {!isOnline ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.offline, { color: theme.status.pickup, backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
            accessibilityLiveRegion="polite"
            testID="today-offline"
          >
            {t("supervisorToday.status.offline")}
          </Text>
        ) : null}

        <View style={styles.body}>
          <ReadinessCard readiness={today.readiness} freshness={freshness} t={t} onOpen={() => go("rooms")} onRetry={onRefresh} />
          <AttentionPreview
            attention={today.attention}
            board={today.sources.board}
            blockedTasks={today.sources.blockedTasks}
            zone={zone}
            language={language}
            t={t}
            onOpenItem={setAttentionItemId}
            onViewAll={() => go("attention")}
            onRetry={onRefresh}
          />
          <TeamPulseCard team={today.team} t={t} onOpenAssignments={() => go("team")} onOpenMember={setQuickViewId} onRetry={onRefresh} />
          <QuickActions t={t} onAction={onQuickAction} />
        </View>
      </ScrollView>

      <AttentionSheetHost
        itemId={attentionItemId}
        today={today}
        isOnline={isOnline}
        zone={zone}
        language={language}
        onClose={() => setAttentionItemId(null)}
      />
      <ShiftNoteModal visible={showShiftNote} tenantId={tenantId} isOnline={isOnline} onClose={() => setShowShiftNote(false)} />
      <BroadcastModal visible={showBroadcast} isOnline={isOnline} onClose={() => setShowBroadcast(false)} />
      {handoff ? <EndShiftModal visible snapshot={handoff} onClose={() => setHandoff(null)} /> : null}
      <StaffPickerSheet
        visible={showPicker}
        staff={today.sources.staff}
        team={today.team}
        viewerId={userId}
        onSelect={onPickRecipient}
        onRetry={onRefresh}
        onClose={() => setShowPicker(false)}
      />
      <StaffQuickViewSheet
        userId={quickViewId}
        team={today.team}
        isOnline={isOnline}
        onMessage={onQuickViewMessage}
        onViewAssignments={onQuickViewAssignments}
        onClose={() => setQuickViewId(null)}
      />
      <DirectMessageModal
        visible={messageTarget != null}
        recipientId={messageTarget?.id ?? null}
        recipientName={messageTarget?.name ?? null}
        recipientMeta={messageTarget?.meta ?? null}
        isOnline={isOnline}
        onClose={() => setMessageTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  // Bottom padding clears the floating assistant button the layout draws over every screen.
  content: { flexGrow: 1, paddingBottom: 110 },
  body: { paddingHorizontal: 18, paddingTop: 12, gap: 14 },
  offline: {
    marginHorizontal: 18,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 10,
    fontSize: 13,
    fontWeight: "600",
  },
});

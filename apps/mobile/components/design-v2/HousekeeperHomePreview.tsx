import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { ThemeMode } from "@/components/shared/tokens";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AiSurface } from "@/components/ui/AiSurface";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { LinearProgress } from "@/components/ui/LinearProgress";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DesignV2Scope } from "@/lib/design/DesignV2Scope";
import { useTheme } from "@/lib/theme/useTheme";
import { previewSample as sample } from "./previewSampleData";

type PreviewMode = "system" | ThemeMode;

const noop = () => undefined;

/** Reference composition for the V2 Housekeeper Home. Visual only: every control is inert, all
 *  figures come from `previewSampleData`, and it is reachable only through the flagged preview
 *  route. It is NOT the production Home screen. */
export function HousekeeperHomePreview() {
  const [mode, setMode] = useState<PreviewMode>("system");
  return (
    <DesignV2Scope mode={mode === "system" ? undefined : mode}>
      <PreviewBody mode={mode} onModeChange={setMode} />
    </DesignV2Scope>
  );
}

function PreviewBody({
  mode,
  onModeChange,
}: {
  mode: PreviewMode;
  onModeChange: (next: PreviewMode) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const room = sample.currentRoom;
  const checklistA11y = t("designV2Preview.checklistA11y", {
    done: room.checklistDone,
    total: room.checklistTotal,
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="design-v2-preview">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 8, paddingBottom: 96 + insets.bottom },
        ]}
      >
        {/* Preview-only chrome: banner + appearance toggle. Not part of the screen design. */}
        <View
          style={[styles.banner, { backgroundColor: theme.ai.soft, borderColor: theme.ai.line }]}
          accessibilityRole="summary"
        >
          <Ionicons name="flask-outline" size={16} color={theme.ai.primary} />
          <View style={styles.flex}>
            <AppText variant="label" tone="ai">
              {t("designV2Preview.banner")}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {t("designV2Preview.bannerBody")}
            </AppText>
          </View>
        </View>
        <SegmentedControl<PreviewMode>
          accessibilityLabel={t("designV2Preview.appearance")}
          value={mode}
          onChange={onModeChange}
          testID="design-v2-mode"
          options={[
            { key: "system", label: t("designV2Preview.system") },
            { key: "light", label: t("designV2Preview.light") },
            { key: "dark", label: t("designV2Preview.dark") },
          ]}
        />

        {/* 1. Header */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: theme.primaryAction }]}>
              <AppText variant="headline" tone="onAccent">
                P
              </AppText>
            </View>
            <AppText variant="headline">PatelRep</AppText>
          </View>
          <IconButton
            icon="notifications-outline"
            accessibilityLabel={t("designV2Preview.notifications")}
            badgeCount={sample.unreadNotifications}
            variant="tonal"
            onPress={noop}
          />
        </View>

        {/* 2. Greeting + shift status */}
        <View style={styles.gap4}>
          <AppText variant="title" accessibilityRole="header">
            {t("designV2Preview.greeting", { name: sample.person })}
          </AppText>
          <View style={styles.inline}>
            <View style={[styles.dot, { backgroundColor: theme.status.ready }]} />
            <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
            <AppText variant="caption" tone="secondary" style={styles.flex}>
              {t("designV2Preview.shiftStatus", {
                start: sample.shiftStart,
                end: sample.shiftEnd,
              })}
            </AppText>
          </View>
        </View>

        {/* 3. Current room (hero) */}
        <Card style={styles.hero} testID="design-v2-current-room">
          <View style={styles.between}>
            <AppText variant="label" tone="secondary">
              {t("designV2Preview.currentRoom")}
            </AppText>
            <StatusBadge statusKey="inProgress" label={t("designV2Preview.stateInProgress")} />
          </View>
          <View style={styles.roomRow}>
            <AppText variant="display" numeric style={styles.roomNumber}>
              {room.number}
            </AppText>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">{t("designV2Preview.sampleRoomType")}</AppText>
              <View style={styles.inline}>
                <Ionicons name="stopwatch-outline" size={14} color={theme.textSecondary} />
                <AppText variant="caption" tone="secondary" numeric>
                  {t("designV2Preview.elapsed", { minutes: room.elapsedMinutes })}
                </AppText>
              </View>
            </View>
          </View>
          <View style={styles.gap6}>
            <View style={styles.between}>
              <AppText variant="caption" tone="secondary">
                {t("designV2Preview.checklist")}
              </AppText>
              <AppText variant="caption" tone="secondary" numeric>
                {t("designV2Preview.checklistSteps", {
                  done: room.checklistDone,
                  total: room.checklistTotal,
                })}
              </AppText>
            </View>
            <LinearProgress
              value={room.checklistDone}
              total={room.checklistTotal}
              tone="inProgress"
              accessibilityLabel={checklistA11y}
            />
          </View>
          {/* 4. One primary action; secondary actions are guarded or tonal. */}
          <Button
            label={t("designV2Preview.continueCleaning")}
            icon="play"
            size="lg"
            onPress={noop}
            testID="design-v2-primary-action"
          />
          <View style={styles.actionRow}>
            <Button
              label={t("designV2Preview.reportIssue")}
              icon="flag-outline"
              variant="secondary"
              onPress={noop}
              style={styles.flex}
            />
            <Button
              label={t("designV2Preview.markClean")}
              variant="secondary"
              disabled
              onPress={noop}
              style={styles.flex}
              testID="design-v2-guarded-action"
            />
          </View>
          <AppText variant="micro" tone="muted">
            {t("designV2Preview.markCleanHint")}
          </AppText>
        </Card>

        {/* 5. Next up (compact) */}
        <Card style={styles.compact}>
          <View style={styles.flex}>
            <AppText variant="caption" tone="secondary">
              {t("designV2Preview.nextUp")}
            </AppText>
            <View style={styles.inline}>
              <AppText variant="headline" numeric>
                {sample.nextUp.number}
              </AppText>
              <AppText variant="body" tone="secondary" style={styles.flex} numberOfLines={2}>
                {t("designV2Preview.sampleNextType")}
              </AppText>
            </View>
            <AppText variant="caption" tone="muted" numeric>
              {t("designV2Preview.nextUpMeta", { minutes: sample.nextUp.estimateMinutes })}
            </AppText>
          </View>
          <StatusBadge statusKey="dirty" label={t("designV2Preview.stateDirty")} />
        </Card>

        {/* 6. Supervisor note */}
        <View
          style={[
            styles.note,
            { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
          ]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.status.pickup} />
          <View style={styles.flex}>
            <AppText variant="label" style={{ color: theme.status.pickup }}>
              {t("designV2Preview.supervisorNote")}
              {" · "}
              {t("designV2Preview.noteFrom", { name: sample.supervisor })}
            </AppText>
            <AppText variant="body">{t("designV2Preview.noteBody")}</AppText>
          </View>
        </View>

        {/* 7. Daily progress summary */}
        <View style={styles.gap8}>
          <AppText variant="headline" accessibilityRole="header">
            {t("designV2Preview.today")}
          </AppText>
          <View style={styles.metrics}>
            <MetricCard
              label={t("designV2Preview.done")}
              value={String(sample.today.done)}
              caption={t("designV2Preview.roomsOf", { total: sample.today.total })}
              icon="checkmark-circle-outline"
              tone="ready"
            />
            <MetricCard
              label={t("designV2Preview.remaining")}
              value={String(sample.today.total - sample.today.done)}
              icon="bed-outline"
              tone="pickup"
            />
            <MetricCard
              label={t("designV2Preview.average")}
              value={t("designV2Preview.minutesShort", { minutes: sample.today.averageMinutes })}
              icon="timer-outline"
            />
          </View>
        </View>

        {/* 8. AI briefing (subtle, never a primary action) */}
        <AiSurface
          title={t("designV2Preview.aiTitle")}
          aiLabel={t("designV2Preview.aiLabel")}
          provenance={t("designV2Preview.aiProvenance")}
        >
          <AppText variant="body">{t("designV2Preview.aiBody")}</AppText>
        </AiSurface>
      </ScrollView>

      {/* 9. Bottom navigation (dark in both modes). Static mock: not wired to the router. */}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: theme.shell.bg,
            borderColor: theme.shell.line,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
        accessibilityRole="tablist"
      >
        {TABS.map((tab) => {
          const active = tab.key === "home";
          return (
            <View
              key={tab.key}
              accessible
              accessibilityRole="tab"
              accessibilityLabel={t(tab.labelKey)}
              accessibilityState={{ selected: active }}
              style={[styles.tab, active ? { backgroundColor: theme.shell.raised } : null]}
            >
              <Ionicons
                name={active ? tab.activeIcon : tab.icon}
                size={22}
                color={active ? theme.shell.ink : theme.shell.ink2}
              />
              <AppText
                variant="micro"
                style={{
                  color: active ? theme.shell.ink : theme.shell.ink2,
                  fontWeight: active ? "700" : "500",
                }}
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
              >
                {t(tab.labelKey)}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const TABS = [
  { key: "home", labelKey: "tabs.home", icon: "grid-outline", activeIcon: "grid" },
  { key: "rooms", labelKey: "tabs.myRooms", icon: "bed-outline", activeIcon: "bed" },
  {
    key: "tasks",
    labelKey: "tabs.tasks",
    icon: "checkmark-circle-outline",
    activeIcon: "checkmark-circle",
  },
  { key: "me", labelKey: "tabs.profile", icon: "person-outline", activeIcon: "person" },
] as const;

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spaceV2.page, gap: spaceV2.lg },
  flex: { flex: 1 },
  banner: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: radiusV2.control,
    padding: 12,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: {
    width: 32,
    height: 32,
    borderRadius: radiusV2.input,
    alignItems: "center",
    justifyContent: "center",
  },
  gap4: { gap: 4 },
  gap6: { gap: 6 },
  gap8: { gap: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hero: { gap: 14, padding: 18, borderRadius: radiusV2.hero },
  roomRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  roomNumber: { fontSize: 44, lineHeight: 50 },
  actionRow: { flexDirection: "row", gap: 8 },
  compact: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  note: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: radiusV2.card,
    padding: 14,
    alignItems: "flex-start",
  },
  metrics: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tabBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 4,
    paddingTop: 8,
    paddingHorizontal: 8,
    borderTopWidth: 1,
  },
  tab: {
    flex: 1,
    minHeight: 52,
    borderRadius: radiusV2.control,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
});

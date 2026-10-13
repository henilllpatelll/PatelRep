import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.5;

import type { TaskSyncKey } from "@/lib/tasks/offline/syncStatus";

export type SyncKey = TaskSyncKey;

const SYNC_ICON: Record<SyncKey, ComponentProps<typeof Ionicons>["name"]> = {
  synced: "cloud-done-outline",
  syncing: "sync-outline",
  offline: "cloud-offline-outline",
  pending: "cloud-upload-outline",
  stale: "alert-circle-outline",
  attention: "warning-outline",
};

export type Segment = "mine" | "available";

/** A number, or `null` when it cannot be determined (rendered as an em dash, never as 0). */
export interface SummaryValue {
  value: number | null;
  atLeast?: boolean;
}

interface TasksHeaderProps {
  dateLabel: string;
  sync: SyncKey;
  summary: { remaining: SummaryValue; inProgress: SummaryValue; doneToday: SummaryValue };
  segment: Segment;
  counts: { mine: number | null; available: number | null };
  onSegmentChange: (segment: Segment) => void;
  onOpenHistory: () => void;
  /** Tapping the sync chip opens the Sync Status sheet. */
  onOpenSync: () => void;
  topInset: number;
}

function Stat({ label, stat }: { label: string; stat: SummaryValue }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const known = stat.value !== null;
  const shown = known ? `${stat.value}${stat.atLeast ? "+" : ""}` : "—";
  const spoken = known
    ? stat.atLeast
      ? t("tasks.hk.summary.atLeast", { count: stat.value as number })
      : String(stat.value)
    : t("tasks.hk.summary.unavailable");
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${spoken}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statValue, { color: theme.shell.ink }]}>
        {shown}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statLabel, { color: theme.shell.ink3 }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function TasksHeader({
  dateLabel,
  sync,
  summary,
  segment,
  counts,
  onSegmentChange,
  onOpenHistory,
  onOpenSync,
  topInset,
}: TasksHeaderProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const syncColor = sync === "synced" ? theme.shell.ink3 : sync === "attention" ? theme.status.dirty : theme.status.pickup;
  const syncText = t(`tasks.hk.sync.${sync}`);

  const segments: { key: Segment; label: string; a11y: string }[] = [
    {
      key: "mine",
      label: `${t("tasks.hk.segments.myWork")}${counts.mine === null ? "" : ` (${counts.mine})`}`,
      a11y:
        counts.mine === null
          ? t("tasks.hk.segments.myWork")
          : t("tasks.hk.segments.myWorkA11y", { count: counts.mine }),
    },
    {
      key: "available",
      label: `${t("tasks.hk.segments.available")}${counts.available === null ? "" : ` (${counts.available})`}`,
      a11y:
        counts.available === null
          ? t("tasks.hk.segments.available")
          : t("tasks.hk.segments.availableA11y", { count: counts.available }),
    },
  ];

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: theme.shell.bg, borderBottomColor: theme.shell.line, paddingTop: topInset + 12 },
      ]}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityRole="header"
            style={[styles.title, { color: theme.shell.ink }]}
          >
            {t("tasks.hk.title")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.shell.ink3 }]}>
            {dateLabel}
          </Text>
        </View>
        <View style={styles.right}>
          {/* The words, not just the colour or icon, carry the state; the whole chip opens Sync Status. */}
          <Pressable
            onPress={onOpenSync}
            accessibilityRole="button"
            accessibilityLiveRegion="polite"
            accessibilityLabel={syncText}
            accessibilityHint={t("tasks.hk.offline.sheet.titleOnline")}
            hitSlop={6}
            style={styles.sync}
            testID="sync-indicator"
          >
            <Ionicons name={SYNC_ICON[sync]} size={14} color={syncColor} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.syncText, { color: syncColor }]}>
              {syncText}
            </Text>
          </Pressable>
          <Pressable
            onPress={onOpenHistory}
            accessibilityRole="button"
            accessibilityLabel={t("tasks.hk.history")}
            hitSlop={6}
            style={[styles.historyBtn, { borderColor: theme.shell.line }]}
          >
            <Ionicons name="time-outline" size={20} color={theme.shell.ink2} />
          </Pressable>
        </View>
      </View>

      <View
        style={[styles.summary, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
        accessibilityLabel={t("tasks.hk.summary.label")}
      >
        <Stat label={t("tasks.hk.summary.remaining")} stat={summary.remaining} />
        <Stat label={t("tasks.hk.summary.inProgress")} stat={summary.inProgress} />
        <Stat label={t("tasks.hk.summary.doneToday")} stat={summary.doneToday} />
      </View>

      <View
        accessibilityRole="tablist"
        accessibilityLabel={t("tasks.hk.segments.label")}
        style={[styles.segmented, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
      >
        {segments.map((item) => {
          const active = segment === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSegmentChange(item.key)}
              accessibilityRole="tab"
              accessibilityLabel={item.a11y}
              accessibilityState={{ selected: active }}
              testID={`segment-${item.key}`}
              style={[styles.segment, active && { backgroundColor: theme.primaryAction }]}
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                numberOfLines={1}
                style={[styles.segmentText, { color: active ? theme.onPrimary : theme.shell.ink2 }]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: 1, paddingHorizontal: 18, paddingBottom: 14, gap: 12 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: 28, fontWeight: "700", lineHeight: 33 },
  date: { fontSize: 12.5, marginTop: 2 },
  right: { alignItems: "flex-end", gap: 8 },
  sync: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32 },
  syncText: { fontSize: 12, fontWeight: "600" },
  historyBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  summary: { flexDirection: "row", borderWidth: 1, borderRadius: 14, paddingVertical: 10 },
  stat: { flex: 1, alignItems: "center", gap: 2, paddingHorizontal: 4 },
  statValue: { fontFamily: monoFont, fontSize: 20, fontWeight: "800" },
  statLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  segmented: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 48, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentText: { fontSize: 14.5, fontWeight: "700" },
});

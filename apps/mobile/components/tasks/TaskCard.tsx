import type { ComponentProps } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { lightTheme, monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { getTaskRoomNumber, type TaskBucket, type TaskQueueEntry } from "@/lib/ai/tasks";

/* ─── Task card — Evening Lobby work card for the Tasks tab ─────────────────
   Mirrors the room-card language: left urgency rail, identity tile, big
   readable title, quiet meta chips. Priority chips only appear when they
   change behavior (urgent/high); "normal" stays silent. */

type IconName = ComponentProps<typeof Ionicons>["name"];

/** TYPE_META is consumed as a plain object (no hook) — sourced from the static
 * `lightTheme` export (identical values to the app's only active theme this
 * milestone), mirroring WorkOrderCard's CATEGORY_META precedent. */
const TYPE_META: Record<string, { icon: IconName; fg: string; bg: string }> = {
  housekeeping: { icon: "bed-outline", fg: lightTheme.primary, bg: lightTheme.primarySoft },
  engineering: { icon: "construct-outline", fg: lightTheme.status.pickup, bg: lightTheme.status.pickupSoft },
  guest_request: { icon: "person-outline", fg: lightTheme.status.clean, bg: lightTheme.status.cleanSoft },
  lost_found: { icon: "search-outline", fg: lightTheme.accentBrass, bg: lightTheme.accentBrassSoft },
  general: { icon: "clipboard-outline", fg: lightTheme.textSecondary, bg: lightTheme.surfaceMuted },
};

const BUCKET_RAIL: Record<TaskBucket, string> = {
  overdue: lightTheme.status.dirty,
  now: lightTheme.status.pickup,
  today: lightTheme.border,
};

function formatClock(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

interface TaskCardProps {
  entry: TaskQueueEntry;
  confirming: boolean;
  busy: boolean;
  locale: string;
  onRequestComplete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TaskCard({ entry, confirming, busy, locale, onRequestComplete, onConfirm, onCancel }: TaskCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { task, bucket, overdueMinutes } = entry;

  const rawType = (task.task_type ?? "general").toLowerCase();
  const typeKey = TYPE_META[rawType] ? rawType : "general";
  const type = TYPE_META[typeKey];
  const room = getTaskRoomNumber(task);
  const priority = (task.priority ?? "normal").toLowerCase();
  const isUrgent = priority === "urgent" || priority === "high";
  const isGuest = task.source === "guest" || task.task_type === "guest_request";
  const inProgress = task.status === "in_progress";
  const dueLabel = formatClock(task.due_at, locale);

  const overdueLabel =
    overdueMinutes == null
      ? null
      : overdueMinutes >= 60
        ? t("tasks.overdueByHours", { hours: Math.floor(overdueMinutes / 60), minutes: overdueMinutes % 60 })
        : t("tasks.overdueBy", { minutes: overdueMinutes });

  const doneBtnBorderColor = confirming ? theme.primaryLine : theme.border;
  const doneBtnBg = confirming ? theme.primarySoft : theme.surfaceSubtle;
  const doneIconColor = confirming ? theme.primaryAction : theme.textDisabled;

  return (
    <View testID={`task-${task.id}`}>
      <Card style={[styles.cardLayoutOverrides, bucket === "overdue" && { borderColor: theme.status.dirtyLine }]}>
        <View style={[styles.rail, { backgroundColor: BUCKET_RAIL[bucket] }]} />

        <View style={styles.main}>
          <View
            accessible
            accessibilityLabel={t(`tasks.typeLabel.${typeKey}`)}
            style={[styles.typeTile, { backgroundColor: type.bg }]}
          >
            <Ionicons name={type.icon} size={17} color={type.fg} />
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
                {task.title}
              </Text>
              {task.ai_suggested ? (
                <View style={[styles.aiTag, { backgroundColor: theme.ai.soft, borderColor: theme.ai.line }]}>
                  <Ionicons name="sparkles" size={8} color={theme.ai.primary} />
                  <Text style={[styles.aiTagText, { color: theme.ai.primary }]}>AI</Text>
                </View>
              ) : null}
            </View>

            {task.description ? (
              <Text style={[styles.description, { color: theme.textMuted }]} numberOfLines={2}>
                {task.description}
              </Text>
            ) : null}

            <View style={styles.metaRow}>
              {isUrgent ? <StatusBadge statusKey="urgent" label={priority.toUpperCase()} /> : null}
              {inProgress ? <StatusBadge statusKey="inProgress" label={t("tasks.statusInProgress")} /> : null}
              {room ? (
                <View style={styles.roomChip}>
                  <Ionicons name="bed-outline" size={10} color={theme.textSecondary} />
                  <Text style={[styles.roomChipText, { color: theme.textSecondary }]}>{room}</Text>
                </View>
              ) : null}
              {isGuest ? (
                <View style={styles.guestChip}>
                  <Ionicons name="person-outline" size={10} color={theme.status.clean} />
                  <Text style={[styles.guestChipText, { color: theme.status.clean }]}>{t("tasks.guestTag")}</Text>
                </View>
              ) : null}
              {overdueLabel ? (
                <StatusBadge statusKey="overdue" label={overdueLabel} style={styles.overdueBadge} />
              ) : dueLabel ? (
                <View style={styles.dueRow}>
                  <Ionicons name="time-outline" size={11} color={theme.textMuted} />
                  <Text style={[styles.dueText, { color: theme.textMuted }]}>{t("tasks.dueAt", { time: dueLabel })}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <TouchableOpacity
            accessibilityLabel={t("tasks.markDone", { title: task.title })}
            onPress={onRequestComplete}
            disabled={busy || confirming}
            style={[styles.doneBtn, { borderColor: doneBtnBorderColor, backgroundColor: doneBtnBg }]}
            hitSlop={8}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.primaryAction} />
            ) : (
              <Ionicons name="checkmark" size={17} color={doneIconColor} />
            )}
          </TouchableOpacity>
        </View>

        {confirming ? (
          <View style={[styles.confirmRow, { borderTopColor: theme.borderSubtle }]}>
            <Text style={[styles.confirmLabel, { color: theme.textSecondary }]}>{t("tasks.confirmComplete")}</Text>
            <Button label={t("tasks.confirmYes")} onPress={onConfirm} variant="primary" size="sm" icon="checkmark" />
            <Button label={t("common.cancel")} onPress={onCancel} variant="secondary" size="sm" />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  cardLayoutOverrides: {
    position: "relative",
    overflow: "hidden",
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
    gap: 10,
  },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },

  main: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  typeTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  body: { flex: 1, minWidth: 0, gap: 5 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  title: { flexShrink: 1, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  description: { fontSize: 12.5, lineHeight: 17 },

  aiTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  aiTagText: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5 },

  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 },
  overdueBadge: { marginLeft: "auto" },
  roomChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  roomChipText: { fontSize: 12, fontWeight: "700", fontFamily: monoFont },
  guestChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  guestChipText: { fontSize: 11.5, fontWeight: "700" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto" },
  dueText: { fontSize: 11, fontFamily: monoFont },

  doneBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },

  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  confirmLabel: { flex: 1, fontSize: 12.5, fontWeight: "700" },
});

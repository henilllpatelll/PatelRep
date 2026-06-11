import type { ComponentProps } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { C, R, monoFont } from "@/components/shared/tokens";
import { getTaskRoomNumber, type TaskBucket, type TaskQueueEntry } from "@/lib/ai/tasks";

/* ─── Task card — Evening Lobby work card for the Tasks tab ─────────────────
   Mirrors the room-card language: left urgency rail, identity tile, big
   readable title, quiet meta chips. Priority chips only appear when they
   change behavior (urgent/high); "normal" stays silent. */

type IconName = ComponentProps<typeof Ionicons>["name"];

const TYPE_META: Record<string, { icon: IconName; fg: string; bg: string }> = {
  housekeeping: { icon: "bed-outline", fg: C.primary, bg: C.accentSoft },
  engineering: { icon: "construct-outline", fg: C.caution, bg: C.cautionSoft },
  guest_request: { icon: "person-outline", fg: C.info, bg: C.infoSoft },
  lost_found: { icon: "search-outline", fg: C.brass, bg: C.brassSoft },
  general: { icon: "clipboard-outline", fg: C.ink2, bg: C.surface3 },
};

const BUCKET_RAIL: Record<TaskBucket, string> = {
  overdue: C.alert,
  now: C.caution,
  today: C.line,
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

  return (
    <View style={[styles.card, bucket === "overdue" && styles.cardOverdue]} testID={`task-${task.id}`}>
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
            <Text style={styles.title} numberOfLines={2}>
              {task.title}
            </Text>
            {task.ai_suggested ? (
              <View style={styles.aiTag}>
                <Ionicons name="sparkles" size={8} color={C.ai} />
                <Text style={styles.aiTagText}>AI</Text>
              </View>
            ) : null}
          </View>

          {task.description ? (
            <Text style={styles.description} numberOfLines={2}>
              {task.description}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            {isUrgent ? (
              <View style={styles.urgentChip}>
                <Ionicons name="flash" size={9} color={C.alert} />
                <Text style={styles.urgentChipText}>{priority.toUpperCase()}</Text>
              </View>
            ) : null}
            {inProgress ? (
              <View style={styles.progressChip}>
                <Text style={styles.progressChipText}>{t("tasks.statusInProgress")}</Text>
              </View>
            ) : null}
            {room ? (
              <View style={styles.roomChip}>
                <Ionicons name="bed-outline" size={10} color={C.ink2} />
                <Text style={styles.roomChipText}>{room}</Text>
              </View>
            ) : null}
            {isGuest ? (
              <View style={styles.guestChip}>
                <Ionicons name="person-outline" size={10} color={C.info} />
                <Text style={styles.guestChipText}>{t("tasks.guestTag")}</Text>
              </View>
            ) : null}
            {overdueLabel ? (
              <Text style={styles.overdueText}>{overdueLabel}</Text>
            ) : dueLabel ? (
              <View style={styles.dueRow}>
                <Ionicons name="time-outline" size={11} color={C.ink3} />
                <Text style={styles.dueText}>{t("tasks.dueAt", { time: dueLabel })}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <TouchableOpacity
          accessibilityLabel={t("tasks.markDone", { title: task.title })}
          onPress={onRequestComplete}
          disabled={busy || confirming}
          style={[styles.doneBtn, confirming && styles.doneBtnActive]}
          hitSlop={8}
        >
          {busy ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <Ionicons name="checkmark" size={17} color={confirming ? C.accent : C.ink4} />
          )}
        </TouchableOpacity>
      </View>

      {confirming ? (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmLabel}>{t("tasks.confirmComplete")}</Text>
          <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} activeOpacity={0.85}>
            <Ionicons name="checkmark" size={13} color="#fff" />
            <Text style={styles.confirmBtnText}>{t("tasks.confirmYes")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.85}>
            <Text style={styles.cancelBtnText}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
    gap: 10,
    shadowColor: C.ink,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardOverdue: { borderColor: C.alertLine },
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
  title: { flexShrink: 1, color: C.ink, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  description: { color: C.ink3, fontSize: 12.5, lineHeight: 17 },

  aiTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: C.aiSoft,
    borderWidth: 1,
    borderColor: C.aiLine,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  aiTagText: { color: C.ai, fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5 },

  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 },
  urgentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: C.alertSoft,
    borderWidth: 1,
    borderColor: C.alertLine,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  urgentChipText: { color: C.alert, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  progressChip: {
    backgroundColor: C.cautionSoft,
    borderWidth: 1,
    borderColor: C.cautionLine,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  progressChipText: { color: C.caution, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  roomChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  roomChipText: { color: C.ink2, fontSize: 12, fontWeight: "700", fontFamily: monoFont },
  guestChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  guestChipText: { color: C.info, fontSize: 11.5, fontWeight: "700" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto" },
  dueText: { color: C.ink3, fontSize: 11, fontFamily: monoFont },
  overdueText: { marginLeft: "auto", color: C.alert, fontSize: 11, fontWeight: "800", fontFamily: monoFont },

  doneBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: C.line,
    backgroundColor: C.surface2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  doneBtnActive: { borderColor: C.accentLine, backgroundColor: C.accentSoft },

  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderTopWidth: 1,
    borderTopColor: C.line2,
    paddingTop: 10,
  },
  confirmLabel: { flex: 1, color: C.ink2, fontSize: 12.5, fontWeight: "700" },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.accent,
    borderRadius: 9,
    minHeight: 40,
    paddingHorizontal: 13,
    justifyContent: "center",
  },
  confirmBtnText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  cancelBtn: {
    minHeight: 40,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtnText: { color: C.ink2, fontSize: 12.5, fontWeight: "700" },
});

import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { lightTheme, monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  dueState,
  formatClock,
  formatDuration,
  minutesSince,
  workOrderLocation,
  type WorkOrder,
} from "@/lib/engineering/workOrders";
import { isOverdue, workOrderLabel, type QueueView } from "@/lib/engineering/workQueue";

/* ─── Work-order card — the one card for every engineering queue ────────────
   Reading order: (1) priority and title, (2) room/location and status, (3) due
   time, owner or wait context, (4) one primary action. Priority is always a
   word, never only a colour; emergency is the strongest treatment, urgent the
   next, normal stays neutral and low is quiet. */

type IconName = ComponentProps<typeof Ionicons>["name"];

/** CATEGORY_META is consumed as a plain object (no hook) by [woId].tsx and
 * EngineerHome.tsx — both out of this plan's scope — so it stays sourced
 * from the static `lightTheme` export (identical values to the app's only
 * active theme this milestone) rather than the reactive `useTheme()` hook. */
export const CATEGORY_META: Record<string, { icon: IconName; fg: string; bg: string }> = {
  plumbing: {
    icon: "water-outline",
    fg: lightTheme.status.clean,
    bg: lightTheme.status.cleanSoft,
  },
  electrical: {
    icon: "flash-outline",
    fg: lightTheme.status.pickup,
    bg: lightTheme.status.pickupSoft,
  },
  hvac: {
    icon: "thermometer-outline",
    fg: lightTheme.primary,
    bg: lightTheme.primarySoft,
  },
  furniture: {
    icon: "bed-outline",
    fg: lightTheme.accentBrass,
    bg: lightTheme.accentBrassSoft,
  },
  appliance: {
    icon: "tv-outline",
    fg: lightTheme.status.clean,
    bg: lightTheme.status.cleanSoft,
  },
  structural: {
    icon: "business-outline",
    fg: lightTheme.textSecondary,
    bg: lightTheme.surfaceMuted,
  },
  safety: {
    icon: "warning-outline",
    fg: lightTheme.status.dirty,
    bg: lightTheme.status.dirtySoft,
  },
  doors_locks: {
    icon: "key-outline",
    fg: lightTheme.textSecondary,
    bg: lightTheme.surfaceMuted,
  },
  painting: {
    icon: "color-fill-outline",
    fg: lightTheme.accentBrass,
    bg: lightTheme.accentBrassSoft,
  },
  general: {
    icon: "construct-outline",
    fg: lightTheme.textSecondary,
    bg: lightTheme.surfaceMuted,
  },
};

export interface WorkOrderCardProps {
  wo: WorkOrder;
  locale: string;
  /** Which queue is drawing the card; picks the context line and the primary action. */
  view: QueueView;
  onPress: () => void;
  /** Present only when the viewer may claim this order (open, unclaimed, role allows it). */
  onClaim?: () => void;
  claiming?: boolean;
  /** A claim is saved on this phone and waiting to sync — not confirmed by the server. */
  claimQueued?: boolean;
}

function holdReasonKey(code: string | null | undefined): string {
  if (!code) return "workQueue.holdReasonUnrecorded";
  return ["awaiting_parts", "awaiting_vendor", "schedule_deferral", "safety_review"].includes(code)
    ? `workOrders.holdReason.${code}`
    : "workQueue.holdReasonOther";
}

export function WorkOrderCard({ wo, locale, view, onPress, onClaim, claiming, claimQueued }: WorkOrderCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
  const category = CATEGORY_META[categoryKey];
  const { room, text } = workOrderLocation(wo);
  const number = workOrderLabel(wo);
  const overdue = isOverdue(wo);
  const due = dueState(wo, locale);
  const emergency = wo.priority === "emergency";
  const urgent = wo.priority === "urgent";
  const finished = wo.status === "completed" || wo.status === "cancelled";

  const railColor =
    emergency || urgent || overdue ? theme.status.dirty : wo.status === "on_hold" ? theme.status.pickup : theme.border;
  const priorityColor =
    emergency || urgent ? theme.status.dirty : wo.priority === "low" ? theme.textDisabled : theme.textSecondary;
  const priorityLabel = t(`workQueue.priority.${wo.priority}`);
  const statusLabel = t(`workOrders.status.${wo.status}`);

  const codeLine = [number, room ? t("workQueue.roomLabel", { room }) : text].filter(Boolean).join(" · ");

  const heldMinutes = wo.status === "on_hold" ? minutesSince(wo.held_since) : null;
  const updatedMinutes = minutesSince(wo.updated_at);
  const onClock = wo.status === "in_progress" ? minutesSince(wo.started_at) : null;
  const doneClock = finished ? formatClock(wo.completed_at ?? wo.updated_at, locale) : null;

  /** The third line: whichever of due / owner / wait matters for the queue being read. */
  const context: string[] = [];
  if (view === "team" || view === "waiting") {
    context.push(
      wo.assigned_to_name
        ? t("workQueue.assignedTo", { name: wo.assigned_to_name })
        : wo.assigned_to
          ? t("workQueue.assignedUnknown")
          : t("workQueue.unassigned"),
    );
  }
  if (view === "done") {
    if (doneClock)
      context.push(t(wo.status === "cancelled" ? "workQueue.cancelledAt" : "workQueue.doneAt", { time: doneClock }));
    if (wo.assigned_to_name) context.push(wo.assigned_to_name);
  }
  if (wo.status === "on_hold") {
    context.push(t(holdReasonKey(wo.hold_reason_code)));
    if (heldMinutes != null) context.push(t("workQueue.waitingFor", { time: formatDuration(heldMinutes) }));
    if (view === "waiting" && updatedMinutes != null)
      context.push(t("workQueue.updatedAgo", { time: formatDuration(updatedMinutes) }));
  }
  if (view === "available" && minutesSince(wo.created_at) != null) {
    context.push(
      t("workQueue.reportedAgo", {
        time: formatDuration(minutesSince(wo.created_at) as number),
      }),
    );
  }
  if (onClock != null && view !== "done") context.push(t("workOrders.onClock", { time: formatDuration(onClock) }));
  if (!finished && !overdue && due?.kind === "due") context.push(t("workOrders.dueAt", { time: due.clock }));
  if (wo.guest_reported) context.push(t("workQueue.guestReported"));

  const actionLabel =
    onClaim || claimQueued
      ? t("workQueue.action.claim")
      : view === "done"
        ? t("workQueue.action.viewReport")
        : view === "team" || (view === "waiting" && wo.status === "on_hold" && wo.assigned_to_name)
          ? t("workQueue.action.view")
          : wo.status === "in_progress"
            ? t("workQueue.action.continue")
            : wo.status === "on_hold"
              ? t("workQueue.action.viewHold")
              : t("workQueue.action.open");

  const a11y = [
    number,
    room ? t("workQueue.roomLabel", { room }) : text,
    wo.title,
    priorityLabel,
    statusLabel,
    overdue ? t("workQueue.overdue") : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card
      style={[
        styles.card,
        (emergency || urgent || overdue) && {
          borderColor: theme.status.dirtyLine,
        },
      ]}
    >
      <View style={[styles.rail, { backgroundColor: railColor, width: emergency ? 7 : 4 }]} />

      {/* The info area opens the order; the primary action is its sibling so buttons never nest. */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        testID={`wo-${wo.id}`}
        style={styles.info}
      >
        <View style={styles.topRow}>
          <Text style={[styles.code, { color: theme.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {codeLine || categoryKey}
          </Text>
          {overdue ? (
            <Text style={[styles.overdue, { color: theme.status.dirty }]} testID={`wo-overdue-${wo.id}`}>
              {t("workQueue.overdue")}
            </Text>
          ) : null}
        </View>

        <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3} maxFontSizeMultiplier={1.4}>
          {wo.title}
        </Text>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.priorityChip,
              emergency && { backgroundColor: theme.status.dirty },
              urgent && {
                backgroundColor: theme.status.dirtySoft,
                borderColor: theme.status.dirtyLine,
                borderWidth: 1,
              },
            ]}
          >
            {emergency || urgent ? (
              <Ionicons
                name={emergency ? "alert-circle" : "alert-circle-outline"}
                size={13}
                color={emergency ? theme.surface : theme.status.dirty}
              />
            ) : null}
            <Text
              style={[styles.priorityText, { color: emergency ? theme.surface : priorityColor }]}
              maxFontSizeMultiplier={1.4}
              testID={`wo-priority-${wo.id}`}
            >
              {priorityLabel}
            </Text>
          </View>
          <Text style={[styles.status, { color: theme.textSecondary }]} maxFontSizeMultiplier={1.4}>
            {statusLabel}
          </Text>
          <View style={styles.categoryRow} accessible accessibilityLabel={t(`workOrders.category.${categoryKey}`)}>
            <View style={[styles.categoryDot, { backgroundColor: category.bg }]}>
              <Ionicons name={category.icon} size={12} color={category.fg} />
            </View>
            <Text style={[styles.category, { color: theme.textMuted }]} maxFontSizeMultiplier={1.4}>
              {t(`workOrders.category.${categoryKey}`)}
            </Text>
          </View>
        </View>

        {context.length > 0 ? (
          <Text
            style={[styles.context, { color: overdue ? theme.status.dirty : theme.textSecondary }]}
            maxFontSizeMultiplier={1.4}
          >
            {overdue && due?.kind === "overdue"
              ? `${t("workOrders.overdueBy", { time: formatDuration(due.minutes) })} · `
              : ""}
            {context.join(" · ")}
          </Text>
        ) : overdue && due?.kind === "overdue" ? (
          <Text style={[styles.context, { color: theme.status.dirty }]}>
            {t("workOrders.overdueBy", { time: formatDuration(due.minutes) })}
          </Text>
        ) : null}
      </Pressable>

      {claimQueued ? (
        <View
          style={[
            styles.queued,
            {
              backgroundColor: theme.status.pickupSoft,
              borderColor: theme.status.pickupLine,
            },
          ]}
          accessibilityRole="text"
          testID={`wo-claim-queued-${wo.id}`}
        >
          <Ionicons name="cloud-upload-outline" size={15} color={theme.status.pickup} />
          <Text style={[styles.queuedText, { color: theme.status.pickup }]} maxFontSizeMultiplier={1.4}>
            {t("workQueue.claimQueued")}
          </Text>
        </View>
      ) : (
        <Button
          label={actionLabel}
          onPress={onClaim ?? onPress}
          loading={claiming}
          variant={onClaim ? "primary" : "secondary"}
          size="sm"
          icon={onClaim ? "hand-right-outline" : "chevron-forward"}
          style={styles.action}
          testID={onClaim ? `wo-claim-${wo.id}` : `wo-action-${wo.id}`}
          accessibilityLabel={onClaim ? t("workOrders.claimA11y", { title: wo.title }) : `${actionLabel}: ${wo.title}`}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    paddingLeft: 18,
    paddingRight: 14,
    paddingVertical: 14,
    gap: 10,
  },
  info: { gap: 8 },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  code: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontFamily: monoFont,
  },
  overdue: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  priorityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priorityText: { fontSize: 12, fontWeight: "800" },
  status: { fontSize: 13, fontWeight: "600" },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  categoryDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  category: { fontSize: 12.5 },
  context: { fontSize: 13, lineHeight: 18 },
  action: { marginTop: 2, alignSelf: "stretch" },
  queued: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 2,
  },
  queuedText: { flex: 1, fontSize: 13, fontWeight: "700" },
});

import { memo, useMemo, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { lightTheme, monoFont, type ThemeTokens } from "@/components/shared/tokens";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { formatDuration, minutesSince, workOrderLocation, type WorkOrder } from "@/lib/engineering/workOrders";
import {
  contextBadges,
  dueLabel,
  isEmphasised,
  isFinished,
  ownerLine,
  primaryAction,
  showsSecondaryAssign,
  statusTone,
  type BadgeKind,
  type CardActionKind,
  type ContextBadge,
  type DueLabel,
  type OwnerLine,
  type StatusTone,
} from "@/lib/engineering/workCard";
import { workOrderLabel, type QueueView } from "@/lib/engineering/workQueue";

/* ─── Work-order card — the one card for every engineering queue ────────────
   Reading order: (1) where and which order, with its priority word, (2) the issue, (3) its status and the
   verified hotel context, (4) when it is due, who has it or why it waits, (5) one primary action — plus a small
   Assign / Reassign for managers. Priority, overdue and status are always words, never only a colour. What the
   card leads with comes from `workCard.ts`; the screen decides who may claim or assign. */

type IconName = ComponentProps<typeof Ionicons>["name"];

type CategoryMeta = Record<string, { icon: IconName; fg: string; bg: string }>;

function buildCategoryMeta(src: ThemeTokens): CategoryMeta {
  return {
    plumbing: {
      icon: "water-outline",
      fg: src.status.clean,
      bg: src.status.cleanSoft,
    },
    electrical: {
      icon: "flash-outline",
      fg: src.status.pickup,
      bg: src.status.pickupSoft,
    },
    hvac: {
      icon: "thermometer-outline",
      fg: src.primary,
      bg: src.primarySoft,
    },
    furniture: {
      icon: "bed-outline",
      fg: src.accentBrass,
      bg: src.accentBrassSoft,
    },
    appliance: {
      icon: "tv-outline",
      fg: src.status.clean,
      bg: src.status.cleanSoft,
    },
    structural: {
      icon: "business-outline",
      fg: src.textSecondary,
      bg: src.surfaceMuted,
    },
    safety: {
      icon: "warning-outline",
      fg: src.status.dirty,
      bg: src.status.dirtySoft,
    },
    doors_locks: {
      icon: "key-outline",
      fg: src.textSecondary,
      bg: src.surfaceMuted,
    },
    painting: {
      icon: "color-fill-outline",
      fg: src.accentBrass,
      bg: src.accentBrassSoft,
    },
    general: {
      icon: "construct-outline",
      fg: src.textSecondary,
      bg: src.surfaceMuted,
    },
  };
}

/** CATEGORY_META is consumed as a plain object (no hook) by legacy call sites, so it stays sourced from the
 * static `lightTheme` export. Inside a V2 scope, `useCategoryMeta()` returns the same map built from the live
 * theme so the chips follow dark mode; outside it, it returns this exact legacy map. */
export const CATEGORY_META: CategoryMeta = buildCategoryMeta(lightTheme as unknown as ThemeTokens);

export function useCategoryMeta(): CategoryMeta {
  const v2 = useIsDesignV2();
  const theme = useTheme();
  return useMemo(() => (v2 ? buildCategoryMeta(theme) : CATEGORY_META), [v2, theme]);
}

export interface WorkOrderCardProps {
  wo: WorkOrder;
  locale: string;
  /** The hotel's IANA zone: due times and "today / tomorrow" are read in it, not the phone's. */
  timeZone?: string | null;
  /** Which queue is drawing the card; picks the context line and the primary action. */
  view: QueueView;
  /** The signed-in person, to tell their own work from a colleague's. */
  viewerId?: string | null;
  /** Floored to the minute by the screen so due and overdue labels move on without a data refresh. */
  now?: number;
  /** Opens the order. Stable per screen, so a card re-renders only when its own order changes. */
  onOpen: (wo: WorkOrder) => void;
  /** The viewer may claim this order (open, unclaimed, role allows it). */
  claimable?: boolean;
  onClaim?: (wo: WorkOrder) => void;
  claiming?: boolean;
  /** A claim is saved on this phone and waiting to sync — not confirmed by the server. */
  claimQueued?: boolean;
  /** A chief engineer / GM on an order that can still be assigned. */
  assignable?: boolean;
  onAssign?: (wo: WorkOrder) => void;
}

function holdReasonKey(code: string | null | undefined): string {
  if (!code) return "workQueue.holdReasonUnrecorded";
  return ["awaiting_parts", "awaiting_vendor", "schedule_deferral", "safety_review"].includes(code)
    ? `workOrders.holdReason.${code}`
    : "workQueue.holdReasonOther";
}

const ACTION_LABEL: Record<CardActionKind, string> = {
  claim: "workQueue.action.claim",
  continue: "workQueue.action.continue",
  open: "workQueue.action.open",
  reviewHold: "workQueue.action.reviewHold",
  viewRecord: "workQueue.action.viewRecord",
  review: "workQueue.action.review",
  assign: "engineeringTeam.assign.assignShort",
};

const ACTION_ICON: Record<CardActionKind, IconName> = {
  claim: "hand-right-outline",
  continue: "play-outline",
  open: "chevron-forward",
  reviewHold: "pause-outline",
  viewRecord: "document-text-outline",
  review: "eye-outline",
  assign: "person-add-outline",
};

const BADGE_ICON: Record<BadgeKind, IconName> = {
  occupied: "person-outline",
  vacant: "bed-outline",
  out_of_order: "close-circle-outline",
  out_of_service: "remove-circle-outline",
  unrecorded_down: "alert-circle-outline",
  guest: "megaphone-outline",
  equipment: "hardware-chip-outline",
};

function WorkOrderCardView({
  wo,
  locale,
  timeZone,
  view,
  viewerId,
  now,
  onOpen,
  claimable = false,
  onClaim,
  claiming,
  claimQueued,
  assignable = false,
  onAssign,
}: WorkOrderCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();

  const { room, text } = workOrderLocation(wo);
  const number = workOrderLabel(wo);
  const finished = isFinished(wo.status);
  const emphasised = isEmphasised(wo.priority);
  const emergency = wo.priority === "emergency";
  const clock = now != null ? new Date(now) : new Date();
  const due: DueLabel | null = dueLabel(wo, { now: clock, timeZone, language: locale });
  const overdue = due?.kind === "overdue";
  const badges = contextBadges(wo);

  const canClaim = claimable && onClaim != null;
  const canAssign = assignable && onAssign != null;
  const action = primaryAction(wo, { view, viewerId, claimable: canClaim, assignable: canAssign });
  const secondaryAssign = showsSecondaryAssign(action, { assignable: canAssign });

  const location = room ? t("workQueue.roomLabel", { room }) : text;
  const codeLine = [location, number].filter(Boolean).join(" · ");
  const priorityLabel = t(`workQueue.priority.${wo.priority}`);
  const statusLabel = t(`workOrders.status.${wo.status}`);

  const tone = TONES[statusTone(wo.status)](theme);
  const railColor = emphasised || overdue ? theme.status.dirty : wo.status === "on_hold" ? theme.status.pickup : theme.border;
  const priorityColor = emphasised ? theme.status.dirty : wo.priority === "low" ? theme.textDisabled : theme.textSecondary;

  const dueText = due ? dueLine(due, t) : null;
  const owner = ownerLine(wo, view, viewerId);
  const heldMinutes = wo.status === "on_hold" ? minutesSince(wo.held_since, clock) : null;
  const onClock = wo.status === "in_progress" && view !== "done" ? minutesSince(wo.started_at, clock) : null;
  const finishedAt = finished ? formatHotelTime(wo.completed_at ?? wo.updated_at, timeZone, locale) : null;
  const reportedMinutes = view === "available" ? minutesSince(wo.created_at, clock) : null;
  const updatedMinutes = view === "waiting" && wo.status === "on_hold" ? minutesSince(wo.updated_at, clock) : null;

  /** The supporting line: whoever has it, why it waits, and how long it has been going. */
  const details: string[] = [];
  if (owner) details.push(ownerText(owner, t));
  if (finishedAt) details.push(t(wo.status === "cancelled" ? "workQueue.cancelledAt" : "workQueue.doneAt", { time: finishedAt }));
  if (wo.status === "on_hold") {
    details.push(t(holdReasonKey(wo.hold_reason_code)));
    if (heldMinutes != null) details.push(t("workQueue.waitingFor", { time: formatDuration(heldMinutes) }));
    if (updatedMinutes != null) details.push(t("workQueue.updatedAgo", { time: formatDuration(updatedMinutes) }));
  }
  if (reportedMinutes != null) details.push(t("workQueue.reportedAgo", { time: formatDuration(reportedMinutes) }));
  if (onClock != null) details.push(t("workOrders.onClock", { time: formatDuration(onClock) }));

  const badgeText = badges.map((badge) => badgeLabel(badge, t));
  const a11y = [
    codeLine,
    wo.title,
    priorityLabel,
    statusLabel,
    ...badgeText,
    dueText,
    ...details,
  ]
    .filter(Boolean)
    .join(", ");

  const actionLabel = t(ACTION_LABEL[action]);
  const run = () => {
    if (action === "claim") onClaim?.(wo);
    else if (action === "assign") onAssign?.(wo);
    else onOpen(wo);
  };
  const assignLabel = wo.assigned_to ? t("engineeringTeam.assign.reassignShort") : t("engineeringTeam.assign.assignShort");

  return (
    <Card style={[styles.card, emphasised || overdue ? { borderColor: theme.status.dirtyLine } : null]}>
      <View style={[styles.rail, { backgroundColor: railColor, width: emergency ? 7 : 4 }]} />

      {/* The info area opens the order; the actions are its siblings so buttons never nest. */}
      <Pressable
        onPress={() => onOpen(wo)}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={t("workQueue.openHint")}
        testID={`wo-${wo.id}`}
        style={styles.info}
      >
        <View style={styles.topRow}>
          <Text style={[styles.code, x.label, x.num, { color: theme.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {codeLine || t(`workOrders.category.${wo.category && CATEGORY_META[wo.category] ? wo.category : "general"}`)}
          </Text>
          <View
            style={[
              styles.priorityChip,
              emergency && { backgroundColor: theme.status.dirty },
              wo.priority === "urgent" && {
                backgroundColor: theme.status.dirtySoft,
                borderColor: theme.status.dirtyLine,
                borderWidth: 1,
              },
            ]}
          >
            {emphasised ? (
              <Ionicons
                name={emergency ? "alert-circle" : "alert-circle-outline"}
                size={13}
                color={emergency ? theme.surface : theme.status.dirty}
              />
            ) : null}
            <Text
              style={[styles.priorityText, x.pill, { color: emergency ? theme.surface : priorityColor }]}
              maxFontSizeMultiplier={1.4}
              testID={`wo-priority-${wo.id}`}
            >
              {priorityLabel}
            </Text>
          </View>
        </View>

        <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2} maxFontSizeMultiplier={1.4}>
          {wo.title}
        </Text>

        <View style={styles.badgeRow}>
          <View style={[styles.pill, { backgroundColor: tone.bg, borderColor: tone.line }]} testID={`wo-status-${wo.id}`}>
            <Text style={[styles.pillText, { color: tone.fg }]} maxFontSizeMultiplier={1.4}>
              {statusLabel}
            </Text>
          </View>
          {badges.map((badge, index) => (
            <View
              key={badge.kind}
              style={[styles.pill, styles.contextPill, { borderColor: badgeColor(badge.kind, theme) }]}
              accessible
              accessibilityLabel={badgeText[index]}
              testID={`wo-badge-${badge.kind}-${wo.id}`}
            >
              <Ionicons name={BADGE_ICON[badge.kind]} size={12} color={badgeColor(badge.kind, theme)} />
              <Text style={[styles.pillText, { color: theme.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {badge.kind === "equipment" ? badge.label : badgeText[index]}
              </Text>
            </View>
          ))}
        </View>

        {dueText ? (
          <View style={styles.dueRow}>
            <Ionicons
              name={overdue ? "alert-circle" : "time-outline"}
              size={15}
              color={overdue ? theme.status.dirty : theme.textMuted}
            />
            <Text
              style={[styles.due, { color: overdue ? theme.status.dirty : theme.textSecondary }, overdue && styles.dueOverdue]}
              maxFontSizeMultiplier={1.4}
              testID={overdue ? `wo-overdue-${wo.id}` : `wo-due-${wo.id}`}
            >
              {dueText}
            </Text>
          </View>
        ) : null}

        {details.length > 0 ? (
          <Text style={[styles.details, { color: theme.textSecondary }]} numberOfLines={2} maxFontSizeMultiplier={1.4}>
            {details.join(" · ")}
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
        <View style={styles.actions}>
          <Button
            label={actionLabel}
            onPress={run}
            loading={action === "claim" ? claiming : false}
            variant={action === "claim" || action === "assign" ? "primary" : "secondary"}
            size="sm"
            icon={ACTION_ICON[action]}
            style={styles.primary}
            testID={action === "claim" ? `wo-claim-${wo.id}` : action === "assign" ? `wo-assign-${wo.id}` : `wo-action-${wo.id}`}
            accessibilityLabel={
              action === "claim"
                ? t("workOrders.claimA11y", { title: wo.title })
                : action === "assign"
                  ? `${wo.assigned_to ? t("engineeringTeam.assign.reassignTitle") : t("engineeringTeam.assign.title")}: ${wo.title}`
                  : `${actionLabel}: ${wo.title}`
            }
          />
          {secondaryAssign ? (
            <Button
              label={assignLabel}
              onPress={() => onAssign?.(wo)}
              variant="ghost"
              size="sm"
              icon="person-add-outline"
              style={styles.secondary}
              testID={`wo-assign-${wo.id}`}
              accessibilityLabel={`${wo.assigned_to ? t("engineeringTeam.assign.reassignTitle") : t("engineeringTeam.assign.title")}: ${wo.title}`}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

/** One order's card; re-renders only when its own order, queue, claim state or the minute changes. */
export const WorkOrderCard = memo(WorkOrderCardView);

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Theme = ReturnType<typeof useTheme>;

function dueLine(due: DueLabel, t: Translate): string {
  switch (due.kind) {
    case "overdue":
      return due.minutes >= 1 ? t("workQueue.card.overdueBy", { time: formatDuration(due.minutes) }) : t("workQueue.overdue");
    case "today":
      return t("workQueue.card.dueToday", { time: due.clock });
    case "tomorrow":
      return t("workQueue.card.dueTomorrow", { time: due.clock });
    case "later":
      return t("workQueue.card.dueOn", { date: due.date });
  }
}

function ownerText(owner: OwnerLine, t: Translate): string {
  switch (owner.kind) {
    case "you":
      return t("workQueue.assignedToYou");
    case "name":
      return t("workQueue.assignedTo", { name: owner.name });
    case "assigned":
      return t("workQueue.assignedUnknown");
    case "unassigned":
      return t("workQueue.unassigned");
  }
}

function badgeLabel(badge: ContextBadge, t: Translate): string {
  switch (badge.kind) {
    case "occupied":
      return t("engRooms.occupancy.occupied");
    case "vacant":
      return t("engRooms.occupancy.vacant");
    case "out_of_order":
    case "out_of_service":
    case "unrecorded_down":
      return t(`engRooms.availability.${badge.kind}`);
    case "guest":
      return t("workQueue.guestReported");
    case "equipment":
      return t("workQueue.card.equipment", { name: badge.label });
  }
}

function badgeColor(kind: BadgeKind, theme: Theme): string {
  switch (kind) {
    case "out_of_order":
    case "unrecorded_down":
      return theme.status.dirty;
    case "out_of_service":
      return theme.status.pickup;
    case "guest":
      return theme.status.clean;
    default:
      return theme.textMuted;
  }
}

const TONES: Record<StatusTone, (theme: Theme) => { fg: string; bg: string; line: string }> = {
  neutral: (theme) => ({ fg: theme.textSecondary, bg: theme.surfaceMuted, line: theme.border }),
  attention: (theme) => ({ fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine }),
  active: (theme) => ({ fg: theme.status.inProgress, bg: theme.status.inProgressSoft, line: theme.status.inProgressLine }),
  waiting: (theme) => ({ fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine }),
  done: (theme) => ({ fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine }),
  cancelled: (theme) => ({ fg: theme.status.outOfOrder, bg: theme.status.outOfOrderSoft, line: theme.status.outOfOrderLine }),
};

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    paddingLeft: 18,
    paddingRight: 14,
    paddingVertical: 12,
    gap: 10,
  },
  info: { gap: 7 },
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
  priorityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priorityText: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  contextPill: { backgroundColor: "transparent" },
  pillText: { flexShrink: 1, fontSize: 12.5, fontWeight: "600" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  due: { flexShrink: 1, fontSize: 13.5, lineHeight: 18, fontWeight: "600" },
  dueOverdue: { fontWeight: "800" },
  details: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  primary: { flexGrow: 1, flexBasis: 140 },
  secondary: { flexShrink: 0 },
  queued: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  queuedText: { flex: 1, fontSize: 13, fontWeight: "700" },
});

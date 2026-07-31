import type { ReactNode } from "react";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import {
  R,
  lightTheme,
  monoFont,
  type ThemeTokens,
} from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { Card } from "@/components/ui/Card";
import type { Room } from "@/stores/appStore";
import {
  getPrimaryTimingLine,
  getRoomBadges,
} from "@/lib/housekeeping/roomWorkflow";

/* ─── Status presentation (protected color contract, centralized) ─────────── */

export interface StatusMeta {
  label: string;
  bg: string;
  fg: string;
  border: string;
}

type StatusTokenKey =
  | "dirty"
  | "pickup"
  | "inProgress"
  | "clean"
  | "ready"
  | "outOfOrder";

type StatusDescriptor = {
  label: string;
  token: StatusTokenKey;
};

export const STATUS_META: Record<string, StatusDescriptor> = {
  DIRTY: { label: "Vacant Dirty", token: "dirty" },
  OCCUPIED: { label: "Occupied Dirty", token: "dirty" },
  PICKUP: { label: "Pickup", token: "pickup" },
  IN_PROGRESS: { label: "In Progress", token: "inProgress" },
  CLEAN: { label: "Submitted", token: "clean" },
  INSPECTED: { label: "Ready", token: "ready" },
  OOO: { label: "Out of Order", token: "outOfOrder" },
  OUT_OF_ORDER: { label: "Out of Order", token: "outOfOrder" },
  OUT_OF_SERVICE: { label: "Out of Service", token: "outOfOrder" },
};

export function getStatusMeta(
  status: string,
  theme: ThemeTokens = lightTheme,
): StatusMeta {
  const descriptor = STATUS_META[status];
  if (!descriptor) {
    return {
      label: status.replace(/_/g, " "),
      bg: theme.surfaceMuted,
      fg: theme.textMuted,
      border: theme.border,
    };
  }

  const token = descriptor.token;
  return {
    label: descriptor.label,
    bg: theme.status[`${token}Soft`],
    fg: theme.status[token],
    border: theme.status[`${token}Line`],
  };
}

function getStatusLabelKey(status: string): string {
  return `rooms.card.status.${STATUS_META[status] ? status : "UNKNOWN"}`;
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const meta = getStatusMeta(status, theme);
  return (
    <View style={[styles.statusPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
      <View style={[styles.statusDot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.statusPillText, { color: meta.fg }]}>
        {label ?? t(getStatusLabelKey(status), { status: meta.label })}
      </Text>
    </View>
  );
}

/** Striped rail for OCCUPIED, solid status color otherwise. */
export function StatusRail({ status }: { status: string }) {
  const theme = useTheme();
  const meta = getStatusMeta(status, theme);
  if (status === "OCCUPIED") {
    return (
      <View
        style={[
          styles.rail,
          { backgroundColor: theme.status.dirtySoft },
        ]}
      >
        {[0, 1, 2, 3].map((stripe) => (
          <View
            key={stripe}
            style={[
              styles.railStripe,
              { backgroundColor: theme.status.occupied },
            ]}
          />
        ))}
      </View>
    );
  }
  return <View style={[styles.rail, { backgroundColor: meta.fg }]} />;
}

/* ─── Generic atoms ───────────────────────────────────────────────────────── */

export function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
          {title}
        </Text>
        {hint ? (
          <Text style={[styles.sectionHint, { color: theme.textDisabled }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function ProgressBar({ value, total, color }: { value: number; total: number; color?: string }) {
  const theme = useTheme();
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <View
      style={[
        styles.progressTrack,
        { backgroundColor: theme.surfaceMuted },
      ]}
    >
      <View
        style={[
          styles.progressFill,
          {
            width: `${pct}%`,
            backgroundColor: color ?? theme.status.ready,
          },
        ]}
      />
    </View>
  );
}

export function Chip({
  children,
  icon,
  tone = "neutral",
}: {
  children: ReactNode;
  icon?: ComponentProps<typeof Ionicons>["name"];
  tone?: "neutral" | "alert" | "caution" | "ai" | "shell";
}) {
  const theme = useTheme();
  const palette = {
    neutral: {
      bg: theme.surfaceSubtle,
      fg: theme.textSecondary,
      border: theme.borderSubtle,
    },
    alert: {
      bg: theme.status.dirtySoft,
      fg: theme.status.dirty,
      border: theme.status.dirtyLine,
    },
    caution: {
      bg: theme.status.pickupSoft,
      fg: theme.status.pickup,
      border: theme.status.pickupLine,
    },
    ai: {
      bg: theme.ai.soft,
      fg: theme.ai.primary,
      border: theme.ai.line,
    },
    shell: {
      bg: theme.shell.raised,
      fg: theme.shell.ink,
      border: theme.shell.line,
    },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      {icon ? <Ionicons name={icon} size={11} color={palette.fg} /> : null}
      <Text style={[styles.chipText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

/* ─── Clean type display (mirrors web board styling contract) ─────────────── */

const CLEAN_TYPE_LABEL: Record<string, string> = { DEP: "Departure", FULL: "Full", LIGHT: "Light" };
const CLEAN_TYPE_LABEL_KEY: Record<string, string> = {
  DEP: "rooms.card.cleanType.DEP",
  FULL: "rooms.card.cleanType.FULL",
  LIGHT: "rooms.card.cleanType.LIGHT",
  FULL_DONE: "rooms.card.cleanType.FULL_DONE",
  LIGHT_DONE: "rooms.card.cleanType.LIGHT_DONE",
};

export function getCleanTypeDisplay(room: Room): string | null {
  const label = room.clean_type_label ?? (room.clean_type ? CLEAN_TYPE_LABEL[room.clean_type] ?? room.clean_type : null);
  if (!label || !room.clean_type) return null;
  if (room.status === "INSPECTED" && (room.clean_type === "FULL" || room.clean_type === "LIGHT")) {
    return `${label} Done`;
  }
  return label;
}

function getCleanTypeDisplayKey(room: Room): string | null {
  if (!room.clean_type) return null;
  if (room.status === "INSPECTED" && room.clean_type === "FULL") return CLEAN_TYPE_LABEL_KEY.FULL_DONE;
  if (room.status === "INSPECTED" && room.clean_type === "LIGHT") return CLEAN_TYPE_LABEL_KEY.LIGHT_DONE;
  return CLEAN_TYPE_LABEL_KEY[room.clean_type] ?? null;
}

function CleanTypeTag({ room }: { room: Room }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const displayKey = getCleanTypeDisplayKey(room);
  if (!displayKey) return null;
  const display = t(displayKey);
  const done = room.status === "INSPECTED";
  const color = done
    ? theme.status.ready
    : room.clean_type === "DEP"
      ? theme.status.dirty
      : theme.status.pickup;
  return (
    <View accessible accessibilityLabel={t("rooms.card.cleanTypeAccessibility", { type: display })} style={styles.cleanTypeRow}>
      {room.clean_type === "DEP" ? <Ionicons name="log-out-outline" size={10} color={color} /> : null}
      <Text style={[styles.cleanTypeText, { color }]}>{display}</Text>
    </View>
  );
}

function getTimingLabelKey(label: string): string {
  switch (label) {
    case "Checked out":
      return "rooms.card.timing.checkedOut";
    case "Due out":
      return "rooms.card.timing.dueOut";
    case "Arrival":
      return "rooms.card.timing.arrival";
    default:
      return "rooms.card.timing.unknown";
  }
}

function getBadgeLabelKey(key: string): string {
  return `rooms.card.badges.${key}`;
}

/* ─── Room queue card — the operational work card ─────────────────────────── */

interface RoomQueueCardProps {
  room: Room;
  onPress: () => void;
  /** 1-based position when shown inside the smart-order queue */
  position?: number;
  /** Estimated minutes for this room (smart order mode) */
  estimateMinutes?: number;
  actionLabel?: string;
  /** Muted card for exception rooms (DND / blocker note) — still tappable */
  dimmed?: boolean;
}

export function RoomQueueCard({ room, onPress, position, estimateMinutes, actionLabel, dimmed }: RoomQueueCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const timing = getPrimaryTimingLine(room);
  const badges = getRoomBadges(room);
  const roomType = room.room_type_code ?? room.rooms?.room_types?.code ?? null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Room ${room.room_number}`}
      testID={`room-card-${room.room_number}`}
    >
      <Card dimmed={dimmed} style={styles.cardLayoutOverrides}>
        <StatusRail status={room.status} />
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <StatusPill status={room.status} />
            <CleanTypeTag room={room} />
          </View>

          <View style={styles.cardTitleRow}>
            <Text style={[styles.roomNumber, { color: theme.textPrimary }]}>{room.room_number}</Text>
            {roomType ? (
              <Text style={[styles.roomType, { color: theme.textMuted }]} numberOfLines={1}>
                {roomType}
              </Text>
            ) : null}
          </View>

          {timing || badges.length > 0 ? (
            <View style={styles.cardMetaRow}>
              {timing ? (
                <View style={styles.timingRow}>
                  <Ionicons name="time-outline" size={12} color={theme.textMuted} />
                  <Text style={[styles.timingText, { color: theme.textSecondary }]}>
                    {t(getTimingLabelKey(timing.label), { label: timing.label })}: {timing.value}
                  </Text>
                </View>
              ) : null}
              {badges
                .filter((badge) => badge.key !== "checkout")
                .map((badge) => {
                  const loud = badge.key === "dnd";
                  const brass = badge.key === "vip";
                  const badgeColors = loud
                    ? { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }
                    : brass
                      ? { backgroundColor: theme.accentBrassSoft, borderColor: theme.accentBrassLine }
                      : { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle };
                  const badgeTextColor = loud ? theme.status.dirty : brass ? theme.accentBrass : theme.textSecondary;
                  return (
                    <View key={badge.key} style={[styles.badge, badgeColors]}>
                      <Text style={[styles.badgeText, { color: badgeTextColor }]}>
                        {t(getBadgeLabelKey(badge.key), { label: badge.label })}
                      </Text>
                    </View>
                  );
                })}
            </View>
          ) : null}
        </View>
        <View style={styles.cardRight}>
          {actionLabel ? <Text style={[styles.actionLabel, { color: theme.primaryAction }]}>{actionLabel}</Text> : null}
          <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} />
        </View>
      </Card>
    </Pressable>
  );
}

/* ─── AI briefing card — dark shell surface with violet AI accent ─────────── */

interface AIBriefingCardProps {
  kicker: string;
  headline: string;
  planLabel?: string;
  plan?: string[];
  watchouts?: string[];
  footNote?: string;
  loading?: boolean;
  children?: ReactNode;
}

export function AIBriefingCard({ kicker, headline, planLabel, plan, watchouts, footNote, loading, children }: AIBriefingCardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.aiCard,
        {
          backgroundColor: theme.shell.bg,
          borderColor: theme.shell.line,
        },
      ]}
      testID="ai-briefing-card"
    >
      <View style={styles.aiKickerRow}>
        <Ionicons name="sparkles" size={13} color={theme.ai.primary} />
        <Text style={[styles.aiKicker, { color: theme.ai.primary }]}>
          {kicker}
        </Text>
        {loading ? (
          <View
            style={[styles.aiPulse, { backgroundColor: theme.ai.primary }]}
          />
        ) : null}
      </View>
      <Text style={[styles.aiHeadline, { color: theme.shell.ink }]}>
        {headline}
      </Text>
      {plan && plan.length > 0 ? (
        <View style={styles.aiPlanRow}>
          {planLabel ? (
            <Text style={[styles.aiPlanLabel, { color: theme.shell.ink3 }]}>
              {planLabel}
            </Text>
          ) : null}
          <View style={styles.aiPlanChips}>
            {plan.map((roomNumber, index) => (
              <View key={`${roomNumber}-${index}`} style={styles.aiPlanChip}>
                <Text
                  style={[
                    styles.aiPlanChipText,
                    {
                      color: theme.shell.ink,
                      backgroundColor: theme.shell.raised,
                    },
                  ]}
                >
                  {roomNumber}
                </Text>
                {index < plan.length - 1 ? (
                  <Ionicons
                    name="arrow-forward"
                    size={9}
                    color={theme.shell.ink3}
                    style={styles.aiPlanArrow}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {watchouts && watchouts.length > 0 ? (
        <View style={styles.aiWatchouts}>
          {watchouts.map((watchout, index) => (
            <View key={index} style={styles.aiWatchoutRow}>
              <Ionicons
                name="alert-circle-outline"
                size={12}
                color={theme.accentBrass}
              />
              <Text
                style={[
                  styles.aiWatchoutText,
                  { color: theme.shell.ink2 },
                ]}
              >
                {watchout}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {children}
      {footNote ? (
        <Text style={[styles.aiFootNote, { color: theme.shell.ink3 }]}>
          {footNote}
        </Text>
      ) : null}
    </View>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusPillText: { fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },

  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, justifyContent: "space-evenly" },
  railStripe: { height: "16%" },

  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "baseline", gap: 8, flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  sectionHint: { fontFamily: monoFont, fontSize: 11, fontWeight: "700" },

  progressTrack: { height: 7, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: 7, borderRadius: 999 },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipText: { fontSize: 11, fontWeight: "800" },

  cardLayoutOverrides: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 0,
    paddingLeft: 16,
    paddingRight: 12,
  },
  cardBody: { flex: 1, minWidth: 0, paddingVertical: 14, gap: 8 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  cardTitleRow: { flexDirection: "row", alignItems: "baseline", gap: 8, minWidth: 0 },
  roomNumber: { fontFamily: monoFont, fontSize: 28, lineHeight: 32, fontWeight: "800" },
  roomType: { flex: 1, fontSize: 12.5, minWidth: 0 },
  etaText: { fontFamily: monoFont, fontSize: 12, fontWeight: "700" },
  positionText: { marginLeft: "auto", fontFamily: monoFont, fontSize: 11, fontWeight: "800" },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  timingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  timingText: { fontFamily: monoFont, fontSize: 11.5 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "800" },
  cardRight: { alignItems: "flex-end", gap: 4, paddingLeft: 10 },
  actionLabel: { fontSize: 12, fontWeight: "800" },

  cleanTypeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cleanTypeText: { fontSize: 10, fontWeight: "800" },

  aiCard: {
    borderWidth: 1,
    borderRadius: R.xl,
    padding: 18,
    gap: 11,
  },
  aiKickerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  aiKicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  aiPulse: { width: 6, height: 6, borderRadius: 3, marginLeft: 2 },
  aiHeadline: { fontSize: 18, lineHeight: 25, fontWeight: "700" },
  aiPlanRow: { gap: 6 },
  aiPlanLabel: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  aiPlanChips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  aiPlanChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  aiPlanChipText: {
    fontFamily: monoFont,
    fontSize: 13,
    fontWeight: "800",
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  aiPlanArrow: { marginHorizontal: 1 },
  aiWatchouts: { gap: 5 },
  aiWatchoutRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  aiWatchoutText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  aiFootNote: { fontSize: 10.5, fontFamily: monoFont },
});

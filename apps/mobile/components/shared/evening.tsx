import type { ReactNode } from "react";
import type { ComponentProps } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
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

export const STATUS_META: Record<string, StatusMeta> = {
  DIRTY: { label: "Vacant Dirty", bg: C.alertSoft, fg: C.alert, border: C.alertLine },
  OCCUPIED: { label: "Occupied Dirty", bg: C.alertSoft, fg: C.alert, border: C.alertLine },
  PICKUP: { label: "Pickup", bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  IN_PROGRESS: { label: "In Progress", bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  CLEAN: { label: "Submitted", bg: C.infoSoft, fg: C.info, border: C.infoLine },
  INSPECTED: { label: "Ready", bg: C.readySoft, fg: C.ready, border: C.readyLine },
  OOO: { label: "Out of Order", bg: C.oooSoft, fg: C.ooo, border: C.oooLine },
  OUT_OF_ORDER: { label: "Out of Order", bg: C.oooSoft, fg: C.ooo, border: C.oooLine },
  OUT_OF_SERVICE: { label: "Out of Service", bg: C.oooSoft, fg: C.ooo, border: C.oooLine },
};

export function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " "), bg: C.surface3, fg: C.ink3, border: C.line };
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const meta = getStatusMeta(status);
  return (
    <View style={[styles.statusPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
      <View style={[styles.statusDot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.statusPillText, { color: meta.fg }]}>{label ?? meta.label}</Text>
    </View>
  );
}

/** Striped rail for OCCUPIED, solid status color otherwise. */
export function StatusRail({ status }: { status: string }) {
  const meta = getStatusMeta(status);
  if (status === "OCCUPIED") {
    return (
      <View style={[styles.rail, { backgroundColor: C.alertSoft }]}>
        {[0, 1, 2, 3].map((stripe) => (
          <View key={stripe} style={styles.railStripe} />
        ))}
      </View>
    );
  }
  return <View style={[styles.rail, { backgroundColor: meta.fg }]} />;
}

/* ─── Generic atoms ───────────────────────────────────────────────────────── */

export function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function ProgressBar({ value, total, color = C.ready }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
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
  const palette = {
    neutral: { bg: C.surface2, fg: C.ink2, border: C.line2 },
    alert: { bg: C.alertSoft, fg: C.alert, border: C.alertLine },
    caution: { bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
    ai: { bg: C.aiSoft, fg: C.ai, border: C.aiLine },
    shell: { bg: shellTokens.raised, fg: shellTokens.ink, border: shellTokens.line },
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

export function getCleanTypeDisplay(room: Room): string | null {
  const label = room.clean_type_label ?? (room.clean_type ? CLEAN_TYPE_LABEL[room.clean_type] ?? room.clean_type : null);
  if (!label || !room.clean_type) return null;
  if (room.status === "INSPECTED" && (room.clean_type === "FULL" || room.clean_type === "LIGHT")) {
    return `${label} Done`;
  }
  return label;
}

function CleanTypeTag({ room }: { room: Room }) {
  const display = getCleanTypeDisplay(room);
  if (!display) return null;
  const done = room.status === "INSPECTED";
  const color = done ? C.ready : room.clean_type === "DEP" ? C.alert : C.caution;
  return (
    <View accessible accessibilityLabel={`${display} clean type`} style={styles.cleanTypeRow}>
      {room.clean_type === "DEP" ? <Ionicons name="log-out-outline" size={10} color={color} /> : null}
      <Text style={[styles.cleanTypeText, { color }]}>{display}</Text>
    </View>
  );
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
}

export function RoomQueueCard({ room, onPress, position, estimateMinutes, actionLabel }: RoomQueueCardProps) {
  const meta = getStatusMeta(room.status);
  const timing = getPrimaryTimingLine(room);
  const badges = getRoomBadges(room);
  const roomType = room.rooms?.room_types?.name ?? null;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card} testID={`room-card-${room.room_number}`}>
      <StatusRail status={room.status} />
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <StatusPill status={room.status} />
          <CleanTypeTag room={room} />
          {room.vip_flag ? (
            <View style={styles.vipBadge}>
              <Text style={styles.vipText}>VIP</Text>
            </View>
          ) : null}
          {position != null ? (
            <Text style={styles.positionText}>#{position}</Text>
          ) : null}
        </View>

        <View style={styles.cardTitleRow}>
          <Text style={styles.roomNumber}>{room.room_number}</Text>
          {roomType ? (
            <Text style={styles.roomType} numberOfLines={1}>
              {roomType}
            </Text>
          ) : null}
          {estimateMinutes != null ? (
            <Text style={styles.etaText}>~{estimateMinutes}m</Text>
          ) : null}
        </View>

        {timing || badges.length > 0 ? (
          <View style={styles.cardMetaRow}>
            {timing ? (
              <View style={styles.timingRow}>
                <Ionicons name="time-outline" size={12} color={C.ink3} />
                <Text style={styles.timingText}>
                  {timing.label}: {timing.value}
                </Text>
              </View>
            ) : null}
            {badges
              .filter((badge) => badge.key !== "checkout")
              .map((badge) => {
                const loud = badge.key === "dnd";
                return (
                  <View key={badge.key} style={[styles.badge, loud && styles.badgeCritical]}>
                    <Text style={[styles.badgeText, loud && styles.badgeCriticalText]}>{badge.label}</Text>
                  </View>
                );
              })}
          </View>
        ) : null}
      </View>
      <View style={styles.cardRight}>
        {actionLabel ? <Text style={styles.actionLabel}>{actionLabel}</Text> : null}
        <Ionicons name="chevron-forward" size={15} color={C.ink4} />
      </View>
    </TouchableOpacity>
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
  return (
    <View style={styles.aiCard} testID="ai-briefing-card">
      <View style={styles.aiKickerRow}>
        <Ionicons name="sparkles" size={13} color="#CBB8F0" />
        <Text style={styles.aiKicker}>{kicker}</Text>
        {loading ? <View style={styles.aiPulse} /> : null}
      </View>
      <Text style={styles.aiHeadline}>{headline}</Text>
      {plan && plan.length > 0 ? (
        <View style={styles.aiPlanRow}>
          {planLabel ? <Text style={styles.aiPlanLabel}>{planLabel}</Text> : null}
          <View style={styles.aiPlanChips}>
            {plan.map((roomNumber, index) => (
              <View key={`${roomNumber}-${index}`} style={styles.aiPlanChip}>
                <Text style={styles.aiPlanChipText}>{roomNumber}</Text>
                {index < plan.length - 1 ? (
                  <Ionicons name="arrow-forward" size={9} color={shellTokens.ink3} style={styles.aiPlanArrow} />
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
              <Ionicons name="alert-circle-outline" size={12} color={C.brass} />
              <Text style={styles.aiWatchoutText}>{watchout}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {children}
      {footNote ? <Text style={styles.aiFootNote}>{footNote}</Text> : null}
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
  railStripe: { height: "16%", backgroundColor: C.occupied },

  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "baseline", gap: 8, flex: 1, minWidth: 0 },
  sectionTitle: { color: C.ink3, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  sectionHint: { fontFamily: monoFont, color: C.ink4, fontSize: 11, fontWeight: "700" },

  progressTrack: { height: 7, borderRadius: 999, backgroundColor: C.surface3, overflow: "hidden" },
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

  card: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingLeft: 16,
    paddingRight: 12,
    shadowColor: C.ink,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardBody: { flex: 1, minWidth: 0, paddingVertical: 13, gap: 7 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  cardTitleRow: { flexDirection: "row", alignItems: "baseline", gap: 8, minWidth: 0 },
  roomNumber: { fontFamily: monoFont, fontSize: 28, lineHeight: 32, fontWeight: "800", color: C.ink },
  roomType: { flex: 1, color: C.ink3, fontSize: 12.5, minWidth: 0 },
  etaText: { fontFamily: monoFont, color: C.ink3, fontSize: 12, fontWeight: "700" },
  positionText: { marginLeft: "auto", fontFamily: monoFont, color: C.ink4, fontSize: 11, fontWeight: "800" },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  timingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  timingText: { color: C.ink2, fontFamily: monoFont, fontSize: 11.5 },
  badge: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeCritical: { backgroundColor: C.alertSoft, borderColor: C.alertLine },
  badgeText: { color: C.ink2, fontSize: 10, fontWeight: "800" },
  badgeCriticalText: { color: C.alert },
  cardRight: { alignItems: "flex-end", gap: 4, paddingLeft: 8 },
  actionLabel: { color: C.accent, fontSize: 12, fontWeight: "800" },

  cleanTypeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cleanTypeText: { fontSize: 10, fontWeight: "800" },

  vipBadge: {
    backgroundColor: C.brassSoft,
    borderWidth: 1,
    borderColor: C.brassLine,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  vipText: { fontSize: 9, fontWeight: "800", color: C.brass },

  aiCard: {
    backgroundColor: shellTokens.bg,
    borderWidth: 1,
    borderColor: shellTokens.line,
    borderRadius: R.xl,
    padding: 18,
    gap: 11,
  },
  aiKickerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  aiKicker: { color: "#CBB8F0", fontSize: 10.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  aiPulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#CBB8F0", marginLeft: 2 },
  aiHeadline: { color: shellTokens.ink, fontSize: 18, lineHeight: 25, fontWeight: "700" },
  aiPlanRow: { gap: 6 },
  aiPlanLabel: { color: shellTokens.ink3, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  aiPlanChips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  aiPlanChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  aiPlanChipText: {
    fontFamily: monoFont,
    color: shellTokens.ink,
    fontSize: 13,
    fontWeight: "800",
    backgroundColor: shellTokens.raised,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  aiPlanArrow: { marginHorizontal: 1 },
  aiWatchouts: { gap: 5 },
  aiWatchoutRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  aiWatchoutText: { flex: 1, color: shellTokens.ink2, fontSize: 12.5, lineHeight: 17 },
  aiFootNote: { color: shellTokens.ink3, fontSize: 10.5, fontFamily: monoFont },
});

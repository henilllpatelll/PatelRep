import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { monoFont } from "@/components/shared/tokens";
import { Card } from "@/components/ui/Card";
import { ProgressBar, StatusPill } from "@/components/shared/evening";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";
import { elapsedMinutes } from "@/lib/housekeeping/myRoomsDashboard";
import {
  cardAccessibilityLabel,
  cleanTypeLabel,
  describeAccess,
  describeAttention,
  formatClock,
  locationLabel,
  statusLabel,
} from "@/lib/housekeeping/myRoomsText";

const MIN_TARGET = 44;
const MAX_FONT_SCALE = 1.6;

function useLanguage(): string {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage ?? i18n.language;
}

/** Re-render on an interval so elapsed time follows the real session clock. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function RushBadge() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
      <Ionicons name="flash" size={11} color={theme.status.dirty} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: theme.status.dirty }]}>
        {t("rooms.dash.card.rush")}
      </Text>
    </View>
  );
}

/* ─── Route card (Up Next + Needs Attention) ──────────────────────────────── */

interface MyRoomCardProps {
  entry: RoomEntry;
  onPress: () => void;
  /** 1-based stop number in the suggested route. */
  position?: number;
}

/**
 * Primary: room number + status/urgency. Secondary: clean type and location.
 * One contextual line: needed-by, then access state. At most two badges.
 */
export function MyRoomCard({ entry, onPress, position }: MyRoomCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguage();
  const room = entry.room;
  const isAttention = entry.category === "attention";
  const attention = isAttention ? describeAttention(entry, t, language) : null;
  const subtitle = [cleanTypeLabel(room, t), locationLabel(room, t)].filter(Boolean).join(" · ");
  const neededBy = formatClock(entry.neededBy, language);
  const access = isAttention ? null : describeAccess(entry, t, language);
  const corrections = room.reclean_corrections?.length ?? 0;
  const reclean = !isAttention && room.reclean_requested_at && corrections > 0
    ? t("rooms.dash.card.reclean", { count: corrections })
    : null;
  const contextual = [access, reclean, isAttention ? null : t("rooms.dash.card.estimate", { minutes: entry.estimateMinutes })]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={cardAccessibilityLabel(entry, t, language)}
      testID={`room-card-${room.room_number}`}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <Card dimmed={isAttention} style={styles.card}>
        <View style={styles.cardBody}>
          <View style={styles.topRow}>
            <View style={styles.numberRow}>
              {position ? (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.position, { color: theme.textMuted }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  {position}.
                </Text>
              ) : null}
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
                {room.room_number}
              </Text>
            </View>
            <View style={styles.badges}>
              {attention ? (
                <View style={[styles.badge, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
                  <Ionicons name="alert-circle-outline" size={12} color={theme.status.dirty} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: theme.status.dirty }]}>
                    {attention.title}
                  </Text>
                </View>
              ) : (
                <StatusPill status={room.status} />
              )}
              {entry.rush ? <RushBadge /> : null}
            </View>
          </View>

          {subtitle ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
              {subtitle}
            </Text>
          ) : null}

          {neededBy ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.neededBy, { color: theme.status.dirty }]}>
              {t("rooms.dash.card.neededBy", { time: neededBy })}
            </Text>
          ) : null}

          {attention
            ? attention.details.map((line) => (
                <Text
                  key={line}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.detail, { color: theme.textSecondary }]}
                >
                  {line}
                </Text>
              ))
            : contextual
              ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textSecondary }]}>
                  {contextual}
                </Text>
              )
              : null}

          <View style={styles.actionRow}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.action, { color: theme.primaryAction }]}>
              {t("rooms.dash.card.review")}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.primaryAction} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/* ─── Compact row (Floors + Done) ─────────────────────────────────────────── */

export function CompactRoomRow({ entry, onPress }: { entry: RoomEntry; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguage();
  const room = entry.room;
  const marker =
    entry.category === "current"
      ? t("rooms.dash.floors.current")
      : entry.category === "attention"
        ? describeAttention(entry, t, language).title
        : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={cardAccessibilityLabel(entry, t, language)}
      testID={`room-row-${room.room_number}`}
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.borderSubtle, backgroundColor: theme.surface },
        pressed && styles.pressed,
      ]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowNumber, { color: theme.textPrimary }]}>
        {room.room_number}
      </Text>
      <View style={styles.rowMain}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowStatus, { color: theme.textSecondary }]}>
          {statusLabel(room.status, t)}
        </Text>
        {marker || entry.rush ? (
          <View style={styles.rowMarkers}>
            {marker ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowMarker, { color: theme.status.pickup }]}>
                {marker}
              </Text>
            ) : null}
            {entry.rush ? <RushBadge /> : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} />
    </Pressable>
  );
}

/* ─── Current room ────────────────────────────────────────────────────────── */

interface CurrentRoomCardProps {
  entry: RoomEntry;
  onResume: () => void;
  /** Re-load the session for a room the list calls in progress but the device lacks. */
  onReloadSession: () => void;
  reloading: boolean;
  isOnline: boolean;
}

export function CurrentRoomCard({ entry, onResume, onReloadSession, reloading, isOnline }: CurrentRoomCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const now = useNow(30_000);
  const room = entry.room;
  const session = entry.session;

  if (!session || session.state === "missing") {
    return (
      <View
        style={[styles.currentCard, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
        testID={`current-recovery-${room.room_number}`}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.currentTitle, { color: theme.textPrimary }]}>
          {t("rooms.dash.current.recoveryTitle", { room: room.room_number })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textSecondary }]}>
          {isOnline ? t("rooms.dash.current.recoveryBody") : t("rooms.dash.current.recoveryOffline")}
        </Text>
        <View style={styles.recoveryActions}>
          {isOnline ? (
            <Pressable
              onPress={onReloadSession}
              disabled={reloading}
              accessibilityRole="button"
              accessibilityLabel={t("rooms.dash.current.recoveryRetry")}
              style={[styles.secondaryBtn, { borderColor: theme.border, opacity: reloading ? 0.6 : 1 }]}
            >
              <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
                {t("rooms.dash.current.recoveryRetry")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onResume}
            accessibilityRole="button"
            accessibilityLabel={t("rooms.dash.current.recoveryOpen")}
            style={[styles.primaryBtn, { backgroundColor: theme.primaryAction }]}
          >
            <Text style={[styles.primaryBtnText, { color: theme.onPrimary }]}>{t("rooms.dash.current.recoveryOpen")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const minutes = elapsedMinutes(session.startedAt, now);
  const subtitle = [cleanTypeLabel(room, t), locationLabel(room, t)].filter(Boolean).join(" · ");
  const note =
    session.state === "starting"
      ? t("rooms.dash.current.starting")
      : session.state === "completing"
        ? t("rooms.dash.current.completing")
        : session.state === "conflict"
          ? t("rooms.dash.current.conflict")
          : null;

  return (
    <Pressable
      onPress={onResume}
      accessibilityRole="button"
      accessibilityLabel={t("rooms.dash.current.a11y", {
        room: room.room_number,
        minutes: minutes ?? 0,
        done: session.checklistDone,
        total: session.checklistTotal,
      })}
      testID={`current-room-${room.room_number}`}
      style={({ pressed }) => [
        styles.currentCard,
        { backgroundColor: theme.status.inProgressSoft, borderColor: theme.status.inProgressLine },
        pressed && styles.pressed,
      ]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.currentTitle, { color: theme.textPrimary }]}>
        {t("rooms.dash.current.title", { room: room.room_number })}
      </Text>
      {subtitle ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
          {subtitle}
        </Text>
      ) : null}
      {minutes !== null ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textSecondary }]}>
          {t("rooms.dash.current.elapsed", { minutes })}
        </Text>
      ) : null}
      {session.checklistTotal > 0 ? (
        <View style={styles.checklist}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textPrimary }]}>
            {t("rooms.dash.current.checklist", { done: session.checklistDone, total: session.checklistTotal })}
          </Text>
          <ProgressBar value={session.checklistDone} total={session.checklistTotal} color={theme.status.inProgress} />
        </View>
      ) : null}
      {note ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.syncNote, { color: theme.status.pickup }]}>
          {note}
        </Text>
      ) : null}
      <View style={[styles.primaryBtn, { backgroundColor: theme.primaryAction }]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.primaryBtnText, { color: theme.onPrimary }]}>
          {t("rooms.dash.current.resume", { room: room.room_number })}
        </Text>
        <Ionicons name="arrow-forward" size={16} color={theme.onPrimary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { minHeight: MIN_TARGET },
  pressed: { opacity: 0.85 },
  card: { flexDirection: "row" },
  cardBody: { flex: 1, minWidth: 0, gap: 4 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  numberRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  position: { fontFamily: monoFont, fontSize: 13, fontWeight: "700" },
  roomNumber: { fontFamily: monoFont, fontSize: 28, fontWeight: "800", lineHeight: 34 },
  badges: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  subtitle: { fontSize: 14, fontWeight: "600" },
  neededBy: { fontSize: 13.5, fontWeight: "800" },
  detail: { fontSize: 13.5, lineHeight: 19 },
  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, minHeight: 28 },
  action: { fontSize: 14, fontWeight: "700" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 12,
  },
  rowNumber: { fontFamily: monoFont, fontSize: 18, fontWeight: "800", minWidth: 52 },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowStatus: { fontSize: 14 },
  rowMarkers: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowMarker: { fontSize: 12, fontWeight: "800" },

  currentCard: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 6 },
  currentTitle: { fontSize: 20, fontWeight: "800", lineHeight: 26 },
  checklist: { gap: 6, marginTop: 4 },
  syncNote: { fontSize: 13, fontWeight: "700" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "800" },
  recoveryActions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  secondaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "700" },
});

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { monoFont, serifFont } from "@/components/shared/tokens";
import { ProgressBar } from "@/components/shared/evening";
import { Button } from "@/components/ui/Button";
import { Kicker, LinkButton, MAX_FONT_SCALE } from "@/components/home/homeUi";
import { elapsedSeconds, formatElapsed } from "@/lib/housekeeping/cleaningTimer";
import type { Recommendation } from "@/lib/housekeeping/homeRecommendation";
import type { ActiveRoomView } from "@/lib/housekeeping/homeModel";
import { describeRecommendation, roomContext } from "@/lib/housekeeping/homeText";
import type { TextContext } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  /** The open cleaning session, when there is one and it should lead. */
  active: ActiveRoomView | null;
  /** The room to start when nothing is open. */
  recommendation: Recommendation | null;
  /** Quick Mark Clean is allowed for this room (hold-to-confirm still gates the checklist). */
  canMarkClean: boolean;
  t: Translate;
  ctx: TextContext;
  onOpenRoom: (roomId: string) => void;
  onMarkClean: () => void;
}

/** Re-render once a second, but only while a real timer is on screen. */
function useSecondTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/**
 * "Right now": the one thing to do. An open session leads with its real
 * elapsed time and checklist progress; with none, the shared recommendation
 * leads with the reason it is first. It never starts anything itself: the
 * primary action opens the existing room workflow.
 */
export function CurrentRoomCard({ active, recommendation, canMarkClean, t, ctx, onOpenRoom, onMarkClean }: Props) {
  if (active) {
    return <ActiveCard active={active} canMarkClean={canMarkClean} t={t} onOpenRoom={onOpenRoom} onMarkClean={onMarkClean} />;
  }
  if (recommendation) {
    return <RecommendedCard recommendation={recommendation} t={t} ctx={ctx} onOpenRoom={onOpenRoom} />;
  }
  return null;
}

function Shell({ accent, children, testID }: { accent: string; children: React.ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.textPrimary }]}
      testID={testID}
    >
      <View style={[styles.rail, { backgroundColor: accent }]} />
      <View style={styles.body}>{children}</View>
    </View>
  );
}

function RoomHeading({ number, context, t }: { number: string; context: string; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={styles.heading}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityRole="header"
        accessibilityLabel={t("rooms.dash.card.room", { room: number })}
        style={[styles.roomNumber, { color: theme.textPrimary }]}
        testID="current-room-number"
      >
        {number}
      </Text>
      {context ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.context, { color: theme.textSecondary }]}>
          {context}
        </Text>
      ) : null}
    </View>
  );
}

function ActiveCard({
  active,
  canMarkClean,
  t,
  onOpenRoom,
  onMarkClean,
}: Pick<Props, "canMarkClean" | "t" | "onOpenRoom" | "onMarkClean"> & { active: ActiveRoomView }) {
  const theme = useTheme();
  const running = active.sessionState === "active" || active.sessionState === "starting";
  const now = useSecondTick(running && active.startedAt !== null);
  // A timer is shown only from a real session start; never from the room's update time.
  const elapsed = running ? elapsedSeconds(active.startedAt, now) : null;
  const context = roomContext(active.room, t);

  const recovery = active.sessionState === "missing" || active.sessionState === "conflict";
  const kicker = recovery
    ? t(active.sessionState === "missing" ? "home.current.kickerMissing" : "home.current.kickerConflict")
    : t("home.current.kickerActive");
  const accent = recovery ? theme.status.pickup : theme.status.inProgress;
  const primaryLabel = recovery ? t("home.current.openRoom") : t("home.current.continue");

  return (
    <Shell accent={accent} testID="focus-card">
      <Kicker color={accent}>{kicker}</Kicker>
      <RoomHeading number={active.room.room_number} context={context} t={t} />

      {recovery ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="current-room-recovery">
          {t(active.sessionState === "missing" ? "home.current.missingBody" : "home.current.conflictBody")}
        </Text>
      ) : null}

      {running ? (
        <View style={styles.facts}>
          {elapsed !== null ? (
            <View style={styles.factRow} accessible accessibilityLabel={t("home.current.elapsedA11y", { time: formatElapsed(elapsed) })}>
              <Ionicons name="timer-outline" size={16} color={theme.textSecondary} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.elapsed, { color: theme.textPrimary }]} testID="current-room-elapsed">
                {formatElapsed(elapsed)}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factText, { color: theme.textSecondary }]}>
                {t("home.current.elapsed")}
              </Text>
            </View>
          ) : null}
          {active.checklistTotal > 0 ? (
            <View style={styles.checklist}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factText, { color: theme.textSecondary }]} testID="current-room-checklist">
                {t("home.current.checklist", { done: active.checklistDone, total: active.checklistTotal })}
              </Text>
              <ProgressBar value={active.checklistDone} total={active.checklistTotal} color={theme.status.inProgress} />
            </View>
          ) : null}
          {active.pendingSync ? (
            <View style={styles.factRow}>
              <Ionicons name="cloud-upload-outline" size={14} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factText, { color: theme.textMuted }]}>
                {t("home.current.savedOnPhone")}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Button
        label={primaryLabel}
        onPress={() => onOpenRoom(active.room.id)}
        size="lg"
        icon="arrow-forward"
        testID="focus-primary"
        accessibilityLabel={t("home.current.primaryA11y", { action: primaryLabel, room: active.room.room_number })}
      />
      {canMarkClean ? (
        <Button label={t("rooms.detail.primary.markClean")} onPress={onMarkClean} variant="secondary" icon="checkmark" testID="focus-mark-clean" />
      ) : null}
    </Shell>
  );
}

function RecommendedCard({
  recommendation,
  t,
  ctx,
  onOpenRoom,
}: Pick<Props, "t" | "ctx" | "onOpenRoom"> & { recommendation: Recommendation }) {
  const theme = useTheme();
  const [whyOpen, setWhyOpen] = useState(false);
  const copy = describeRecommendation(recommendation, t, ctx);
  const room = recommendation.room;

  return (
    <Shell accent={theme.primaryAction} testID="focus-card">
      <Kicker color={theme.primary}>{t("home.current.kickerRecommended")}</Kicker>
      <RoomHeading number={room.room_number} context={roomContext(room, t)} t={t} />
      {copy.headline ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headline, { color: theme.textPrimary }]} testID="current-room-headline">
          {copy.headline}
        </Text>
      ) : null}
      <Button
        label={t("home.current.openRoomShort")}
        onPress={() => onOpenRoom(room.id)}
        size="lg"
        icon="arrow-forward"
        testID="focus-primary"
        accessibilityLabel={t("home.current.primaryA11y", { action: t("home.current.openRoomShort"), room: room.room_number })}
      />
      <LinkButton
        label={t("home.current.why")}
        icon={whyOpen ? "chevron-up" : "chevron-down"}
        expanded={whyOpen}
        onPress={() => setWhyOpen((value) => !value)}
        testID="focus-why"
      />
      {whyOpen ? (
        <View style={[styles.why, { backgroundColor: theme.surfaceMuted }]} testID="focus-why-panel">
          {copy.why.map((line, index) => (
            <View key={`${index}-${line}`} style={styles.whyRow}>
              <Ionicons name="checkmark-circle-outline" size={15} color={theme.primary} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.whyText, { color: theme.textSecondary }]}>
                {line}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Shell>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: "row",
    overflow: "hidden",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  rail: { width: 5 },
  body: { flex: 1, padding: 16, gap: 10 },
  heading: { gap: 2 },
  roomNumber: { fontFamily: serifFont, fontSize: 48, lineHeight: 54 },
  context: { fontSize: 15, lineHeight: 20 },
  headline: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  note: { fontSize: 14, lineHeight: 20 },
  facts: { gap: 8 },
  factRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  factText: { fontSize: 13, lineHeight: 18 },
  elapsed: { fontFamily: monoFont, fontSize: 18, fontWeight: "700" },
  checklist: { gap: 6 },
  why: { borderRadius: 12, padding: 12, gap: 8 },
  whyRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  whyText: { flex: 1, fontSize: 13, lineHeight: 18 },
});

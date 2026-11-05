import { useEffect, useRef, useState, type RefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { monoFont, serifFont } from "@/components/shared/tokens";
import { ProgressBar } from "@/components/shared/evening";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LinearProgress } from "@/components/ui/LinearProgress";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Kicker, LinkButton, MAX_FONT_SCALE, MoreButton } from "@/components/home/homeUi";
import { elapsedSeconds, formatElapsed } from "@/lib/housekeeping/cleaningTimer";
import type { Recommendation } from "@/lib/housekeeping/homeRecommendation";
import type { ActiveRoomView } from "@/lib/housekeeping/homeModel";
import { describeRecommendation, roomContext } from "@/lib/housekeeping/homeText";
import type { TextContext } from "@/lib/housekeeping/myRoomsText";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";
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
  /** Opens the room-actions drawer. The control passes itself so focus can return to it. */
  onMore: (roomId: string, opener: RefObject<unknown>) => void;
  /** Opens the "Why this room?" drawer. */
  onWhy: (roomId: string, opener: RefObject<unknown>) => void;
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
export function CurrentRoomCard({ active, recommendation, canMarkClean, t, ctx, onOpenRoom, onMarkClean, onMore, onWhy }: Props) {
  const v2 = useIsDesignV2();
  if (active) {
    return v2 ? (
      <ActiveCardV2 active={active} canMarkClean={canMarkClean} t={t} onOpenRoom={onOpenRoom} onMarkClean={onMarkClean} onMore={onMore} />
    ) : (
      <ActiveCard active={active} canMarkClean={canMarkClean} t={t} onOpenRoom={onOpenRoom} onMarkClean={onMarkClean} onMore={onMore} />
    );
  }
  if (recommendation) {
    return v2 ? (
      <RecommendedCardV2 recommendation={recommendation} t={t} ctx={ctx} onOpenRoom={onOpenRoom} onMore={onMore} onWhy={onWhy} />
    ) : (
      <RecommendedCard recommendation={recommendation} t={t} ctx={ctx} onOpenRoom={onOpenRoom} onMore={onMore} onWhy={onWhy} />
    );
  }
  return null;
}

/* ─── Design System V2 ───────────────────────────────────────────────────── */

/** The hero card: status badge, a large sans room number, real elapsed time, checklist progress and exactly one
 *  primary action. Same data, same handlers and same test IDs as the legacy card; only the presentation changed. */
function HeroFrame({ accent, children, testID }: { accent: string; children: React.ReactNode; testID: string }) {
  return (
    <Card style={[styles.heroV2, { borderTopColor: accent }]} testID={testID}>
      {children}
    </Card>
  );
}

function RoomHeadingV2({ number, context, t }: { number: string; context: string; t: Translate }) {
  return (
    <View style={styles.headingV2}>
      <AppText
        variant="display"
        numeric
        accessibilityRole="header"
        accessibilityLabel={t("rooms.dash.card.room", { room: number })}
        style={styles.roomNumberV2}
        testID="current-room-number"
      >
        {number}
      </AppText>
      {context ? (
        <AppText variant="bodyStrong" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.contextV2}>
          {context}
        </AppText>
      ) : null}
    </View>
  );
}

function ActiveCardV2({
  active,
  canMarkClean,
  t,
  onOpenRoom,
  onMarkClean,
  onMore,
}: Pick<Props, "canMarkClean" | "t" | "onOpenRoom" | "onMarkClean" | "onMore"> & { active: ActiveRoomView }) {
  const theme = useTheme();
  const moreRef = useRef<unknown>(null);
  const running = active.sessionState === "active" || active.sessionState === "starting";
  const now = useSecondTick(running && active.startedAt !== null);
  const elapsed = running ? elapsedSeconds(active.startedAt, now) : null;
  const context = roomContext(active.room, t);
  const recovery = active.sessionState === "missing" || active.sessionState === "conflict";
  const primaryLabel = recovery ? t("home.current.openRoom") : t("home.current.continue");
  const accent = recovery ? theme.status.pickup : theme.status.inProgress;
  const stepsLeft = Math.max(0, active.checklistTotal - active.checklistDone);
  // The quick Mark clean button only exists when the existing rules allow it. When it does not, say what remains
  // instead of showing a disabled or missing control with no explanation.
  const blockedReason =
    running && !canMarkClean && stepsLeft > 0 ? t("home.current.remaining", { count: stepsLeft }) : null;

  return (
    <HeroFrame accent={accent} testID="focus-card">
      <View style={styles.betweenV2}>
        <AppText variant="label" tone="secondary" accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {t("home.current.title")}
        </AppText>
        {recovery ? (
          <StatusBadge
            statusKey="pickup"
            label={t(active.sessionState === "missing" ? "home.current.badgeMissing" : "home.current.badgeConflict")}
          />
        ) : (
          <StatusBadge statusKey="inProgress" label={t("home.current.badgeInProgress")} />
        )}
      </View>
      <RoomHeadingV2 number={active.room.room_number} context={context} t={t} />

      {recovery ? (
        <AppText variant="caption" tone="secondary" testID="current-room-recovery">
          {t(active.sessionState === "missing" ? "home.current.missingBody" : "home.current.conflictBody")}
        </AppText>
      ) : null}

      {running ? (
        <View style={styles.factsV2}>
          {elapsed !== null ? (
            <View style={styles.factRowV2} accessible accessibilityLabel={t("home.current.elapsedA11y", { time: formatElapsed(elapsed) })}>
              <Ionicons name="stopwatch-outline" size={16} color={theme.textSecondary} />
              <AppText variant="bodyStrong" numeric testID="current-room-elapsed">
                {formatElapsed(elapsed)}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {t("home.current.elapsed")}
              </AppText>
            </View>
          ) : null}
          {active.checklistTotal > 0 ? (
            <View style={styles.checklistV2}>
              <AppText variant="caption" tone="secondary" numeric testID="current-room-checklist">
                {t("home.current.checklist", { done: active.checklistDone, total: active.checklistTotal })}
              </AppText>
              <LinearProgress
                value={active.checklistDone}
                total={active.checklistTotal}
                tone="inProgress"
                accessibilityLabel={t("home.current.checklist", { done: active.checklistDone, total: active.checklistTotal })}
              />
            </View>
          ) : null}
          {active.pendingSync ? (
            <View style={styles.factRowV2}>
              <Ionicons name="cloud-upload-outline" size={14} color={theme.status.pickup} />
              <AppText variant="caption" tone="muted">
                {t("home.current.savedOnPhone")}
              </AppText>
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
      <View style={styles.actionsV2}>
        {canMarkClean ? (
          <Button
            label={t("rooms.detail.primary.markClean")}
            onPress={onMarkClean}
            variant="secondary"
            icon="checkmark"
            style={styles.grow}
            testID="focus-mark-clean"
          />
        ) : (
          <View style={styles.grow} />
        )}
        <MoreButton
          ref={moreRef as never}
          label={t("home.current.more")}
          accessibilityLabel={t("home.current.moreA11y", { room: active.room.room_number })}
          onPress={() => onMore(active.room.id, moreRef)}
          testID="focus-more"
        />
      </View>
      {blockedReason ? (
        <View style={styles.hintV2} testID="focus-mark-clean-reason">
          <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
          <AppText variant="caption" tone="secondary" style={styles.grow}>
            {blockedReason}
          </AppText>
        </View>
      ) : null}
    </HeroFrame>
  );
}

function RecommendedCardV2({
  recommendation,
  t,
  ctx,
  onOpenRoom,
  onMore,
  onWhy,
}: Pick<Props, "t" | "ctx" | "onOpenRoom" | "onMore" | "onWhy"> & { recommendation: Recommendation }) {
  const theme = useTheme();
  const whyRef = useRef<unknown>(null);
  const moreRef = useRef<unknown>(null);
  const copy = describeRecommendation(recommendation, t, ctx);
  const room = recommendation.room;

  return (
    <HeroFrame accent={theme.primaryAction} testID="focus-card">
      <View style={styles.betweenV2}>
        <AppText variant="label" tone="secondary" accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {t("home.current.titleNext")}
        </AppText>
      </View>
      <RoomHeadingV2 number={room.room_number} context={roomContext(room, t)} t={t} />
      {copy.headline ? (
        <AppText variant="body" tone="secondary" testID="current-room-headline">
          {copy.headline}
        </AppText>
      ) : null}
      <Button
        label={t("home.current.openRoomShort")}
        onPress={() => onOpenRoom(room.id)}
        size="lg"
        icon="arrow-forward"
        testID="focus-primary"
        accessibilityLabel={t("home.current.primaryA11y", { action: t("home.current.openRoomShort"), room: room.room_number })}
      />
      <View style={styles.actionsV2}>
        <LinkButton
          ref={whyRef as never}
          label={t("home.current.why")}
          icon="help-circle-outline"
          onPress={() => onWhy(room.id, whyRef)}
          testID="focus-why"
          accessibilityLabel={t("home.current.whyA11y", { room: room.room_number })}
        />
        <MoreButton
          ref={moreRef as never}
          label={t("home.current.more")}
          accessibilityLabel={t("home.current.moreA11y", { room: room.room_number })}
          onPress={() => onMore(room.id, moreRef)}
          testID="focus-more"
        />
      </View>
    </HeroFrame>
  );
}

/* ─── Legacy (unchanged) ─────────────────────────────────────────────────── */

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
  onMore,
}: Pick<Props, "canMarkClean" | "t" | "onOpenRoom" | "onMarkClean" | "onMore"> & { active: ActiveRoomView }) {
  const theme = useTheme();
  const moreRef = useRef<unknown>(null);
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
      <View style={styles.actions}>
        {canMarkClean ? (
          <Button
            label={t("rooms.detail.primary.markClean")}
            onPress={onMarkClean}
            variant="secondary"
            icon="checkmark"
            style={styles.grow}
            testID="focus-mark-clean"
          />
        ) : (
          <View style={styles.grow} />
        )}
        <MoreButton
          ref={moreRef as never}
          label={t("home.current.more")}
          accessibilityLabel={t("home.current.moreA11y", { room: active.room.room_number })}
          onPress={() => onMore(active.room.id, moreRef)}
          testID="focus-more"
        />
      </View>
    </Shell>
  );
}

function RecommendedCard({
  recommendation,
  t,
  ctx,
  onOpenRoom,
  onMore,
  onWhy,
}: Pick<Props, "t" | "ctx" | "onOpenRoom" | "onMore" | "onWhy"> & { recommendation: Recommendation }) {
  const theme = useTheme();
  const whyRef = useRef<unknown>(null);
  const moreRef = useRef<unknown>(null);
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
      <View style={styles.actions}>
        <LinkButton
          ref={whyRef as never}
          label={t("home.current.why")}
          icon="help-circle-outline"
          onPress={() => onWhy(room.id, whyRef)}
          testID="focus-why"
          accessibilityLabel={t("home.current.whyA11y", { room: room.room_number })}
        />
        <MoreButton
          ref={moreRef as never}
          label={t("home.current.more")}
          accessibilityLabel={t("home.current.moreA11y", { room: room.room_number })}
          onPress={() => onMore(room.id, moreRef)}
          testID="focus-more"
        />
      </View>
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
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  grow: { flex: 1 },

  // V2
  heroV2: { borderRadius: radiusV2.hero, borderTopWidth: 3, padding: spaceV2.lg, gap: spaceV2.md },
  betweenV2: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spaceV2.sm },
  headingV2: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", columnGap: spaceV2.md, rowGap: 2 },
  roomNumberV2: { fontSize: 44, lineHeight: 50 },
  contextV2: { flexShrink: 1, paddingBottom: 6 },
  factsV2: { gap: spaceV2.sm },
  factRowV2: { flexDirection: "row", alignItems: "center", gap: 6 },
  checklistV2: { gap: 6 },
  actionsV2: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spaceV2.sm },
  hintV2: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
});

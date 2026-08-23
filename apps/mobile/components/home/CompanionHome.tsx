import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  R,
  lightTheme,
  monoFont,
  serifFont,
  type ThemeTokens,
} from "@/components/shared/tokens";
import { ProgressBar } from "@/components/shared/evening";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { SmartQueueEntry } from "@/lib/ai/briefing";
import type { ShiftSnapshot } from "@/lib/ai/companion";
import { useHousekeeperAccent, useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Status → tile visual — protected color contract, shared with the
   supervisor room board (components/supervisor/atoms.tsx). */

export interface TileVisual {
  bg: string;
  fg: string;
  border: string;
}

export function getTileVisual(
  status: string,
  theme: ThemeTokens = lightTheme,
): TileVisual {
  switch (status) {
    case "INSPECTED":
      return { bg: theme.status.ready, fg: theme.shell.ink, border: "transparent" };
    case "CLEAN":
      return { bg: theme.status.clean, fg: theme.shell.ink, border: "transparent" };
    case "IN_PROGRESS":
      return {
        bg: theme.status.inProgressSoft,
        fg: theme.status.inProgress,
        border: theme.status.inProgressLine,
      };
    case "PICKUP":
      return { bg: theme.status.pickupSoft, fg: theme.status.pickup, border: "transparent" };
    case "DIRTY":
    case "OCCUPIED":
      return {
        bg: theme.status.dirtySoft,
        fg: status === "OCCUPIED" ? theme.status.occupied : theme.status.dirty,
        border: "transparent",
      };
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return {
        bg: theme.status.outOfOrderSoft,
        fg: theme.status.outOfOrder,
        border: "transparent",
      };
    default:
      return { bg: theme.shell.raised, fg: theme.shell.ink2, border: "transparent" };
  }
}

/* ─── Focus card — the one room to act on right now (never a queue) ───────── */

function getFocusSubtitle(room: Room, roomType: string | null, t: Translate): string {
  return roomType ?? t("home.focus.floor", { floor: room.floor });
}

/** Seconds since the room's last status change — a reasonable proxy for "clean
 *  started" since updated_at is written at the moment a room enters IN_PROGRESS. */
function getElapsedSeconds(room: Room, now: number = Date.now()): number {
  if (room.status !== "IN_PROGRESS" || !room.updated_at) return 0;
  const started = new Date(room.updated_at).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function FocusCard({
  entry,
  inProgressRoom,
  t,
  onStart,
  onResume,
}: {
  entry: SmartQueueEntry;
  /** A different room mid-clean, surfaced as a gentle resume link */
  inProgressRoom: Room | null;
  t: Translate;
  onStart: (room: Room) => void;
  onResume: (room: Room) => void;
}) {
  const theme = useTheme();
  const accent = useHousekeeperAccent();
  const room = entry.room;
  const inProgress = room.status === "IN_PROGRESS";
  const roomType = room.room_type_code ?? room.rooms?.room_types?.code ?? null;
  const targetMinutes = entry.estimateMinutes;
  const startLabel = inProgress ? t("rooms.detail.primary.markClean") : t("home.startWith", { room: room.room_number });

  const [elapsedSec, setElapsedSec] = useState(() => getElapsedSeconds(room));
  useEffect(() => {
    if (!inProgress) {
      setElapsedSec(0);
      return;
    }
    setElapsedSec(getElapsedSeconds(room));
    const id = setInterval(() => setElapsedSec(getElapsedSeconds(room)), 1000);
    return () => clearInterval(id);
  }, [inProgress, room.updated_at, room.id]);

  const elapsedMinutes = elapsedSec / 60;
  const paceMinutes = Math.round(targetMinutes - elapsedMinutes);
  const progressPct = targetMinutes > 0 ? Math.min(100, Math.max(0, (elapsedMinutes / targetMinutes) * 100)) : 0;

  return (
    <View testID="focus-card">
      <View style={[styles.focusCard, { backgroundColor: theme.shell.bg, borderColor: theme.shell.line, borderWidth: 1 }]}>
        <View style={styles.focusKickerRow}>
          <View style={styles.focusKickerLeft}>
            {inProgress ? <View style={[styles.focusPulseDot, { backgroundColor: accent.bg }]} /> : null}
            <Text style={[styles.focusKicker, { color: theme.shell.ink3 }]}>
              {inProgress ? t("home.focus.inProgressKicker") : t("home.focus.kicker")}
            </Text>
          </View>
          <Text style={[styles.focusEta, { color: theme.shell.ink3 }]}>
            {inProgress
              ? t("home.focus.target", { time: formatClock(Math.round(targetMinutes) * 60) })
              : t("home.focus.estMinutes", { minutes: targetMinutes })}
          </Text>
        </View>
        <View style={styles.focusTitleRow}>
          <View style={styles.focusTitleBody}>
            <Text style={[styles.focusRoomNumber, { color: theme.shell.ink }]}>{room.room_number}</Text>
            <Text style={[styles.focusRoomType, { color: theme.shell.ink2 }]} numberOfLines={1}>
              {getFocusSubtitle(room, roomType, t)}
            </Text>
          </View>
          {inProgress ? (
            <View style={styles.focusElapsedStack}>
              <Text style={[styles.focusElapsedClock, { color: theme.shell.ink }]}>{formatClock(elapsedSec)}</Text>
              <Text
                style={[
                  styles.focusPaceText,
                  { color: paceMinutes >= 0 ? theme.status.ready : theme.status.pickup },
                ]}
              >
                {paceMinutes >= 0
                  ? t("home.focus.underPace", { minutes: paceMinutes })
                  : t("home.focus.overPace", { minutes: Math.abs(paceMinutes) })}
              </Text>
            </View>
          ) : null}
        </View>
        {inProgress ? (
          <View style={[styles.focusProgressTrack, { backgroundColor: theme.shell.raised }]}>
            <View
              style={[
                styles.focusProgressFill,
                { width: `${progressPct}%`, backgroundColor: accent.bg },
              ]}
            />
          </View>
        ) : null}
        <View style={styles.focusButtonRow}>
          <Button
            label={startLabel}
            onPress={() => onStart(room)}
            testID="focus-start"
            icon="arrow-forward"
            style={[styles.focusPrimaryButton, inProgress && { backgroundColor: accent.bg }]}
          />
          {inProgress ? (
            <>
              <TouchableOpacity
                style={[styles.focusIconButton, { borderColor: theme.shell.line }]}
                disabled
                testID="focus-pause"
                accessibilityRole="button"
                accessibilityLabel={t("home.focus.pause")}
                accessibilityState={{ disabled: true }}
              >
                <Ionicons name="pause" size={16} color={theme.shell.ink3} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.focusIconButton, { borderColor: theme.shell.line }]}
                onPress={() => onStart(room)}
                activeOpacity={0.8}
                testID="focus-more"
                accessibilityRole="button"
                accessibilityLabel={t("home.focus.more")}
              >
                <Ionicons name="ellipsis-horizontal" size={16} color={theme.shell.ink} />
              </TouchableOpacity>
            </>
          ) : null}
        </View>
        {inProgressRoom && inProgressRoom.id !== room.id ? (
          <TouchableOpacity
            style={styles.focusResumeRow}
            onPress={() => onResume(inProgressRoom)}
            activeOpacity={0.8}
            testID="focus-resume"
          >
            <View style={[styles.focusResumeDot, { backgroundColor: theme.status.pickup }]} />
            <Text style={[styles.focusResumeText, { color: theme.status.pickup }]}>
              {t("home.focus.resume", { room: inProgressRoom.room_number })} · {t("home.focus.inProgress")}
            </Text>
            <Ionicons name="chevron-forward" size={13} color={theme.status.pickup} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/* ─── Shift progress — done/total for the whole shift, no per-room tiles ───── */

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ShiftProgressCard({
  snapshot,
  t,
  shiftStart,
  nextVipArrival,
}: {
  snapshot: ShiftSnapshot;
  t: Translate;
  /** Real clock-in time from the shift session; null until it resolves (offline, not yet loaded). */
  shiftStart?: Date | null;
  /** Earliest upcoming VIP arrival with a real checkin time; null when there isn't one. */
  nextVipArrival?: Date | null;
}) {
  const theme = useTheme();
  const accent = useHousekeeperAccent();
  if (snapshot.total === 0) return null;

  const now = Date.now();
  const startMs = shiftStart?.getTime() ?? null;
  const endMs = startMs != null ? Math.max(now + snapshot.minutesLeft * 60_000, startMs + 60_000) : null;
  const span = startMs != null && endMs != null ? endMs - startMs : null;
  const showTimeline = startMs != null && endMs != null && span != null && span > 0;

  const nowPct = showTimeline ? clampPct(((now - startMs!) / span!) * 100) : 0;
  const vipMs = nextVipArrival?.getTime() ?? null;
  const vipVisible = showTimeline && vipMs != null && vipMs >= startMs! && vipMs <= endMs!;
  const vipPct = vipVisible ? clampPct(((vipMs! - startMs!) / span!) * 100) : null;

  return (
    <Card style={styles.shiftCard} testID="shift-progress-card">
      <View style={styles.shiftHeaderRow}>
        <Text style={[styles.shiftTitle, { color: theme.textMuted }]}>{t("home.shiftCard.title")}</Text>
        <Text style={[styles.shiftSummary, { color: theme.status.ready }]}>
          {t("home.heroProgress", { done: snapshot.done, total: snapshot.total })}
        </Text>
      </View>

      {showTimeline ? (
        <View testID="shift-timeline">
          <View style={[styles.timelineTrack, { backgroundColor: theme.surfaceMuted }]}>
            <View style={[styles.timelineFill, { width: `${nowPct}%`, backgroundColor: accent.bg }]} />
            <View style={[styles.timelineNowTick, { left: `${nowPct}%`, backgroundColor: theme.textPrimary }]} />
            {vipVisible ? (
              <View
                style={[styles.timelineVipMarker, { left: `${vipPct ?? 0}%`, backgroundColor: theme.accentBrass }]}
              />
            ) : null}
          </View>
          <View style={styles.timelineLabelRow}>
            <Text style={[styles.timelineLabel, { color: theme.textDisabled }]}>{formatClockTime(shiftStart!)}</Text>
            {vipVisible ? (
              <Text style={[styles.timelineLabel, { color: theme.accentBrass }]}>
                {t("home.shiftCard.vipAt", { time: formatClockTime(nextVipArrival!) })}
              </Text>
            ) : null}
            <Text style={[styles.timelineLabel, { color: theme.textDisabled }]}>{formatClockTime(new Date(endMs!))}</Text>
          </View>
        </View>
      ) : (
        <ProgressBar value={snapshot.done} total={snapshot.total} color={accent.bg} />
      )}

      {snapshot.minutesLeft > 0 ? (
        <Text style={[styles.shiftMeta, { color: theme.textMuted }]}>
          {t("home.minutesLeft", { minutes: snapshot.minutesLeft })}
          {snapshot.finishByLabel ? ` · ${t("home.finishBy", { time: snapshot.finishByLabel })}` : ""}
        </Text>
      ) : null}
    </Card>
  );
}

/* ─── Needs you — real, actionable signals only; never a fabricated inbox ─── */

export interface NeedsYouItem {
  key: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  tone: "alert" | "caution" | "info";
  title: string;
  subtitle: string;
  actionLabel: string;
  onPress: () => void;
}

export function NeedsYouRow({ item }: { item: NeedsYouItem }) {
  const theme = useTheme();
  const palette = {
    alert: { bg: theme.status.dirtySoft, fg: theme.status.dirty, border: theme.status.dirtyLine },
    caution: { bg: theme.status.pickupSoft, fg: theme.status.pickup, border: theme.status.pickupLine },
    info: { bg: theme.status.cleanSoft, fg: theme.status.clean, border: theme.status.cleanLine },
  }[item.tone];
  return (
    <Card style={styles.needsRow} testID={`needs-you-${item.key}`}>
      <View style={[styles.needsIconWrap, { backgroundColor: palette.bg, borderColor: palette.border }]}>
        <Ionicons name={item.icon} size={15} color={palette.fg} />
      </View>
      <View style={styles.needsBody}>
        <Text style={[styles.needsTitle, { color: theme.textPrimary }]}>{item.title}</Text>
        <Text style={[styles.needsSubtitle, { color: theme.textSecondary }]}>{item.subtitle}</Text>
      </View>
      <TouchableOpacity
        onPress={item.onPress}
        activeOpacity={0.8}
        style={styles.needsAction}
        accessibilityRole="button"
        accessibilityLabel={item.actionLabel}
      >
        <Text style={[styles.needsActionText, { color: theme.primaryAction }]}>{item.actionLabel}</Text>
      </TouchableOpacity>
    </Card>
  );
}

const styles = StyleSheet.create({
  focusCard: {
    borderRadius: R.xl,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  focusKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  focusKickerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  focusPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  focusKicker: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  focusEta: {
    fontFamily: monoFont,
    fontSize: 12,
    fontWeight: "800",
  },
  focusTitleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 13,
  },
  focusRoomNumber: {
    fontFamily: serifFont,
    fontSize: 44,
    lineHeight: 42,
  },
  focusTitleBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  focusRoomType: {
    fontSize: 12.5,
    fontWeight: "700",
  },
  focusElapsedStack: {
    alignItems: "flex-end",
    flex: 0,
  },
  focusElapsedClock: {
    fontFamily: monoFont,
    fontSize: 26,
    fontWeight: "600",
    letterSpacing: -0.5,
  },
  focusProgressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  focusProgressFill: {
    height: 4,
    borderRadius: 2,
  },
  focusPaceText: {
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 2,
  },
  focusButtonRow: {
    flexDirection: "row",
    gap: 8,
  },
  focusPrimaryButton: {
    flex: 1,
  },
  focusIconButton: {
    width: 52,
    minHeight: 48,
    borderRadius: R.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  focusResumeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingTop: 2,
  },
  focusResumeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  focusResumeText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "700",
  },

  shiftCard: {
    gap: 10,
  },
  shiftHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  shiftTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  shiftSummary: {
    fontSize: 12.5,
    fontWeight: "700",
  },
  timelineTrack: {
    position: "relative",
    height: 8,
    borderRadius: 4,
    overflow: "visible",
  },
  timelineFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: 8,
    borderRadius: 4,
  },
  timelineNowTick: {
    position: "absolute",
    top: -3,
    width: 2,
    height: 14,
    marginLeft: -1,
  },
  timelineVipMarker: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 4,
    marginLeft: -8,
  },
  timelineLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  timelineLabel: {
    fontFamily: monoFont,
    fontSize: 10.5,
    fontWeight: "600",
  },
  shiftMeta: {
    fontSize: 12,
    fontWeight: "600",
  },

  needsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  needsIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  needsBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  needsTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  needsSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  needsAction: {
    minHeight: 44,
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  needsActionText: {
    fontSize: 12.5,
    fontWeight: "800",
  },
});

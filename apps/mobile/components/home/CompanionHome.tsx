import type { ComponentProps } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  R,
  darkStatusTokens,
  lightTheme,
  monoFont,
  statusTokens,
} from "@/components/shared/tokens";
import { getStatusMeta } from "@/components/shared/evening";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import type { SmartQueueEntry } from "@/lib/ai/briefing";
import type { ShiftSnapshot } from "@/lib/ai/companion";
import { isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Shift mosaic — the whole day in one glance ────────────────────────────
   One tile per assigned room on the dark hero, colored by the protected
   status contract. Filled tiles are handled (teal ready, blue submitted);
   soft tiles are still ahead (rose dirty, amber pickup, stone OOO). Tiles
   are spatial (sorted by room number), never an ordered work queue — the
   queue lives in My Rooms. */

export interface TileVisual {
  bg: string;
  fg: string;
  border: string;
}

export function getTileVisual(status: string): TileVisual {
  switch (status) {
    case "INSPECTED":
      return { bg: statusTokens.ready, fg: lightTheme.shell.ink, border: "transparent" };
    case "CLEAN":
      return { bg: statusTokens.clean, fg: lightTheme.shell.ink, border: "transparent" };
    case "IN_PROGRESS":
      return { bg: darkStatusTokens.pickupSoft, fg: statusTokens.pickupLine, border: "rgba(228,193,116,0.55)" };
    case "PICKUP":
      return { bg: darkStatusTokens.pickupSoft, fg: statusTokens.pickupLine, border: "transparent" };
    case "DIRTY":
    case "OCCUPIED":
      return { bg: darkStatusTokens.dirtySoft, fg: statusTokens.dirtyLine, border: "transparent" };
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return { bg: darkStatusTokens.outOfOrderSoft, fg: statusTokens.outOfOrderLine, border: "transparent" };
    default:
      return { bg: lightTheme.shell.raised, fg: lightTheme.shell.ink2, border: "transparent" };
  }
}

export function ShiftMosaic({ rooms, onPressRoom }: { rooms: Room[]; onPressRoom: (room: Room) => void }) {
  const ordered = [...rooms].sort((a, b) =>
    a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" }),
  );
  return (
    <View style={styles.mosaic} testID="shift-mosaic">
      {ordered.map((room) => {
        const visual = getTileVisual(room.status);
        return (
          <TouchableOpacity
            key={room.id}
            style={[styles.tile, { backgroundColor: visual.bg, borderColor: visual.border }]}
            onPress={() => onPressRoom(room)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`${room.room_number} — ${getStatusMeta(room.status).label}`}
            testID={`mosaic-tile-${room.room_number}`}
          >
            <Text style={[styles.tileText, { color: visual.fg }]}>{room.room_number}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ─── Signal chips — quiet, only when there is something to know ──────────── */

interface HandRolledSignalChip {
  key: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  bg: string;
  fg: string;
}

interface StatusSignalChip {
  key: string;
  label: string;
  statusKey: StatusKey;
}

type SignalChipSpec = HandRolledSignalChip | StatusSignalChip;

export function SignalChips({ snapshot, t }: { snapshot: ShiftSnapshot; t: Translate }) {
  const theme = useTheme();
  const chips: SignalChipSpec[] = [];
  if (snapshot.attention > 0) {
    chips.push({
      key: "review",
      label: t("home.signal.review", { count: snapshot.attention }),
      statusKey: "pickup",
    });
  }
  if (snapshot.dndCount > 0) {
    chips.push({
      key: "dnd",
      icon: "moon-outline",
      label: t("home.signal.dnd", { count: snapshot.dndCount }),
      bg: theme.shell.raised,
      fg: theme.shell.ink2,
    });
  }
  if (snapshot.arrivals > 0) {
    chips.push({
      key: "arrivals",
      label: t("home.signal.arrivals", { count: snapshot.arrivals }),
      statusKey: "clean",
    });
  }
  if (chips.length === 0) return null;
  return (
    <View style={styles.signalRow}>
      {chips.map((chip) => (
        <View key={chip.key} testID={`signal-${chip.key}`}>
          {"statusKey" in chip ? (
            <StatusBadge statusKey={chip.statusKey} label={chip.label} />
          ) : (
            <View style={[styles.signalChip, { backgroundColor: chip.bg }]}>
              <Ionicons name={chip.icon} size={11} color={chip.fg} />
              <Text style={[styles.signalText, { color: chip.fg }]}>{chip.label}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/* ─── Focus card — the one room to start next (never a queue) ─────────────── */

function getFocusReason(room: Room, t: Translate): string {
  if (room.status === "IN_PROGRESS") return t("home.focus.reasonInProgress");
  if (isArrivalSoon(room)) return t("home.focus.reasonArrival");
  if (room.clean_type === "DEP") return t("home.focus.reasonDeparture");
  return t("home.focus.reasonDefault");
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
  const room = entry.room;
  const roomType = room.room_type_code ?? room.rooms?.room_types?.code ?? null;
  const startLabel =
    room.status === "IN_PROGRESS"
      ? t("home.focus.resume", { room: room.room_number })
      : t("home.startWith", { room: room.room_number });
  return (
    <View testID="focus-card">
      <Card style={styles.focusCard}>
      <View style={styles.focusKickerRow}>
        <Text style={[styles.focusKicker, { color: theme.primary }]}>{t("home.focus.kicker")}</Text>
        <Text style={[styles.focusEta, { color: theme.textMuted }]}>
          {t("home.focus.estMinutes", { minutes: entry.estimateMinutes })}
        </Text>
      </View>
      <View style={styles.focusTitleRow}>
        <Text style={[styles.focusRoomNumber, { color: theme.textPrimary }]}>{room.room_number}</Text>
        <View style={styles.focusTitleBody}>
          {roomType ? (
            <Text style={[styles.focusRoomType, { color: theme.textMuted }]} numberOfLines={1}>
              {roomType}
            </Text>
          ) : null}
          <Text style={[styles.focusReason, { color: theme.textSecondary }]}>{getFocusReason(room, t)}</Text>
        </View>
      </View>
      <Button
        label={startLabel}
        onPress={() => onStart(room)}
        testID="focus-start"
        icon="arrow-forward"
      />
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
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  mosaic: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 15,
  },
  tile: {
    minWidth: 46,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  tileText: {
    fontFamily: monoFont,
    fontSize: 12.5,
    fontWeight: "800",
  },

  signalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 11,
  },
  signalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  signalText: {
    fontSize: 11,
    fontWeight: "700",
  },

  focusCard: {
    borderRadius: R.xl,
    padding: 16,
    gap: 12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  focusKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    alignItems: "center",
    gap: 13,
  },
  focusRoomNumber: {
    fontFamily: monoFont,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "800",
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
  focusReason: {
    fontSize: 13,
    lineHeight: 18,
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
});

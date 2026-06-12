import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, R, monoFont } from "@/components/shared/tokens";
import { getTileVisual } from "@/components/home/CompanionHome";
import { getStatusMeta, ProgressBar, StatusRail } from "@/components/shared/evening";
import { Avatar } from "@/components/shared/mobileHandoff";
import type { FloorRoom, TeamLoad } from "@/lib/housekeeping/supervisor";

/* ─── Supervisor atoms — Evening Lobby language for the floor-command view ── */

/** Dark-hero signal chip spec, the same idiom the Orders hero uses. */
export interface HeroSignal {
  key: string;
  label: string;
  fg: string;
  bg: string;
  line: string;
}

export function HeroSignalRow({ signals }: { signals: HeroSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <View style={styles.signalRow}>
      {signals.map((signal) => (
        <View
          key={signal.key}
          style={[styles.signalChip, { backgroundColor: signal.bg, borderColor: signal.line }]}
          testID={`hero-signal-${signal.key}`}
        >
          <Text style={[styles.signalText, { color: signal.fg }]}>{signal.label}</Text>
        </View>
      ))}
    </View>
  );
}

/* ─── Floor mosaic — every room on the board, one quiet tile each ──────────── */

export function FloorMosaic({
  rooms,
  getLabel,
}: {
  rooms: Pick<FloorRoom, "roomId" | "roomNumber" | "status">[];
  getLabel: (status: string) => string;
}) {
  return (
    <View style={styles.mosaic} testID="floor-mosaic">
      {rooms.map((room) => {
        const visual = getTileVisual(room.status);
        return (
          <View
            key={room.roomId}
            style={[styles.mosaicTile, { backgroundColor: visual.bg, borderColor: visual.border }]}
            accessible
            accessibilityLabel={`${room.roomNumber} — ${getLabel(room.status)}`}
          >
            <Text style={[styles.mosaicText, { color: visual.fg }]}>{room.roomNumber}</Text>
          </View>
        );
      })}
    </View>
  );
}

/* ─── Room status tile — the paper board cell ──────────────────────────────── */

export function RoomStatusTile({
  room,
  assigneeName,
  onPress,
}: {
  room: FloorRoom;
  assigneeName: string | null;
  onPress: () => void;
}) {
  const meta = getStatusMeta(room.status);
  return (
    <TouchableOpacity
      style={[styles.tile, { backgroundColor: meta.bg, borderColor: meta.border }]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${room.roomNumber} — ${meta.label}`}
      testID={`board-tile-${room.roomNumber}`}
    >
      <StatusRail status={room.status} />
      <View style={styles.tileBody}>
        <View style={styles.tileTopRow}>
          <Text style={[styles.tileNumber, { color: meta.fg }]}>{room.roomNumber}</Text>
          <View style={styles.tileIcons}>
            {room.vip ? <Ionicons name="star" size={10} color={C.brass} /> : null}
            {room.dnd ? <Ionicons name="moon" size={10} color={C.ink3} /> : null}
            {room.openWorkOrder ? <Ionicons name="construct" size={10} color={C.caution} /> : null}
            {room.latestNote ? <Ionicons name="chatbox" size={10} color={C.info} /> : null}
          </View>
        </View>
        <Text style={styles.tileAssignee} numberOfLines={1}>
          {assigneeName ? assigneeName.split(/\s+/)[0] : "—"}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ─── Team load row — one housekeeper's day at a glance ────────────────────── */

export function TeamLoadRow({
  load,
  summary,
  onPress,
}: {
  load: TeamLoad;
  /** Pre-localized "{done} of {total} done · ~{m}m left" line */
  summary: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.loadRow}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.8}
      testID={`team-load-${load.housekeeperId}`}
    >
      <Avatar name={load.name} size={38} />
      <View style={styles.loadBody}>
        <View style={styles.loadTitleRow}>
          <Text style={styles.loadName} numberOfLines={1}>{load.name}</Text>
          {load.inProgress > 0 ? <View style={styles.loadActiveDot} /> : null}
          <Text style={styles.loadCount}>{load.done}/{load.total}</Text>
        </View>
        <ProgressBar value={load.done} total={load.total} color={C.ready} />
        <Text style={styles.loadSummary}>{summary}</Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={14} color={C.ink4} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  signalChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  signalText: { fontSize: 11, fontWeight: "800" },

  mosaic: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 15 },
  mosaicTile: {
    minWidth: 42,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 5.5,
    alignItems: "center",
    justifyContent: "center",
  },
  mosaicText: { fontFamily: monoFont, fontSize: 11.5, fontWeight: "800" },

  tile: {
    width: "31.5%",
    flexGrow: 1,
    maxWidth: "33%",
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: R.md,
  },
  tileBody: { paddingLeft: 12, paddingRight: 8, paddingVertical: 9, gap: 3 },
  tileTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  tileNumber: { fontFamily: monoFont, fontSize: 16, fontWeight: "800" },
  tileIcons: { flexDirection: "row", alignItems: "center", gap: 3 },
  tileAssignee: { fontSize: 10.5, fontWeight: "600", color: C.ink3 },

  loadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  loadBody: { flex: 1, minWidth: 0, gap: 6 },
  loadTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  loadName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "700", color: C.ink },
  loadActiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.caution },
  loadCount: { fontFamily: monoFont, fontSize: 12, fontWeight: "800", color: C.ink3 },
  loadSummary: { fontSize: 11.5, color: C.ink3 },
});

import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { monoFont } from "@/components/shared/tokens";
import { Avatar, SectionLabel } from "@/components/shared/mobileHandoff";
import { ProgressBar } from "@/components/shared/evening";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import type { TeamLoad } from "@/lib/housekeeping/supervisor";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Team — interim presentation ───────────────────────────────────────────
   Phase 2 delivers the Rooms view; the redesigned Team view is Phase 3. Until then the Team tab keeps the
   existing per-housekeeper load cards, fed from the same verified rooms as the Rooms tab, with two honest
   changes: a room chip opens the same room sheet (no native alert), and no "minutes left" is shown — the old
   figure padded unknown estimates with a default. It is replaced wholesale by the Phase 3 Team view. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const ROOM_STATUS_KEYS: Record<string, StatusKey> = {
  DIRTY: "dirty",
  OCCUPIED: "occupied",
  PICKUP: "pickup",
  IN_PROGRESS: "inProgress",
  CLEAN: "clean",
  INSPECTED: "ready",
  OOO: "outOfOrder",
  OUT_OF_ORDER: "outOfOrder",
  OUT_OF_SERVICE: "outOfOrder",
};

export function TeamInterim({ loads, onRoomPress, t }: { loads: TeamLoad[]; onRoomPress: (roomId: string) => void; t: Translate }) {
  if (loads.length === 0) return null;
  return (
    <View style={styles.wrap} testID="assignments-team-interim">
      <SectionLabel hint={t("assignments.housekeeperCount", { count: loads.length })}>{t("assignments.teamSection")}</SectionLabel>
      <View style={styles.rows}>
        {loads.map((load) => (
          <LoadCard key={load.housekeeperId} load={load} onRoomPress={onRoomPress} t={t} />
        ))}
      </View>
    </View>
  );
}

function LoadCard({ load, onRoomPress, t }: { load: TeamLoad; onRoomPress: (roomId: string) => void; t: Translate }) {
  const theme = useTheme();
  const name = load.name === "—" ? t("assignments.v2.card.assigneeUnknown") : load.name;
  return (
    <View testID={`load-card-${load.housekeeperId}`}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <Avatar name={load.name === "—" ? "?" : name} size={36} />
          <View style={styles.headerBody}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={1}>
              {name}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: theme.textMuted }]}>
              {t("assignments.v2.team.loadSummary", { done: load.done, total: load.total })}
            </Text>
          </View>
          {load.inProgress > 0 ? <View style={[styles.activeDot, { backgroundColor: theme.status.pickup }]} /> : null}
        </View>
        <ProgressBar value={load.done} total={load.total} color={theme.status.ready} />
        <View style={styles.chips}>
          {load.rooms.map((room) => {
            const statusKey = ROOM_STATUS_KEYS[room.status];
            const statusLabel = t(statusKey ? `rooms.card.status.${room.status}` : "rooms.card.status.UNKNOWN", { status: room.status.replace(/_/g, " ") });
            return (
              <Pressable
                key={room.roomId}
                onPress={() => onRoomPress(room.roomId)}
                accessibilityRole="button"
                accessibilityLabel={`${room.roomNumber} — ${statusLabel}`}
                style={styles.chipHit}
                testID={`team-room-${room.roomNumber}`}
              >
                {statusKey ? (
                  <StatusBadge statusKey={statusKey} label={room.roomNumber} />
                ) : (
                  <View style={[styles.roomChip, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                    <Text style={[styles.roomChipText, { color: theme.textMuted }]}>{room.roomNumber}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, gap: 8 },
  rows: { gap: 8 },
  card: { padding: 14, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  headerBody: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontSize: 14, fontWeight: "700" },
  summary: { fontSize: 11.5 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chipHit: { minHeight: 44, justifyContent: "center" },
  roomChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  roomChipText: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "800" },
});

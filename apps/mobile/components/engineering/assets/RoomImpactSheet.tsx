import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Note } from "@/components/engineering/workorder/sheetKit";
import { AvailabilityBadge, OccupancyBadge } from "@/components/engineering/rooms/roomUi";
import { StatusBadge } from "@/components/engineering/assets/assetUi";
import { fetchRoomRow } from "@/lib/api/engineeringRooms";
import { formatDayTime } from "@/lib/engineering/assetFormat";
import type { RoomImpact } from "@/lib/engineering/roomImpact";
import { roomRoute, workOrderRoute } from "@/lib/engineering/routes";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  impact: RoomImpact;
  assetName: string;
  assetTag: string | null | undefined;
  scope: string | null;
  language: string;
  timezone: string | null | undefined;
  onClose: () => void;
}

/**
 * Review Room Impact: confirmed facts about this equipment and the room it serves, plus links to the places where a
 * decision is made. It changes nothing. Room availability is set only through the existing authorised room workflow
 * (reached via Open Room), and a repair or downtime record here never implies the room can or cannot be sold.
 */
export function RoomImpactSheet({ visible, impact, assetName, assetTag, scope, language, timezone, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  // The room's own state is a separate read, only made while the sheet is open; a role that may not read it just sees the note.
  const room = useAsyncResource((signal) => fetchRoomRow(impact.roomId as string, signal), {
    scope,
    key: `room-impact:${impact.roomId}`,
    enabled: visible && impact.hasRoom,
  });
  const row = room.data ?? null;
  const roomTarget = roomRoute(impact.roomId);
  const open = (target: unknown) => {
    onClose();
    router.push(target as never);
  };

  return (
    <BottomSheet visible={visible} title={t("assets.roomImpact.title")} onClose={onClose} testID="room-impact-sheet">
      <View style={styles.block}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]}>
          {assetName}
        </Text>
        {assetTag?.trim() ? <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>{assetTag.trim()}</Text> : null}
        <Text style={[styles.label, { color: theme.textMuted }]}>{t("assets.roomImpact.equipment")}</Text>
        <View style={styles.row}>
          <StatusBadge status={impact.serviceStatus} />
          {impact.downtimeSince ? (
            <Text style={{ color: theme.textSecondary, fontSize: 12.5 }}>
              {t("assets.roomImpact.downSince", { date: formatDayTime(impact.downtimeSince, timezone, language) })}
            </Text>
          ) : (
            <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>{t("assets.roomImpact.noDowntime")}</Text>
          )}
        </View>
      </View>

      <View style={styles.block}>
        <Text style={[styles.label, { color: theme.textMuted }]}>{t("assets.roomImpact.serves")}</Text>
        {impact.hasRoom ? (
          <>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]} testID="room-impact-room">
              {t("assets.roomLabel", { room: impact.roomNumber })}
              {row?.floor != null ? `  ·  ${t("assets.roomImpact.floor", { floor: row.floor })}` : ""}
              {row?.building ? `  ·  ${row.building}` : ""}
            </Text>
            {row ? (
              <View style={styles.row} testID="room-impact-room-state">
                <OccupancyBadge occupancy={row.occupancy} />
                {row.availability ? <AvailabilityBadge availability={row.availability} /> : null}
              </View>
            ) : (
              <Note testID="room-impact-room-unread">{room.loading ? t("common.loading") : t("assets.roomImpact.roomUnread")}</Note>
            )}
          </>
        ) : (
          <Text style={{ color: theme.textSecondary, fontSize: 14 }} testID="room-impact-shared">
            {impact.locationText ? t("assets.roomImpact.shared", { place: impact.locationText }) : t("assets.roomImpact.noRoom")}
          </Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={[styles.label, { color: theme.textMuted }]}>{t("assets.roomImpact.repairs", { count: impact.activeRepairs.length })}</Text>
        {impact.activeRepairs.length === 0 ? (
          <Text style={{ color: theme.textMuted, fontSize: 13.5 }}>{t("assets.roomImpact.noRepairs")}</Text>
        ) : (
          impact.activeRepairs.map((wo) => {
            const target = workOrderRoute(wo.id);
            return (
              <Pressable
                key={wo.id}
                disabled={!target}
                onPress={() => target && open(target)}
                accessibilityRole="button"
                accessibilityLabel={t("assets.workOrders.open", { title: wo.title })}
                style={[styles.link, { borderColor: theme.border }]}
                testID={`room-impact-wo-${wo.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={{ color: theme.textPrimary, fontSize: 14 }}>
                    {wo.title}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    {[workOrderLabel(wo), t(`workOrders.status.${wo.status}`)].filter(Boolean).join("  ·  ")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
              </Pressable>
            );
          })
        )}
      </View>

      {impact.hasRoom && roomTarget ? (
        <Pressable
          onPress={() => open(roomTarget)}
          accessibilityRole="button"
          accessibilityLabel={t("assets.roomImpact.openRoom")}
          style={[styles.link, { borderColor: theme.border }]}
          testID="room-impact-open-room"
        >
          <Ionicons name="bed-outline" size={18} color={theme.primary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.primary, fontSize: 14.5, fontWeight: "700", flex: 1 }}>
            {t("assets.roomImpact.openRoom")}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
        </Pressable>
      ) : null}
      <Note testID="room-impact-scope">{t("assets.roomImpact.scope")}</Note>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6, marginBottom: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  strong: { fontSize: 15, fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 4 },
  link: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
});

import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { cleanTypeLabel, formatClock, type TextContext, type Translate } from "@/lib/housekeeping/myRoomsText";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  room: Room;
  ctx: TextContext;
}

/** Inspected: read-only. There is no action here that reopens the room. */
export function ReadyRoomView({ room, ctx }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const cleaned = formatClock(room.last_cleaned_at, ctx);
  const inspected = formatClock(room.last_inspected_at, ctx);
  const type = cleanTypeLabel(room, t as Translate);

  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (type) rows.push({ key: "type", label: t("rooms.work.submitted.cleanType"), value: type });
  if (cleaned) rows.push({ key: "cleaned", label: t("rooms.work.ready.cleanedAt"), value: cleaned });
  if (inspected) rows.push({ key: "inspected", label: t("rooms.work.ready.inspectedAt"), value: inspected });

  return (
    <View style={styles.root} testID="ready-room-view">
      <View style={[styles.hero, { backgroundColor: theme.status.readySoft, borderColor: theme.status.readyLine }]}>
        <Ionicons name="shield-checkmark" size={44} color={theme.status.ready} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {t("rooms.work.ready.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("rooms.work.ready.body")}
        </Text>
      </View>
      {rows.length > 0 ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {rows.map((row) => (
            <View key={row.key} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
                {row.label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  hero: { borderWidth: 1, borderRadius: 18, padding: 20, alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "900", textAlign: "center" },
  body: { fontSize: 15, lineHeight: 21, textAlign: "center" },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 6 },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 14, fontWeight: "700" },
  rowValue: { flexShrink: 1, fontSize: 15, fontWeight: "800", textAlign: "right" },
});

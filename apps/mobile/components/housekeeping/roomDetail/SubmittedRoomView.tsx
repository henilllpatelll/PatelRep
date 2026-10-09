import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { getProgress, type LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { confirmedDurationMinutes } from "@/lib/housekeeping/cleaningTimer";
import { cleanTypeLabel, type Translate } from "@/lib/housekeeping/myRoomsText";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  room: Room;
  /** The retained, server-confirmed record — absent when this device never held one. */
  session: LocalCleanSession | undefined;
}

/**
 * Shown only once the SERVER says the room is CLEAN (or confirmed the completion).
 * A completion that is merely queued never reaches this view. The room is awaiting
 * inspection — this screen never calls it guest-ready.
 */
export function SubmittedRoomView({ room, session }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const confirmed = session?.completionConfirmed ? session : undefined;
  const minutes = confirmedDurationMinutes(confirmed?.durationSeconds);
  const progress = confirmed ? getProgress(confirmed.checklist) : null;
  const type = cleanTypeLabel(room, t as Translate);

  const rows: Array<{ key: string; label: string; value: string }> = [];
  if (type) rows.push({ key: "type", label: t("rooms.work.submitted.cleanType"), value: type });
  if (minutes !== null) rows.push({ key: "duration", label: t("rooms.work.submitted.duration"), value: t("rooms.work.submitted.minutes", { minutes }) });
  if (progress && progress.total > 0) rows.push({ key: "checklist", label: t("rooms.work.submitted.checklist"), value: `${progress.done} / ${progress.total}` });
  rows.push({ key: "status", label: t("rooms.work.submitted.status"), value: t("rooms.work.submitted.awaitingInspection") });

  return (
    <View style={styles.root} testID="submitted-room-view">
      <View style={[styles.hero, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]}>
        <Ionicons name="checkmark-circle" size={44} color={theme.status.clean} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {t("rooms.work.submitted.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("rooms.work.submitted.body")}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {rows.map((row) => (
          <View key={row.key} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`} testID={`submitted-${row.key}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
              {row.label}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
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

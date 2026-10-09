import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { formatBlockerTimeInput, type RoomBlocker } from "@/lib/housekeeping/roomBlockers";
import type { useRoomReports } from "@/lib/housekeeping/useRoomReports";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";
import { Chip, FieldLabel, StatusText } from "./FormBits";

interface Props {
  visible: boolean;
  room: Room;
  /** Room-condition flags that create follow-up work (not access problems). */
  flags: RoomBlocker[];
  isOnline: boolean;
  reports: ReturnType<typeof useRoomReports>;
  onClose: () => void;
}

/**
 * Pet room, smoke smell and late checkout: each creates real follow-up work (a work
 * order, an ozone task, a front-desk request). They used to sit inline on the
 * hub; access problems moved to Can't Enter.
 */
export function RoomFlagsSheet({ visible, room, flags, isOnline, reports, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [timeKey, setTimeKey] = useState<string | null>(null);
  const [timeText, setTimeText] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (visible) {
      setTimeKey(null);
      setTimeText("");
      setDone(false);
    }
  }, [visible]);

  const active = timeKey ? flags.find((flag) => flag.key === timeKey) : undefined;
  const busy = reports.blockerBusy != null;

  async function send(flag: RoomBlocker, time?: string) {
    if (await reports.submitBlocker(flag, time)) {
      setTimeKey(null);
      setTimeText("");
      setDone(true);
    }
  }

  return (
    <BottomSheet visible={visible} title={t("rooms.work.flags.title", { room: room.room_number })} onClose={onClose} testID="flags-sheet">
      {done ? <StatusText tone="ok" message={t("rooms.work.more.reported")} testID="flags-done" /> : null}
      {!isOnline ? <StatusText tone="warn" message={t("rooms.detail.alerts.blockersNeedConnection")} /> : null}
      <FieldLabel>{t("rooms.work.flags.eyebrow")}</FieldLabel>
      {flags.map((flag) => (
        <Pressable
          key={flag.key}
          onPress={() => {
            if (flag.needsTime) {
              setTimeKey(timeKey === flag.key ? null : flag.key);
              setTimeText("");
              return;
            }
            void send(flag);
          }}
          disabled={!isOnline || busy}
          accessibilityRole="button"
          accessibilityLabel={t(flag.labelKey)}
          accessibilityState={{ disabled: !isOnline || busy, busy: reports.blockerBusy === flag.key }}
          style={[styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: timeKey === flag.key ? theme.primaryLine : theme.border }, (!isOnline || busy) && styles.dim]}
          testID={`flag-${flag.key}`}
        >
          <Ionicons name="flag-outline" size={20} color={theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
            {t(flag.labelKey)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
        </Pressable>
      ))}

      {active ? (
        <View style={[styles.form, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} testID="flags-time-entry">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.timeLabel, { color: theme.textSecondary }]}>
            {t("blockers.timePrompt")}
          </Text>
          <View style={styles.chips}>
            {(active.timePresets ?? []).map((preset) => (
              <Chip key={preset} label={preset} selected={timeText === preset} onPress={() => setTimeText(preset)} />
            ))}
          </View>
          <TextInput
            style={[styles.timeInput, { borderColor: theme.border, backgroundColor: theme.surface, color: theme.textPrimary }]}
            value={timeText}
            onChangeText={setTimeText}
            onEndEditing={() => setTimeText(formatBlockerTimeInput(timeText))}
            placeholder={t("blockers.timePlaceholder")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("blockers.timePrompt")}
            testID="flags-time-input"
          />
          <Button
            label={t("blockers.report")}
            onPress={() => void send(active, timeText)}
            loading={reports.blockerBusy === active.key}
            disabled={!timeText.trim() || busy || !isOnline}
            testID="flags-time-submit"
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "700" },
  dim: { opacity: 0.5 },
  form: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  timeLabel: { fontSize: 13, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeInput: { minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
});

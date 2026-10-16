import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { usePalette, type Palette } from "@/components/ai/palette";

const MAX_FONT_SCALE = 1.6;
const MAX_ROOMS = 40;

export interface PickableRoom {
  id: string;
  room_number: string;
}

/** Natural order, so 99 comes before 100 and 2A before 10. */
export function sortRooms<T extends PickableRoom>(rooms: readonly T[]): T[] {
  return [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true, sensitivity: "base" }));
}

interface Props {
  /** The person's own rooms: ids come from their loaded list, never typed. */
  rooms: readonly PickableRoom[];
  onPick: (roomId: string) => void;
  /** The problem is not in one of their rooms: describe it to the assistant instead. */
  onDescribe: () => void;
  onBack: () => void;
  palette?: Palette;
}

/** "Which room?" for reporting an issue when the assistant was not opened from a room. */
export function RoomPickerPanel({ rooms, onPick, onDescribe, onBack, palette }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const sorted = useMemo(() => sortRooms(rooms).slice(0, MAX_ROOMS), [rooms]);

  return (
    <View style={styles.wrap} testID="room-picker">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.title}>
        {t("assistant.rooms.title")}
      </Text>
      {sorted.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.muted} testID="room-picker-empty">
          {t("assistant.rooms.empty")}
        </Text>
      ) : (
        <View style={styles.grid}>
          {sorted.map((room) => (
            <Pressable
              key={room.id}
              accessibilityRole="button"
              accessibilityLabel={t("assistant.rooms.pick", { room: room.room_number })}
              onPress={() => onPick(room.id)}
              style={styles.room}
              testID={`room-picker-${room.room_number}`}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.roomText}>
                {room.room_number}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={onDescribe} style={styles.secondary} testID="room-picker-describe">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.secondaryText}>
          {t("assistant.rooms.describe")}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.ghost} testID="room-picker-back">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.ghostText}>
          {t("common.back")}
        </Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    wrap: { gap: 10 },
    title: { fontSize: 17, fontWeight: "800", color: theme.textPrimary },
    muted: { fontSize: 14, lineHeight: 20, color: theme.textMuted },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    room: { minWidth: 72, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.ai.line, backgroundColor: theme.surfaceElevated, alignItems: "center", justifyContent: "center" },
    roomText: { fontSize: 16, fontWeight: "800", color: theme.textPrimary },
    secondary: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
    secondaryText: { fontSize: 14.5, fontWeight: "700", color: theme.textPrimary, textAlign: "center" },
    ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
    ghostText: { fontSize: 15, fontWeight: "600", color: theme.textSecondary },
  });

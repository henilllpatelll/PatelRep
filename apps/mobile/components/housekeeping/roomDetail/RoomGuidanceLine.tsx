import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { TextLine } from "@/lib/housekeeping/roomAssist";
import { MAX_FONT_SCALE } from "./BottomSheet";

/** One quiet line of guidance from the room's own records (see buildRoomGuidance). Static text: it never announces itself. */
export function RoomGuidanceLine({ line }: { line: TextLine }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const text = t(line.key, line.params);
  return (
    <View style={styles.row} accessible accessibilityLabel={text} testID="room-guidance">
      <Ionicons name="information-circle-outline" size={16} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.text, { color: theme.textSecondary }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 4 },
  text: { flex: 1, fontSize: 13.5, lineHeight: 19 },
});

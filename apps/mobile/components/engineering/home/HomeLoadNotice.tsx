import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { HOME_MAX_FONT, HOME_MIN_TOUCH, homeStyles } from "./homeStyles";

/** A section that could not load, with its own retry. The rest of Home keeps showing what it has. */
export function HomeLoadNotice({ message, actionLabel, onPress, testID }: { message: string; actionLabel: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${message}. ${actionLabel}`}
      style={[styles.row, { borderColor: theme.status.pickupLine, backgroundColor: theme.status.pickupSoft }]}
      testID={testID}
    >
      <Ionicons name="alert-circle-outline" size={16} color={theme.status.pickup} />
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.status.pickup, flex: 1 }]}>
        {message}
      </Text>
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.link, { color: theme.status.pickup }]}>
        {actionLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: HOME_MIN_TOUCH, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8 },
});

import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

interface Props {
  name: ComponentProps<typeof Ionicons>["name"];
  color: string;
  focused: boolean;
  /** Fill behind the selected icon (the nav surface's raised tone). */
  activeFill: string;
  /** Five or more tabs: a narrower pill so the bar still fits small phones. */
  compact?: boolean;
}

/** V2 tab glyph: a quiet pill behind the selected destination so it is not signalled by color
 *  alone. Static (no animation), so there is nothing to disable for Reduce Motion and no remount
 *  when the selection changes. */
export function TabIconV2({ name, color, focused, activeFill, compact = false }: Props) {
  return (
    <View style={[styles.pill, compact && styles.pillCompact, focused && { backgroundColor: activeFill }]} testID={focused ? "tab-icon-active" : undefined}>
      <Ionicons name={name} size={22} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { width: 52, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  pillCompact: { width: 44 },
});

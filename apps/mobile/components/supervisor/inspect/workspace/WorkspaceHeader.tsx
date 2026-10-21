import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/* The compact bar that stays put while the checklist scrolls: back to the queue, which room, and More. */
export function WorkspaceHeader({
  title,
  topInset,
  t,
  onBack,
  onMore,
  moreDisabled,
}: {
  title: string;
  topInset: number;
  t: Translate;
  onBack: () => void;
  onMore?: () => void;
  moreDisabled?: boolean;
}) {
  const theme = useTheme();
  // On the narrowest phones (or with very large text) the title needs the room: the arrow alone, still named, is the back control.
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.3;
  return (
    <View style={[styles.bar, { paddingTop: topInset + 6, backgroundColor: theme.background, borderBottomColor: theme.borderSubtle }]} testID="workspace-header">
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t("inspect.workspace.backA11y")}
        hitSlop={6}
        style={styles.back}
        testID="workspace-back"
      >
        <Ionicons name="chevron-back" size={22} color={theme.primaryAction} />
        {compact ? null : (
          <Text maxFontSizeMultiplier={1.3} style={[styles.backText, { color: theme.primaryAction }]} numberOfLines={1}>
            {t("inspect.workspace.back")}
          </Text>
        )}
      </Pressable>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1} testID="workspace-title">
        {title}
      </Text>
      {onMore ? (
        <Pressable
          onPress={onMore}
          disabled={moreDisabled}
          accessibilityRole="button"
          accessibilityLabel={t("inspect.workspace.moreA11y")}
          accessibilityState={{ disabled: !!moreDisabled }}
          hitSlop={6}
          style={[styles.more, moreDisabled && { opacity: 0.4 }]}
          testID="workspace-more"
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={theme.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.more} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1 },
  back: { minHeight: MIN_TARGET, minWidth: 44, maxWidth: "34%", flexDirection: "row", alignItems: "center" },
  backText: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800" },
  more: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
});

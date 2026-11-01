import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { isSecondaryView } from "@/lib/engineering/workNavigation";
import type { QueueView } from "@/lib/engineering/workQueue";

interface Props {
  view: QueueView;
  /** The tabs: the work a person acts on now. */
  primary: QueueView[];
  /** Shortcuts to On hold and History, kept one tap away without competing with the tabs. */
  secondary: QueueView[];
  /** Where Back returns to (the role's default Work screen). */
  home: QueueView;
  onView: (view: QueueView) => void;
}

const SECONDARY_ICON: Partial<Record<QueueView, "pause-circle-outline" | "time-outline">> = {
  waiting: "pause-circle-outline",
  done: "time-outline",
};

/**
 * Primary tabs as a full-width segmented control; On hold and History as quiet shortcuts beneath it. Inside
 * either of those two views the tabs give way to a single Back row, so it is always clear where you are and
 * how to return.
 */
export function WorkViewTabs({ view, primary, secondary, home, onView }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (isSecondaryView(view)) {
    return (
      <View style={styles.wrap}>
        <Pressable
          onPress={() => onView(home)}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={t("workQueue.shortcuts.backTo", { view: t(`workQueue.viewTitles.${home}`) })}
          testID="wo-back"
        >
          <Ionicons name="chevron-back" size={18} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]} maxFontSizeMultiplier={1.3}>
            {t("workQueue.shortcuts.backTo", { view: t(`workQueue.viewTitles.${home}`) })}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.segments} accessibilityRole="tablist" accessibilityLabel={t("workQueue.shortcuts.viewsA11y")} testID="wo-views">
        {primary.map((item) => {
          const selected = item === view;
          return (
            <Pressable
              key={item}
              onPress={() => onView(item)}
              style={[styles.segment, { backgroundColor: selected ? theme.primaryAction : theme.surface, borderColor: selected ? theme.primaryAction : theme.border }]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              testID={`wo-view-${item}`}
            >
              <Text style={[styles.segmentText, { color: selected ? theme.shell.ink : theme.textSecondary }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                {t(`workQueue.views.${item}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {secondary.length > 0 ? (
        <View style={styles.shortcuts} accessibilityLabel={t("workQueue.shortcuts.otherViewsA11y")}>
          {secondary.map((item) => (
            <Pressable
              key={item}
              onPress={() => onView(item)}
              style={styles.shortcut}
              hitSlop={{ top: 4, bottom: 4 }}
              accessibilityRole="button"
              testID={`wo-view-${item}`}
            >
              <Ionicons name={SECONDARY_ICON[item] ?? "ellipse-outline"} size={16} color={theme.textSecondary} />
              <Text style={[styles.shortcutText, { color: theme.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {t(`workQueue.shortcuts.${item}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12 },
  segments: { flexDirection: "row", gap: 8 },
  segment: { flex: 1, minHeight: 44, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 14, fontWeight: "700" },
  shortcuts: { flexDirection: "row", gap: 20, paddingTop: 6, paddingHorizontal: 4 },
  shortcut: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 },
  shortcutText: { fontSize: 13.5, fontWeight: "600" },
  back: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, alignSelf: "flex-start", paddingRight: 12 },
  backText: { fontSize: 15, fontWeight: "700" },
});

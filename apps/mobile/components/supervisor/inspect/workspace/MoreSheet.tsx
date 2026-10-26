import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** The header's More menu. It only leads to read-only context and to the same save-and-exit question Back asks. */
export function MoreSheet({
  visible,
  t,
  onClose,
  onContext,
  onSaveExit,
}: {
  visible: boolean;
  t: Translate;
  onClose: () => void;
  onContext: () => void;
  onSaveExit: () => void;
}) {
  return (
    <WorkspaceSheet visible={visible} title={t("inspect.workspace.more.title")} onClose={onClose} onBackdrop={onClose} testID="workspace-more-sheet" t={t}>
      <View style={styles.list}>
        <Action icon="information-circle-outline" label={t("inspect.workspace.more.context")} hint={t("inspect.workspace.more.contextHint")} onPress={onContext} testID="workspace-more-context" />
        <Action icon="bookmark-outline" label={t("inspect.workspace.more.saveExit")} hint={t("inspect.workspace.more.saveExitHint")} onPress={onSaveExit} testID="workspace-more-saveexit" />
      </View>
    </WorkspaceSheet>
  );
}

function Action({ icon, label, hint, onPress, testID }: { icon: "information-circle-outline" | "bookmark-outline"; label: string; hint: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      testID={testID}
      style={({ pressed }) => [styles.action, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={icon} size={22} color={theme.primaryAction} />
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textPrimary }]}>
          {label}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  action: { minHeight: MIN_TARGET + 8, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 16, fontWeight: "800" },
  hint: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
});

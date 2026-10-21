import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Button } from "@/components/ui/Button";
import type { SaveTone } from "@/lib/inspections/workspaceText";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * The sticky action area: what the draft is doing, and one primary action. In the checklist that is "Review
 * inspection" (it explains and jumps when something is missing instead of being disabled); in the review it is
 * "Back to checklist". There is deliberately no submit here.
 */
export function WorkspaceFooter({
  saveText,
  saveTone,
  offline,
  primaryLabel,
  primaryIcon,
  onPrimary,
  onRetrySave,
  bottomInset,
  t,
  primaryTestID = "workspace-review",
}: {
  saveText: string;
  saveTone: SaveTone;
  offline: boolean;
  primaryLabel: string;
  primaryIcon?: "arrow-forward" | "arrow-back";
  onPrimary: () => void;
  onRetrySave?: () => void;
  bottomInset: number;
  t: Translate;
  primaryTestID?: string;
}) {
  const theme = useTheme();
  const color = saveTone === "ok" ? theme.status.ready : saveTone === "warn" ? theme.status.dirty : theme.textSecondary;
  const icon = saveTone === "ok" ? "checkmark-circle" : saveTone === "warn" ? "alert-circle" : saveTone === "busy" ? "sync" : "ellipse-outline";
  return (
    <View style={[styles.bar, { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: Math.max(10, bottomInset + 6) }]} testID="workspace-footer">
      <View style={styles.statusRow} accessibilityLiveRegion="polite">
        <Ionicons name={icon} size={14} color={color} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color }]} numberOfLines={2} testID="workspace-save">
          {saveText}
        </Text>
        {saveTone === "warn" && onRetrySave ? (
          <Pressable onPress={onRetrySave} accessibilityRole="button" accessibilityLabel={t("inspect.workspace.save.retryA11y")} hitSlop={8} style={styles.retry} testID="workspace-save-retry">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.retryText, { color: theme.primaryAction }]}>
              {t("inspect.workspace.save.retry")}
            </Text>
          </Pressable>
        ) : null}
        {offline ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.offline, { color: theme.status.pickup }]} testID="workspace-offline">
            {t("inspect.workspace.offline")}
          </Text>
        ) : null}
      </View>
      <Button label={primaryLabel} icon={primaryIcon} size="lg" onPress={onPrimary} testID={primaryTestID} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  status: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
  retry: { minHeight: 32, justifyContent: "center", paddingHorizontal: 4 },
  retryText: { fontSize: 13, fontWeight: "800" },
  offline: { fontSize: 12.5, fontWeight: "700" },
});

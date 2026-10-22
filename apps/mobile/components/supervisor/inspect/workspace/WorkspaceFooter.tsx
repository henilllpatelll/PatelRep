import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Button } from "@/components/ui/Button";
import type { SaveTone } from "@/lib/inspections/workspaceText";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * The sticky action area: what the draft is doing, and one primary action. In the checklist that is "Review
 * inspection" (it explains and jumps when something is missing instead of being disabled). In the review the primary
 * action sends the inspection ("Approve room" / "Submit & request correction") with "Back to checklist" beside it;
 * while it is being sent both are inert, and `hint` says why a primary action is unavailable.
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
  primaryLoading = false,
  primaryDisabled = false,
  secondaryLabel,
  onSecondary,
  secondaryTestID = "workspace-back-to-checklist",
  hint,
}: {
  saveText: string;
  saveTone: SaveTone;
  offline: boolean;
  primaryLabel: string;
  primaryIcon?: "arrow-forward" | "arrow-back" | "checkmark" | "send";
  onPrimary: () => void;
  onRetrySave?: () => void;
  bottomInset: number;
  t: Translate;
  primaryTestID?: string;
  primaryLoading?: boolean;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryTestID?: string;
  /** Why the primary action cannot be used right now. */
  hint?: string | null;
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
      {hint ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.status.pickup }]} testID="workspace-footer-hint">
          {hint}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        {secondaryLabel && onSecondary ? (
          <Button label={secondaryLabel} variant="secondary" size="lg" icon="arrow-back" disabled={primaryLoading} onPress={onSecondary} style={styles.secondary} testID={secondaryTestID} />
        ) : null}
        <Button label={primaryLabel} icon={primaryIcon} size="lg" loading={primaryLoading} disabled={primaryDisabled} onPress={onPrimary} style={styles.primary} testID={primaryTestID} />
      </View>
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
  hint: { fontSize: 13.5, lineHeight: 19, fontWeight: "700" },
  buttons: { flexDirection: "row", gap: 8 },
  secondary: { flexShrink: 1 },
  primary: { flex: 1 },
});

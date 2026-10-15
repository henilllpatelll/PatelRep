import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ActionPreviewCard } from "@/components/ai/ActionPreviewCard";
import { usePalette, type Palette } from "@/components/ai/palette";
import { summarizePreview } from "@/lib/ai/actionSummary";
import type { ActionItem } from "@/lib/ai/conversationState";
import { validatePreview, type DraftPatch } from "@/lib/ai/drafts";

const MAX_FONT_SCALE = 1.6;

interface Props {
  item: ActionItem;
  online: boolean;
  onEdit: (patch: DraftPatch) => void;
  /** Create what is shown. Called only from the explicit "Confirm & Create" press. */
  onConfirm: () => void;
  /** Leave without creating anything. */
  onCancel: () => void;
  /** After the server confirmed. */
  onDone: () => void;
  palette?: Palette;
}

/**
 * The one confirm-before-it-exists drawer for everything the assistant proposes. It lists every field being
 * committed, lets the person correct them, and creates only on an explicit press. Success is shown only after
 * the server acknowledges the record; until then the person sees exactly what is true (waiting, failed, offline).
 */
export function ActionConfirmPanel({ item, online, onEdit, onConfirm, onCancel, onDone, palette }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [editing, setEditing] = useState(false);

  const busy = item.status === "confirming";
  const confirmed = item.status === "confirmed";
  const invalid = Object.keys(validatePreview(item.preview)).length > 0;
  const canConfirm = online && !busy && !invalid && !confirmed;
  const rows = summarizePreview(item.preview, t);

  if (confirmed) {
    return (
      <View style={styles.wrap} testID="confirm-success">
        <View style={styles.doneRow} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={22} color={theme.status.ready} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.doneText}>
            {item.deduplicated ? t("copilot.action.alreadyCreated") : t(`copilot.action.created.${item.preview.kind}`)}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onDone} style={styles.primary} testID="confirm-done">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.primaryText}>
            {t("assistant.confirm.done")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="confirm-panel">
      <View style={styles.prepared}>
        <Ionicons name="sparkles" size={14} color={theme.ai.primary} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.preparedText}>
          {t("assistant.confirm.prepared")}
        </Text>
      </View>

      {editing ? (
        <ActionPreviewCard item={item} onEdit={onEdit} onConfirm={onConfirm} onDismiss={onCancel} hideActions palette={palette} />
      ) : (
        <View style={styles.rows}>
          {rows.map((row) => (
            <View key={row.key} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.rowLabel}>
                {row.label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, row.warn && styles.rowWarn]}>
                {row.value}
              </Text>
              {row.warn ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.warn}>
                  {t("copilot.action.roomUnverified", { room: row.value })}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {invalid && !editing ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.error}>
          {t("assistant.confirm.incomplete")}
        </Text>
      ) : null}
      {!online ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.warn} accessibilityLiveRegion="polite" testID="confirm-offline">
          {t("assistant.confirm.needsConnection")}
        </Text>
      ) : null}
      {item.status === "failed" && item.failure ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.error} accessibilityLiveRegion="polite" testID="confirm-failure">
          {item.failure === "invalid_request" && item.failureMessage ? item.failureMessage : t(`copilot.notice.${item.failure}`)}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => setEditing((value) => !value)}
        style={[styles.secondary, busy && styles.disabled]}
        testID="confirm-edit"
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.secondaryText}>
          {editing ? t("assistant.confirm.doneEditing") : t("assistant.confirm.edit")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canConfirm, busy }}
        disabled={!canConfirm}
        onPress={onConfirm}
        style={[styles.primary, !canConfirm && styles.disabled]}
        testID="confirm-create"
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.onPrimary} />
        ) : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.primaryText}>
            {item.status === "failed" ? t("copilot.action.retry") : t("assistant.confirm.create")}
          </Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onCancel}
        style={[styles.ghost, busy && styles.disabled]}
        testID="confirm-cancel"
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.ghostText}>
          {t("common.cancel")}
        </Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    wrap: { gap: 10 },
    prepared: { flexDirection: "row", alignItems: "center", gap: 6 },
    preparedText: { fontSize: 12.5, color: theme.textMuted, fontWeight: "600" },
    rows: { borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceElevated, paddingHorizontal: 14, paddingVertical: 4 },
    row: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle, gap: 2 },
    rowLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", color: theme.textMuted },
    rowValue: { fontSize: 15.5, lineHeight: 21, color: theme.textPrimary, fontWeight: "600" },
    rowWarn: { color: theme.status.pickup },
    warn: { fontSize: 12.5, lineHeight: 18, color: theme.status.pickup },
    error: { fontSize: 13, lineHeight: 18, color: theme.status.dirty },
    primary: { minHeight: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.primaryAction },
    primaryText: { color: theme.onPrimary, fontSize: 16, fontWeight: "800" },
    secondary: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
    secondaryText: { color: theme.textPrimary, fontSize: 15, fontWeight: "700" },
    ghost: { minHeight: 48, alignItems: "center", justifyContent: "center" },
    ghostText: { color: theme.textSecondary, fontSize: 15, fontWeight: "600" },
    disabled: { opacity: 0.45 },
    doneRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    doneText: { flex: 1, fontSize: 16, color: theme.textPrimary, fontWeight: "700" },
  });

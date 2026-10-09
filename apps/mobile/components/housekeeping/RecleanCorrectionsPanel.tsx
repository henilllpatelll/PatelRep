import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import type { ChecklistItem } from "@/lib/housekeeping/cleanSession";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";

const MAX_FONT_SCALE = 1.6;
const CORRECTION_SECTION = "Corrections";

interface RecleanCorrectionsPanelProps {
  room: Room;
  /** The live clean-session checklist, when a reclean has been started. */
  checklist: ChecklistItem[] | undefined;
  ctx: TextContext;
}

/**
 * What the inspector flagged, verbatim, with each correction's current state.
 * "Fixed" comes ONLY from the real clean-session checklist (the server's
 * snapshot plus the attendant's confirmed ticks) — this panel has no toggles of
 * its own, so it cannot fake a resubmission. Ticking happens in the checklist.
 */
export function RecleanCorrectionsPanel({ room, checklist, ctx }: RecleanCorrectionsPanelProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!room.reclean_requested_at) return null;

  const details = room.reclean_details;
  const items = details?.items ?? [];
  const fixedLabels = new Set(
    (checklist ?? []).filter((item) => item.section === CORRECTION_SECTION && item.checked).map((item) => item.label),
  );
  const inspectedAt = formatClock(details?.inspected_at, ctx);

  return (
    <View
      testID="reclean-panel"
      style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.status.dirtyLine }]}
    >
      <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.status.dirty }]}>
        {t("rooms.dash.detail.reclean.title")}
      </Text>
      {items.length > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
          {t("rooms.dash.detail.reclean.subtitle", { count: items.length })}
          {inspectedAt ? ` · ${t("rooms.dash.detail.reclean.inspectedAt", { time: inspectedAt })}` : ""}
        </Text>
      ) : null}

      {items.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
          {t("rooms.dash.detail.reclean.unavailable")}
        </Text>
      ) : (
        items.map((item) => {
          const fixed = fixedLabels.has(item.label);
          return (
            <View
              key={item.label}
              accessible
              accessibilityLabel={`${item.label}. ${
                fixed ? t("rooms.dash.detail.reclean.fixed") : t("rooms.dash.detail.reclean.toFix")
              }${item.note ? `. ${item.note}` : ""}`}
              style={styles.item}
              testID={`correction-${item.label}`}
            >
              <Ionicons
                name={fixed ? "checkbox" : "square-outline"}
                size={20}
                color={fixed ? theme.status.ready : theme.textMuted}
              />
              <View style={styles.itemCopy}>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.itemLabel, { color: theme.textPrimary }, fixed && styles.fixed]}
                >
                  {item.label}
                </Text>
                {item.note ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                    {item.note}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })
      )}

      {details?.notes ? (
        <View style={styles.notes}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notesLabel, { color: theme.textMuted }]}>
            {t("rooms.dash.detail.reclean.inspectorNotes")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
            {details.notes}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 10, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: "900", letterSpacing: 0.4 },
  meta: { fontSize: 14, lineHeight: 20 },
  item: { flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 36 },
  itemCopy: { flex: 1, gap: 2 },
  itemLabel: { fontSize: 15, fontWeight: "700", lineHeight: 21 },
  fixed: { textDecorationLine: "line-through", opacity: 0.7 },
  notes: { gap: 2, marginTop: 4 },
  notesLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
});

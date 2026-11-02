import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmDraftItem, PmTemplateItem } from "@/lib/engineering/pmChecklist";
import type { PmItemResult } from "@/lib/engineering/pmCompletion";
import { PmPhotoField } from "./PmPhotoField";

interface Props {
  index: number;
  item: PmTemplateItem;
  answer: PmDraftItem;
  expanded: boolean;
  online: boolean;
  uploading: boolean;
  /** Review was attempted and this item still lacks an answer. */
  showUnanswered: boolean;
  /** Review was attempted and this item still lacks its required evidence. */
  showEvidenceMissing: boolean;
  /** Review was attempted and this failed item still has no written finding. */
  showFindingMissing: boolean;
  onToggle: () => void;
  /** Opens the "Report failed check" sheet for this step. */
  onOpenFailure: () => void;
  onResult: (result: PmItemResult) => void;
  onNote: (note: string) => void;
  onAddPhoto: (uri: string, signal: AbortSignal) => Promise<void>;
  onRemovePhoto: (evidenceId: string) => void;
}

const RESULTS: ReadonlyArray<{ value: PmItemResult; labelKey: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
  { value: "passed", labelKey: "pm.result.pass", icon: "checkmark-circle" },
  { value: "failed", labelKey: "pm.result.fail", icon: "close-circle" },
  { value: "not_applicable", labelKey: "pm.result.na", icon: "remove-circle" },
];

/** One checklist step. Nothing is pre-answered; the three result buttons are large and state is shown by icon, not colour alone. */
export function PmChecklistItem({
  index,
  item,
  answer,
  expanded,
  online,
  uploading,
  showUnanswered,
  showEvidenceMissing,
  showFindingMissing,
  onToggle,
  onOpenFailure,
  onResult,
  onNote,
  onAddPhoto,
  onRemovePhoto,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const failed = answer.result === "failed";
  const needsEvidence = item.requiresEvidence && answer.result !== "not_applicable";
  const summaryTone = answer.result === "failed" ? theme.status.dirty : answer.result ? theme.status.ready : theme.textDisabled;
  const summaryIcon = answer.result === "failed" ? "close-circle" : answer.result ? "checkmark-circle" : "ellipse-outline";
  const resultLabel = answer.result ? t(RESULTS.find((r) => r.value === answer.result)!.labelKey) : t("pm.result.unanswered");
  const findingMissing = failed && !answer.note.trim();
  const invalid =
    (showUnanswered && !answer.result) ||
    (showEvidenceMissing && needsEvidence && answer.evidence.length === 0) ||
    (showFindingMissing && findingMissing);

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: invalid ? theme.status.dirty : theme.border }]}
      testID={`pm-item-${item.id}`}
    >
      <Pressable
        onPress={onToggle}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${t("pm.step", { number: index + 1 })}: ${item.label}. ${resultLabel}`}
        testID={`pm-item-toggle-${item.id}`}
      >
        <Ionicons name={summaryIcon} size={22} color={summaryTone} />
        <View style={styles.headCopy}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.stepNo, { color: theme.textMuted }]}>
            {t("pm.step", { number: index + 1 })}
            {item.requiresEvidence ? `  ·  ${t("pm.photoRequired")}` : ""}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textPrimary }]}>
            {item.label}
          </Text>
          {!expanded && answer.result ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.resultText, { color: summaryTone }]}>
              {resultLabel}
              {findingMissing ? `  ·  ${t("pm.failure.missing")}` : ""}
            </Text>
          ) : null}
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={theme.textMuted} />
      </Pressable>

      {expanded ? (
        <View style={styles.bodyArea}>
          <View style={styles.results} accessibilityRole="radiogroup">
            {RESULTS.map((r) => {
              const selected = answer.result === r.value;
              const color = r.value === "failed" ? theme.status.dirty : r.value === "passed" ? theme.status.ready : theme.textSecondary;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => {
                    onResult(r.value);
                    // Choosing Fail goes straight to describing it; the answer is already recorded if the sheet is dismissed.
                    if (r.value === "failed" && answer.result !== "failed") onOpenFailure();
                  }}
                  style={[
                    styles.resultButton,
                    { borderColor: selected ? color : theme.border, backgroundColor: selected ? color : theme.surfaceSubtle },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${t(r.labelKey)}, ${item.label}`}
                  testID={`pm-item-${item.id}-${r.value}`}
                >
                  <Ionicons name={selected ? r.icon : (`${r.icon}-outline` as React.ComponentProps<typeof Ionicons>["name"])} size={20} color={selected ? theme.surface : color} />
                  <Text maxFontSizeMultiplier={1.3} style={[styles.resultButtonText, { color: selected ? theme.surface : theme.textPrimary }]}>
                    {t(r.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {showUnanswered && !answer.result ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
              {t("pm.errors.unanswered")}
            </Text>
          ) : null}

          {failed ? (
            <View style={[styles.issue, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]} testID={`pm-item-${item.id}-issue`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.issueTitle, { color: theme.status.dirty }]}>
                {t("pm.issue.title")}
              </Text>
              {answer.note.trim() ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textPrimary }]} testID={`pm-item-${item.id}-finding`}>
                  {answer.note.trim()}
                </Text>
              ) : (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: showFindingMissing ? theme.status.dirty : theme.textSecondary }]} accessibilityLiveRegion={showFindingMissing ? "polite" : "none"}>
                  {showFindingMissing ? t("pm.errors.findingRequired") : t("pm.failure.required")}
                </Text>
              )}
              {answer.evidence.length > 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textSecondary }]}>
                  {t("pm.review.evidenceCount", { count: answer.evidence.length })}
                </Text>
              ) : needsEvidence && showEvidenceMissing ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
                  {t("pm.errors.evidenceRequired")}
                </Text>
              ) : null}
              <Pressable
                onPress={onOpenFailure}
                style={[styles.findingButton, { borderColor: theme.status.dirtyLine }]}
                accessibilityRole="button"
                accessibilityLabel={`${answer.note.trim() ? t("pm.failure.edit") : t("pm.failure.add")}, ${item.label}`}
                testID={`pm-item-${item.id}-finding-edit`}
              >
                <Ionicons name="create-outline" size={18} color={theme.status.dirty} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.findingButtonText, { color: theme.status.dirty }]}>
                  {answer.note.trim() ? t("pm.failure.edit") : t("pm.failure.add")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.fieldLabel, { color: theme.textMuted }]}>
                {t("pm.note")}
              </Text>
              <TextInput
                value={answer.note}
                onChangeText={onNote}
                placeholder={t("pm.notePlaceholder")}
                placeholderTextColor={theme.textDisabled}
                multiline
                style={[styles.input, { color: theme.textPrimary, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                accessibilityLabel={t("pm.note")}
                testID={`pm-item-${item.id}-note`}
              />
            </>
          )}

          {answer.result && answer.result !== "not_applicable" && !failed ? (
            <>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.fieldLabel, { color: theme.textMuted }]}>
                {needsEvidence ? `${t("pm.photos")} · ${t("pm.photoRequired")}` : t("pm.photos")}
              </Text>
              <PmPhotoField
                photos={answer.evidence}
                uploading={uploading}
                online={online}
                onAdd={onAddPhoto}
                onRemove={onRemovePhoto}
                testID={`pm-item-${item.id}-photos`}
              />
              {showEvidenceMissing && needsEvidence && answer.evidence.length === 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
                  {t("pm.errors.evidenceRequired")}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 56 },
  headCopy: { flex: 1, gap: 2 },
  stepNo: { fontSize: 12, fontWeight: "700" },
  label: { fontSize: 15, fontWeight: "600" },
  resultText: { fontSize: 13, fontWeight: "700" },
  bodyArea: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  results: { flexDirection: "row", gap: 8 },
  resultButton: { flex: 1, minHeight: 52, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: 6 },
  resultButtonText: { fontSize: 14, fontWeight: "700" },
  issue: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  findingButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  findingButtonText: { fontSize: 14, fontWeight: "700" },
  issueTitle: { fontSize: 13, fontWeight: "700" },
  hint: { fontSize: 13, lineHeight: 18 },
  fieldLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  input: { minHeight: 64, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 15, textAlignVertical: "top" },
  error: { fontSize: 13 },
});

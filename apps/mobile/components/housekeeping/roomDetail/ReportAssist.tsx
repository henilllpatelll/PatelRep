import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { CopilotFailureKind } from "@/lib/ai/contract";
import type { MaintenanceDraft } from "@/lib/housekeeping/maintenanceReport";
import type { DescriptionSuggestion, PhotoSuggestion, ReportField, YesNo } from "@/lib/housekeeping/reportDraft";
import { MAX_FONT_SCALE } from "./BottomSheet";
import { Chip, FieldLabel, StatusText } from "./FormBits";

/* The two optional AI helpers on the Report Issue form. Both only ever propose: every value they show is applied
   by an explicit press, is editable afterwards, and is labelled as a suggestion. Neither is needed to report. */

/** The sentence for a failed AI request. The report itself is never blocked. */
export function aiFailureKey(kind: CopilotFailureKind | null, scope: "ai" | "photoAi"): string {
  switch (kind) {
    case "offline":
      return `reportIssue.${scope}.failed.offline`;
    case "credit_limit":
      return `reportIssue.${scope}.failed.credit_limit`;
    case "rate_limited":
      return `reportIssue.${scope}.failed.rate_limited`;
    case "invalid_request":
      return `reportIssue.${scope}.failed.invalid_request`;
    case "unauthenticated":
      return `reportIssue.${scope}.failed.unauthenticated`;
    default:
      return `reportIssue.${scope}.failed.unavailable`;
  }
}

type AssistStatus = "idle" | "loading" | "none" | "failed";

/* ── from the description ───────────────────────────────────────────────── */

interface DescriptionAssistProps {
  online: boolean;
  locked: boolean;
  /** Enough has been written to ask. */
  canAsk: boolean;
  status: AssistStatus;
  failure: CopilotFailureKind | null;
  /** The suggestion, only while it still describes what is typed. */
  suggestion: DescriptionSuggestion | null;
  /** A suggestion existed but the description changed since. */
  stale: boolean;
  draft: MaintenanceDraft;
  kept: ReportField[];
  onSuggest: () => void;
  onUseAll: () => void;
  onUseField: (field: ReportField) => void;
  onDismiss: () => void;
}

export function DescriptionAssist({ online, locked, canAsk, status, failure, suggestion, stale, draft, kept, onSuggest, onUseAll, onUseField, onDismiss }: DescriptionAssistProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const loading = status === "loading";

  const rows: Array<{ field: ReportField; label: string; value: string; same: boolean }> = [];
  if (suggestion?.title) rows.push({ field: "title", label: t("reportIssue.issueTitle"), value: suggestion.title, same: draft.title.trim() === suggestion.title });
  if (suggestion?.category) {
    rows.push({ field: "category", label: t("reportIssue.category"), value: t(`reportIssue.categories.${suggestion.category}`), same: draft.category === suggestion.category });
  }
  if (suggestion?.priority) {
    rows.push({ field: "priority", label: t("reportIssue.priority"), value: t(`reportIssue.priorities.${suggestion.priority}`), same: draft.priority === suggestion.priority });
  }

  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="issue-ai">
      <View style={styles.titleRow}>
        <Ionicons name="sparkles-outline" size={14} color={theme.textMuted} />
        <FieldLabel>{t("reportIssue.ai.title")}</FieldLabel>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t("reportIssue.ai.body")}
      </Text>
      <Button
        label={t(suggestion ? "reportIssue.ai.again" : "reportIssue.ai.suggest")}
        onPress={onSuggest}
        variant="secondary"
        icon="sparkles-outline"
        loading={loading}
        disabled={!online || locked || !canAsk || loading || (suggestion !== null && !stale)}
        testID="issue-ai-suggest"
      />
      {!online ? <StatusText message={t("reportIssue.ai.offline")} testID="issue-ai-offline" /> : null}
      {online && !canAsk && !suggestion ? <StatusText message={t("reportIssue.ai.tooShort")} /> : null}
      {loading ? <StatusText message={t("reportIssue.ai.working")} testID="issue-ai-working" /> : null}
      {status === "failed" ? <StatusText tone="warn" message={t(aiFailureKey(failure, "ai"))} testID="issue-ai-failed" /> : null}
      {status === "none" ? <StatusText message={t("reportIssue.ai.none")} testID="issue-ai-none" /> : null}
      {stale ? <StatusText tone="warn" message={t("reportIssue.ai.stale")} testID="issue-ai-stale" /> : null}

      {suggestion && rows.length > 0 ? (
        <View style={styles.suggestion} testID="issue-ai-suggestion">
          <FieldLabel>{t("reportIssue.ai.suggestionTitle")}</FieldLabel>
          {rows.map((row) => (
            <View key={row.field} style={styles.row} testID={`issue-ai-row-${row.field}`}>
              <View style={styles.rowText}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
                  {row.label}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
                  {row.value}
                </Text>
              </View>
              {row.same ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.used, { color: theme.status.ready }]}>
                  {t("reportIssue.ai.used")}
                </Text>
              ) : (
                <Button
                  label={t("reportIssue.ai.use")}
                  accessibilityLabel={t("reportIssue.ai.useField", { field: row.label })}
                  onPress={() => onUseField(row.field)}
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  testID={`issue-ai-use-${row.field}`}
                />
              )}
            </View>
          ))}
          {suggestion.priority === "urgent" && draft.priority !== "urgent" ? (
            <StatusText tone="warn" message={t("reportIssue.ai.urgentNote")} testID="issue-ai-urgent" />
          ) : null}
          {kept.length > 0 ? (
            <StatusText message={t("reportIssue.ai.kept", { fields: kept.map((field) => t(`reportIssue.ai.field.${field}`)).join(", ") })} testID="issue-ai-kept" />
          ) : null}
          <Button label={t("reportIssue.ai.useAll")} onPress={onUseAll} icon="checkmark" disabled={locked} testID="issue-ai-use-all" />
          <Button label={t("reportIssue.ai.dismiss")} onPress={onDismiss} variant="ghost" size="sm" disabled={locked} testID="issue-ai-dismiss" />
        </View>
      ) : null}
    </View>
  );
}

/* ── from the photo ─────────────────────────────────────────────────────── */

interface PhotoAssistProps {
  online: boolean;
  locked: boolean;
  /** "Analyze photo" was pressed and the disclosure is waiting for a decision. */
  consenting: boolean;
  status: "idle" | "loading" | "failed";
  failure: CopilotFailureKind | null;
  suggestion: PhotoSuggestion | null;
  draft: MaintenanceDraft;
  onAsk: () => void;
  onCancel: () => void;
  onSend: () => void;
  onAnswer: (answer: YesNo) => void;
  onUse: () => void;
  onDiscard: () => void;
  /** What "Use these details" did, for a short confirmation. */
  notice: { kept: ReportField[]; noteTooLong: boolean } | null;
}

export function PhotoAssist({ online, locked, consenting, status, failure, suggestion, draft, onAsk, onCancel, onSend, onAnswer, onUse, onDiscard, notice }: PhotoAssistProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const loading = status === "loading";
  const analysis = suggestion?.analysis ?? null;

  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="issue-photo-ai">
      <View style={styles.titleRow}>
        <Ionicons name="sparkles-outline" size={14} color={theme.textMuted} />
        <FieldLabel>{t("reportIssue.photoAi.title")}</FieldLabel>
      </View>

      {!consenting && !loading && !analysis ? (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("reportIssue.photoAi.body")}
          </Text>
          <Button
            label={t("reportIssue.photoAi.analyze")}
            onPress={onAsk}
            variant="secondary"
            icon="scan-outline"
            disabled={!online || locked}
            testID="issue-photo-analyze"
          />
          {!online ? <StatusText message={t("reportIssue.photoAi.offline")} testID="issue-photo-ai-offline" /> : null}
        </>
      ) : null}

      {consenting && !loading ? (
        <View style={styles.consent} testID="issue-photo-consent">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.consentTitle, { color: theme.textPrimary }]}>
            {t("reportIssue.photoAi.disclosureTitle")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("reportIssue.photoAi.disclosureBody")}
          </Text>
          <Button label={t("reportIssue.photoAi.send")} onPress={onSend} icon="send-outline" disabled={!online || locked} testID="issue-photo-send" />
          <Button label={t("reportIssue.photoAi.cancel")} onPress={onCancel} variant="ghost" size="sm" testID="issue-photo-cancel" />
        </View>
      ) : null}

      {loading ? <StatusText message={t("reportIssue.photoAi.working")} testID="issue-photo-working" /> : null}
      {status === "failed" && !analysis ? (
        <>
          <StatusText tone="warn" message={t(aiFailureKey(failure, "photoAi"))} testID="issue-photo-ai-failed" />
          <Button label={t("reportIssue.photoAi.cancel")} onPress={onCancel} variant="ghost" size="sm" testID="issue-photo-ai-close" />
        </>
      ) : null}

      {analysis && analysis.outcome === "unable_to_determine" ? (
        <>
          <StatusText message={t("reportIssue.photoAi.unable")} testID="issue-photo-unable" />
          <Button label={t("reportIssue.photoAi.discard")} onPress={onDiscard} variant="ghost" size="sm" testID="issue-photo-discard" />
        </>
      ) : null}

      {analysis && analysis.outcome === "suggestion" ? (
        <View style={styles.suggestion} testID="issue-photo-suggestion">
          <FieldLabel>{t("reportIssue.photoAi.observation")}</FieldLabel>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]} testID="issue-photo-observation">
            {analysis.observation}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
            {t("reportIssue.photoAi.unverified")}
          </Text>
          {analysis.category ? (
            <>
              <FieldLabel>{t("reportIssue.photoAi.category")}</FieldLabel>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]} testID="issue-photo-category">
                {t(`reportIssue.categories.${analysis.category}`)}
                {draft.category === analysis.category ? ` · ${t("reportIssue.ai.used")}` : ""}
              </Text>
            </>
          ) : null}
          {analysis.question ? (
            <>
              <FieldLabel>{t("reportIssue.photoAi.needsConfirmation")}</FieldLabel>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]} testID="issue-photo-question">
                {analysis.question}
              </Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={analysis.question}>
                {(["yes", "no", "unsure"] as const).map((answer) => (
                  <Chip
                    key={answer}
                    label={t(`reportIssue.photoAi.answer.${answer}`)}
                    selected={suggestion?.answer === answer}
                    onPress={() => onAnswer(answer)}
                    disabled={locked}
                    testID={`issue-photo-answer-${answer}`}
                  />
                ))}
              </View>
            </>
          ) : null}
          {notice?.kept.length ? (
            <StatusText message={t("reportIssue.ai.kept", { fields: notice.kept.map((field) => t(`reportIssue.ai.field.${field}`)).join(", ") })} testID="issue-photo-kept" />
          ) : null}
          {notice?.noteTooLong ? <StatusText tone="warn" message={t("reportIssue.photoAi.noteTooLong")} testID="issue-photo-note-long" /> : null}
          <Button label={t("reportIssue.photoAi.useThese")} onPress={onUse} icon="checkmark" disabled={locked} testID="issue-photo-use" />
          <Button label={t("reportIssue.photoAi.discard")} onPress={onDiscard} variant="ghost" size="sm" disabled={locked} testID="issue-photo-discard" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  body: { fontSize: 13.5, lineHeight: 19 },
  suggestion: { gap: 6, paddingTop: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowText: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  rowValue: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  used: { fontSize: 13, fontWeight: "800" },
  consent: { gap: 8 },
  consentTitle: { fontSize: 15.5, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

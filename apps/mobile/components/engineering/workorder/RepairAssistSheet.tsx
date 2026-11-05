import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError, LineInput, Note, TextArea, sheetStyles } from "./sheetKit";
import { MAX_NOTES_CHARS, MAX_QUESTION_CHARS, isUsableQuestion } from "@/lib/engineering/repairAssist";
import { useRepairAssist } from "@/lib/engineering/useRepairAssist";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";

interface Props {
  visible: boolean;
  onClose: () => void;
  workOrderId: string;
  online: boolean;
  language: "en" | "es";
  /** What the technician has typed so far (the completion notes). The draft may only rephrase what is recorded or typed. */
  technicianNotes: string;
  /** Put the reviewed text into the completion notes. The repair is still completed only by Confirm Completion. */
  onUseInCompletion: (text: string) => void;
  /** Save the reviewed text as a note through the existing notes workflow. Rejects when the server did not store it. */
  onSaveAsNote: (text: string) => Promise<void>;
}

/**
 * AI Assist. Everything the model says sits under an "AI suggestion" label, apart from "From your records" (facts the
 * server loaded). It saves nothing by itself: a draft is editable text, and each save is a separate, explicit tap.
 */
export function RepairAssistSheet({ visible, onClose, workOrderId, online, language, technicianNotes, onUseInCompletion, onSaveAsNote }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const assist = useRepairAssist(workOrderId, language);
  const { cancel } = assist;
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Closing the sheet stops a request still waiting for its answer.
  useEffect(() => {
    if (!visible) cancel();
  }, [visible, cancel]);

  // A new draft replaces the edit box; the technician's own edits are never overwritten by anything else.
  useEffect(() => {
    if (assist.draftNotes != null) setDraft(assist.draftNotes);
  }, [assist.draftNotes]);

  const loading = assist.status === "loading";
  const suggestion = assist.suggestion;
  const facts = assist.facts;

  async function saveNote() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveAsNote(text);
      setDraft("");
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : t("repairAssist.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function sendQuestion() {
    if (!isUsableQuestion(question)) return;
    const q = question.trim();
    setQuestion("");
    await assist.ask("followup", { question: q });
  }

  return (
    <BottomSheet visible={visible} title={t("repairAssist.title")} onClose={onClose} tall testID="repair-assist-sheet">
      <View style={sheetStyles.stack}>
        <View style={[styles.banner, { backgroundColor: theme.primarySoft, borderColor: theme.primaryLine }]} accessible accessibilityRole="text">
          <Ionicons name="sparkles-outline" size={16} color={theme.primaryAction} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
            {t("repairAssist.disclaimer")}
          </Text>
        </View>

        {!online ? <Note>{t("repairAssist.needsConnection")}</Note> : null}

        {facts ? (
          <View style={styles.block} testID="assist-facts">
            <FieldLabel>{t("repairAssist.fromRecords")}</FieldLabel>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
              {[facts.work_order.number ? `WO-${facts.work_order.number}` : null, facts.work_order.title].filter(Boolean).join(" · ")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="assist-asset-line">
              {facts.asset ? t("repairAssist.asset", { name: [facts.asset.name, facts.asset.tag].filter(Boolean).join(" · ") }) : t("repairAssist.noAsset")}
            </Text>
            {facts.has_asset ? (
              facts.previous_repairs.length > 0 ? (
                facts.previous_repairs.map((repair, index) => (
                  <Text key={`${repair.work_order_number}-${index}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                    {t("repairAssist.previousRepair", { number: repair.work_order_number ?? "", title: repair.title ?? "", date: (repair.completed_at ?? "").slice(0, 10) })}
                  </Text>
                ))
              ) : (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="assist-no-history">
                  {t("repairAssist.noHistory")}
                </Text>
              )
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="assist-no-manuals">
              {t("repairAssist.noManuals")}
            </Text>
          </View>
        ) : null}

        {suggestion ? (
          <View style={[styles.block, x.active && { backgroundColor: theme.ai.soft, borderColor: theme.ai.line, borderWidth: 1, borderRadius: 12, padding: 12 }]} testID="assist-suggestion">
            <FieldLabel>{t("repairAssist.aiSuggestion")}</FieldLabel>
            {suggestion.summary ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
                {suggestion.summary}
              </Text>
            ) : null}
            {suggestion.checks.length > 0 ? (
              <>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, x.label, { color: theme.textMuted }]}>
                  {t("repairAssist.checks")}
                </Text>
                {suggestion.checks.map((check, index) => (
                  <Text key={`c${index}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
                    {index + 1}. {check}
                  </Text>
                ))}
              </>
            ) : null}
            {suggestion.needs_info.length > 0 ? (
              <>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, x.label, { color: theme.textMuted }]}>
                  {t("repairAssist.needsInfo")}
                </Text>
                {suggestion.needs_info.map((item, index) => (
                  <Text key={`n${index}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
                    • {item}
                  </Text>
                ))}
              </>
            ) : null}
            {suggestion.safety.length > 0 ? (
              <View style={[styles.safety, { borderColor: theme.status.pickupLine, backgroundColor: theme.status.pickupSoft }]} testID="assist-safety">
                <Ionicons name="shield-checkmark-outline" size={16} color={theme.status.pickup} />
                <View style={styles.safetyText}>
                  {suggestion.safety.map((item, index) => (
                    <Text key={`s${index}`} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
                      {item}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}
            {suggestion.uncertainty ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                {suggestion.uncertainty}
              </Text>
            ) : null}
          </View>
        ) : null}

        {assist.turns.map((turn, index) => (
          <View key={`t${index}`} style={styles.turn} testID={`assist-turn-${index}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, x.label, { color: theme.textMuted }]}>
              {turn.role === "user" ? t("repairAssist.you") : t("repairAssist.aiAnswer")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
              {turn.text}
            </Text>
          </View>
        ))}

        {assist.status === "error" && assist.failure ? <InlineError testID="assist-error">{t(`repairAssist.failure.${assist.failure}`)}</InlineError> : null}

        {!suggestion ? (
          <Button
            label={loading ? t("repairAssist.thinking") : t("repairAssist.getSuggestions")}
            icon="sparkles-outline"
            onPress={() => void assist.ask("suggest", { technicianNotes })}
            loading={loading}
            disabled={!online || loading}
            size="lg"
            testID="assist-get"
          />
        ) : (
          <>
            <FieldLabel>{t("repairAssist.followUp")}</FieldLabel>
            <LineInput
              value={question}
              onChangeText={setQuestion}
              placeholder={t("repairAssist.followUpPlaceholder")}
              maxLength={MAX_QUESTION_CHARS}
              editable={!loading}
              accessibilityLabel={t("repairAssist.followUp")}
              testID="assist-question"
            />
            <Button
              label={t("repairAssist.ask")}
              variant="secondary"
              onPress={() => void sendQuestion()}
              loading={loading}
              disabled={!online || loading || !isUsableQuestion(question)}
              testID="assist-ask"
            />
            <Button
              label={t("repairAssist.draftNotes")}
              variant="secondary"
              icon="document-text-outline"
              onPress={() => void assist.ask("draft_notes", { technicianNotes })}
              disabled={!online || loading}
              testID="assist-draft"
            />
          </>
        )}

        {loading ? (
          <Button label={t("common.cancel")} variant="ghost" onPress={assist.cancel} testID="assist-cancel" />
        ) : null}

        {assist.draftNotes != null ? (
          <View style={styles.block} testID="assist-draft-block">
            <FieldLabel>{t("repairAssist.draftLabel")}</FieldLabel>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
              {t("repairAssist.draftHelp")}
            </Text>
            <TextArea
              value={draft}
              onChangeText={setDraft}
              maxLength={MAX_NOTES_CHARS}
              accessibilityLabel={t("repairAssist.draftLabel")}
              testID="assist-draft-input"
            />
            <Button
              label={t("repairAssist.useInCompletion")}
              variant="secondary"
              onPress={() => {
                onUseInCompletion(draft.trim());
                onClose();
              }}
              disabled={!draft.trim()}
              testID="assist-use-draft"
            />
            <Button label={t("repairAssist.saveAsNote")} onPress={() => void saveNote()} loading={saving} disabled={!online || !draft.trim() || saving} testID="assist-save-note" />
            {saveError ? <InlineError>{saveError}</InlineError> : null}
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  block: { gap: 6 },
  body: { fontSize: 14.5, lineHeight: 21 },
  meta: { fontSize: 13, lineHeight: 18 },
  sub: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 6 },
  safety: { flexDirection: "row", gap: 8, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 6 },
  safetyText: { flex: 1, gap: 4 },
  turn: { gap: 2 },
});

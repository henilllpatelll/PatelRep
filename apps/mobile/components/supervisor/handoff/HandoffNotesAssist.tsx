import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Button } from "@/components/ui/Button";
import { R } from "@/components/shared/tokens";
import { useAiCapability } from "@/lib/ai/capabilities";
import { assistantScope } from "@/lib/ai/session";
import { buildSupervisorCopilot } from "@/lib/ai/supervisorCopilot";
import {
  buildSummaryRequest,
  requestSupervisorSummary,
  type SummaryFailure,
} from "@/lib/ai/supervisorSummaryAi";
import { HANDOFF_NOTES_MAX } from "@/lib/housekeeping/supervisorHandoff";
import { isVerified } from "@/lib/housekeeping/supervisorSources";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/* Optional help writing the supervisor's handoff notes. It writes a DRAFT from the same verified figures the
   handoff already shows, into a box the supervisor edits; only "Add to my notes" moves any of it into the real
   notes field, and nothing is submitted for them. The manual handoff never depends on this: with AI off, offline,
   out of credits or failing, the notes box and the whole flow work exactly the same. It asks only when tapped. */

interface Props {
  today: SupervisorToday;
  notes: string;
  setNotes: (text: string) => void;
  /** The notes box cannot be edited right now (the draft is still being restored, or a save is in progress). */
  disabled: boolean;
  language: string;
}

type Phase =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "failed"; failure: SummaryFailure }
  | { status: "draft"; creditsUsed: number | null };

/** Existing notes first, then the draft after a blank line; null when the result would not fit. */
export function mergeNotes(existing: string, draft: string, max: number = HANDOFF_NOTES_MAX): string | null {
  const head = existing.trim();
  const body = draft.trim();
  if (!body) return head || null;
  const merged = head ? `${head}\n\n${body}` : body;
  return merged.length <= max ? merged : null;
}

export function HandoffNotesAssist({ today, notes, setNotes, disabled, language }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const aiOn = useAiCapability("unifiedAssistant");
  const scope = assistantScope(user);
  const lang: "en" | "es" = language.startsWith("es") ? "es" : "en";
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const [draft, setDraft] = useState("");
  const [tooLong, setTooLong] = useState(false);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const model = useMemo(() => buildSupervisorCopilot(today, { zone: null, language, someone: "" }), [today, language]);
  // A handoff describes the shift as it stands now: never draft from figures that are not verified at this moment.
  const verifiedNow = isVerified(today.sources.board);

  if (!aiOn) return null;

  async function help() {
    const mine = scope;
    if (!mine) return;
    setTooLong(false);
    setPhase({ status: "pending" });
    const outcome = await requestSupervisorSummary({
      scope: mine,
      body: buildSummaryRequest(today, model, "handoff", lang),
      online: isOnline,
      stillCurrent: () => scopeRef.current === mine,
    });
    if (scopeRef.current !== mine) return;
    if (!outcome.ok) {
      setPhase({ status: "failed", failure: outcome.failure });
      return;
    }
    setDraft(outcome.result.summary.slice(0, HANDOFF_NOTES_MAX));
    setPhase({ status: "draft", creditsUsed: outcome.result.creditsUsed });
  }

  function applyDraft() {
    const merged = mergeNotes(notes, draft);
    if (merged === null) {
      setTooLong(true);
      return;
    }
    setNotes(merged);
    setDraft("");
    setPhase({ status: "idle" });
  }

  function discard() {
    setDraft("");
    setTooLong(false);
    setPhase({ status: "idle" });
  }

  return (
    <View style={styles.wrap} testID="handoff-ai-assist">
      {phase.status !== "draft" ? (
        <Button
          label={t("supervisorCopilot.handoff.help")}
          onPress={() => void help()}
          variant="secondary"
          size="sm"
          icon="sparkles-outline"
          loading={phase.status === "pending"}
          disabled={disabled || !verifiedNow || phase.status === "pending"}
          testID="handoff-ai-help"
        />
      ) : null}
      {!verifiedNow && phase.status !== "draft" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="handoff-ai-needs-fresh">
          {t("supervisorCopilot.handoff.needsFresh")}
        </Text>
      ) : null}
      {phase.status === "idle" || phase.status === "pending" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("supervisorCopilot.handoff.helpHint")}
        </Text>
      ) : null}
      {phase.status === "pending" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.textMuted }]}>
          {t("supervisorCopilot.handoff.pending")}
        </Text>
      ) : null}
      {phase.status === "failed" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.status.dirty }]} testID="handoff-ai-failure">
          {t(`supervisorCopilot.handoff.failure.${phase.failure}`)}
        </Text>
      ) : null}

      {phase.status === "draft" ? (
        <View style={styles.draft} testID="handoff-ai-draft">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heading, { color: theme.textMuted }]}>
            {t("supervisorCopilot.handoff.heading")}
          </Text>
          <TextInput
            testID="handoff-ai-draft-input"
            accessibilityLabel={t("supervisorCopilot.handoff.heading")}
            style={[styles.input, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
            value={draft}
            onChangeText={(text) => {
              setTooLong(false);
              setDraft(text.slice(0, HANDOFF_NOTES_MAX));
            }}
            multiline
            maxLength={HANDOFF_NOTES_MAX}
            textAlignVertical="top"
          />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {[
              t("supervisorCopilot.handoff.disclosure"),
              phase.creditsUsed !== null ? t("supervisorCopilot.handoff.creditsUsed", { credits: phase.creditsUsed }) : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </Text>
          {tooLong ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} testID="handoff-ai-too-long">
              {t("supervisorCopilot.handoff.tooLong")}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Button label={t("supervisorCopilot.handoff.use")} onPress={applyDraft} size="sm" disabled={disabled || !draft.trim()} testID="handoff-ai-use" />
            <Button label={t("supervisorCopilot.handoff.discard")} onPress={discard} variant="ghost" size="sm" testID="handoff-ai-discard" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 6, alignItems: "flex-start" },
  hint: { fontSize: 12.5, lineHeight: 17 },
  draft: { alignSelf: "stretch", gap: 8 },
  heading: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  input: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 21, minHeight: 110 },
  row: { flexDirection: "row", gap: 8 },
});

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { DiagnosticsSheet } from "@/components/settings/DiagnosticsSheet";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { areasForRole, submitProblemReport, type ReportArea } from "@/lib/api/support";
import { newRequestId } from "@/lib/tasks/addTask/draft";
import { taskScope } from "@/lib/tasks/offline/taskCache";
import { diagnosticsToContext } from "@/lib/support/diagnostics";
import {
  MAX_REPORT_LENGTH,
  MIN_REPORT_LENGTH,
  clearDraft,
  isMeaningful,
  loadDraft,
  saveDraft,
  validateDraft,
  type DraftError,
  type ReportDraft,
} from "@/lib/support/reportDraft";
import { SUPPORT_ROUTES } from "@/lib/support/faq";
import { useDiagnostics } from "@/lib/support/useDiagnostics";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.4;
type SubmitProblem = "failed" | "offline" | "rateLimited" | null;

/** The screen that opened this form, if it passed a plain app path. Nothing else is read from the caller. */
function safeSource(value: unknown): string | null {
  return typeof value === "string" && /^\/\(app\)\/[A-Za-z0-9/_\-[\]]{1,60}$/.test(value) ? value : null;
}

export default function ReportProblemScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ from?: string }>();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const scope = taskScope(user);
  const role = user?.effective_role ?? user?.role ?? null;
  const areas = areasForRole(role);
  const diagnostics = useDiagnostics();

  const [draft, setDraft] = useState<ReportDraft>(() => ({ area: null, message: "", blocking: false, includeDiagnostics: false, requestId: newRequestId() }));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<SubmitProblem>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const busy = useRef(false);
  const dirtyRef = useRef(false);

  // Restore this person's unsent draft (never another person's: the key carries person + hotel).
  useEffect(() => {
    if (!scope) return;
    let live = true;
    loadDraft(scope).then((saved) => {
      if (!live) return;
      if (saved && !dirtyRef.current) setDraft(saved);
      setLoadedFor(scope);
    });
    return () => {
      live = false;
    };
  }, [scope]);

  // Keep the draft on this phone while the person types; a short pause avoids a write per keystroke.
  useEffect(() => {
    if (!scope || loadedFor !== scope || !dirtyRef.current || done) return;
    const timer = setTimeout(() => void saveDraft(scope, draft), 400);
    return () => clearTimeout(timer);
  }, [draft, scope, loadedFor, done]);

  const update = useCallback((patch: Partial<ReportDraft>) => {
    dirtyRef.current = true;
    setProblem(null);
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const error: DraftError = validateDraft(draft);
  const shownError = touched ? error : null;
  const hasSavedDraft = isMeaningful(draft);

  async function submit() {
    if (busy.current) return;
    setTouched(true);
    if (error || !draft.area || !scope) return;
    if (!isOnline) {
      // Honest: nothing was sent. The text is already kept as an unsent draft.
      void saveDraft(scope, draft);
      setProblem("offline");
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setProblem(null);
    try {
      const sent = await submitProblemReport({
        area: draft.area,
        message: draft.message.trim(),
        blocking: draft.blocking,
        clientRequestId: draft.requestId,
        sourceScreen: safeSource(params.from),
        diagnostics: draft.includeDiagnostics ? diagnosticsToContext(diagnostics.entries) : undefined,
      });
      // Only a server-confirmed report clears what the person wrote.
      await clearDraft(scope);
      setDone({ id: sent.id });
    } catch (err) {
      void saveDraft(scope, draft);
      setProblem(err instanceof ApiError && err.status === 429 ? "rateLimited" : "failed");
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  async function discard() {
    if (scope) await clearDraft(scope);
    dirtyRef.current = false;
    setDraft({ area: null, message: "", blocking: false, includeDiagnostics: false, requestId: newRequestId() });
    setTouched(false);
    setProblem(null);
    setDiscardOpen(false);
  }

  if (done) {
    const reference = done.id.slice(0, 8).toUpperCase();
    return (
      <SettingsScreen title={t("help.report.title")} back>
        <View style={[styles.success, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityLiveRegion="polite" testID="report-success">
          <Ionicons name="checkmark-circle" size={36} color={theme.status.ready} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.successTitle, { color: theme.textPrimary }]}>
            {t("help.report.success.title")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary, textAlign: "center" }]}>
            {t("help.report.success.body")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]} testID="report-reference">
            {t("help.report.success.reference", { id: reference })}
          </Text>
        </View>
        <Button label={t("help.report.success.view")} onPress={() => router.replace(SUPPORT_ROUTES.myReports as never)} testID="report-view-mine" />
        <Button label={t("help.report.success.done")} variant="secondary" onPress={() => router.replace(SUPPORT_ROUTES.help as never)} testID="report-done" />
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen title={t("help.report.title")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
        {t("help.report.intro")}
      </Text>

      <View style={styles.field}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.label, { color: theme.textPrimary }]}>
          {t("help.report.area")}
        </Text>
        <View style={styles.chips} accessibilityRole="radiogroup" testID="report-areas">
          {areas.map((area: ReportArea) => {
            const selected = draft.area === area;
            return (
              <Pressable
                key={area}
                onPress={() => update({ area })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`help.report.areas.${area}`)}
                style={[
                  styles.chip,
                  { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surface },
                ]}
                testID={`report-area-${area}`}
              >
                {selected ? <Ionicons name="checkmark" size={14} color={theme.primary} /> : null}
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: selected ? theme.primary : theme.textPrimary }]}>
                  {t(`help.report.areas.${area}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {shownError === "noArea" ? <FieldError text={t("help.report.errors.noArea")} /> : null}
      </View>

      <View style={styles.field}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.label, { color: theme.textPrimary }]}>
          {t("help.report.description")}
        </Text>
        <TextInput
          value={draft.message}
          onChangeText={(message) => update({ message })}
          onBlur={() => setTouched(true)}
          multiline
          textAlignVertical="top"
          maxLength={MAX_REPORT_LENGTH}
          placeholder={t("help.report.placeholder")}
          placeholderTextColor={theme.textDisabled}
          accessibilityLabel={t("help.report.description")}
          accessibilityHint={t("help.report.placeholder")}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          editable={!submitting}
          style={[
            styles.input,
            { color: theme.textPrimary, backgroundColor: theme.surfaceMuted, borderColor: shownError === "empty" || shownError === "tooShort" ? theme.status.dirty : theme.border },
          ]}
          testID="report-message"
        />
        <View style={styles.meta}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("help.report.guestWarning")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {t("help.report.count", { count: draft.message.length, max: MAX_REPORT_LENGTH })}
          </Text>
        </View>
        {shownError === "empty" ? <FieldError text={t("help.report.errors.empty")} /> : null}
        {shownError === "tooShort" ? <FieldError text={t("help.report.errors.tooShort", { min: MIN_REPORT_LENGTH })} /> : null}
      </View>

      <SettingsSection>
        <SettingsRow
          first
          icon="warning-outline"
          label={t("help.report.blocking")}
          switchValue={draft.blocking}
          onSwitchChange={(blocking) => update({ blocking })}
          testID="report-blocking"
        />
        <SettingsRow
          icon="pulse-outline"
          label={t("help.report.diagnostics")}
          subtitle={t("help.report.diagnosticsHint")}
          switchValue={draft.includeDiagnostics}
          onSwitchChange={(includeDiagnostics) => update({ includeDiagnostics })}
          testID="report-diagnostics"
        />
      </SettingsSection>
      {draft.includeDiagnostics ? (
        <Button label={t("help.report.viewDiagnostics")} variant="ghost" size="sm" onPress={() => setDiagOpen(true)} testID="report-view-diagnostics" />
      ) : null}

      {problem ? (
        <View style={styles.problem} accessibilityRole="alert" testID="report-problem">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.problemText, { color: problem === "offline" ? theme.textSecondary : theme.status.dirty }]}>
            {t(`help.report.${problem}`)}
          </Text>
        </View>
      ) : null}

      <Button
        label={submitting ? t("help.report.submitting") : problem === "failed" ? t("help.report.retry") : t("help.report.submit")}
        icon="send"
        onPress={() => void submit()}
        loading={submitting}
        disabled={submitting}
        testID="report-submit"
      />
      {hasSavedDraft ? (
        <View style={styles.draftRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted, flex: 1 }]} testID="report-draft-note">
            {t("help.report.draftNote")}
          </Text>
          <Button label={t("help.report.discard.discard")} variant="ghost" size="sm" onPress={() => setDiscardOpen(true)} disabled={submitting} testID="report-discard" />
        </View>
      ) : null}

      <DiagnosticsSheet visible={diagOpen} entries={diagnostics.entries} ready={diagnostics.ready} canShare={false} onClose={() => setDiagOpen(false)} />
      <BottomSheet
        visible={discardOpen}
        title={t("help.report.discard.title")}
        onClose={() => setDiscardOpen(false)}
        testID="report-discard-sheet"
        footer={
          <>
            <Button label={t("help.report.discard.discard")} variant="destructive" onPress={() => void discard()} testID="report-discard-confirm" />
            <Button label={t("help.report.discard.keep")} variant="secondary" onPress={() => setDiscardOpen(false)} testID="report-discard-keep" />
          </>
        }
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("help.report.discard.body")}
        </Text>
      </BottomSheet>
    </SettingsScreen>
  );
}

function FieldError({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="report-field-error">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  field: { gap: 8 },
  label: { fontSize: 15, fontWeight: "700", paddingHorizontal: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 14, fontWeight: "600" },
  input: { minHeight: 130, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, lineHeight: 21 },
  meta: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingHorizontal: 4 },
  hint: { fontSize: 12.5, lineHeight: 17 },
  error: { fontSize: 13, lineHeight: 18, fontWeight: "600", paddingHorizontal: 4 },
  problem: { paddingHorizontal: 4 },
  problemText: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  draftRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  success: { alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 16, padding: 20 },
  successTitle: { fontSize: 20, fontWeight: "800" },
});

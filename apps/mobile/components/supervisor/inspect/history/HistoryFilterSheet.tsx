import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import type { InspectorOption } from "@/lib/api/inspectionHistory";
import {
  DEFAULT_HISTORY_FILTERS,
  PERIOD_KEYS,
  filterRange,
  isYmd,
  presetRange,
  validateRange,
  type DateRange,
  type HistoryFilters,
  type PeriodKey,
  type ResultFilter,
  type TypeFilter,
} from "@/lib/inspections/history/filters";
import { rangeProblemText } from "@/lib/inspections/history/labels";
import type { Translate } from "@/lib/inspections/viewText";
import { addDaysToYmd } from "@/lib/housekeeping/hotelTime";
import { useTheme } from "@/lib/theme/useTheme";

const RESULTS: readonly ResultFilter[] = ["all", "passed", "failed", "conditional"];
const TYPES: readonly TypeFilter[] = ["all", "initial", "reinspection"];

/**
 * FILTER HISTORY. Edits a DRAFT: the list changes only on "Show results", and closing (backdrop, X, Android back) drops
 * the draft. Every option is a field the server really filters on. A custom range that is reversed, in the future or
 * too long cannot be applied, and says why.
 */
export function HistoryFilterSheet({
  visible,
  applied,
  today,
  inspectors,
  t,
  onOpen,
  onApply,
  onClose,
}: {
  visible: boolean;
  applied: HistoryFilters;
  today: string;
  inspectors: { status: "idle" | "loading" | "failed" | "ready"; rows: InspectorOption[]; truncated: boolean };
  t: Translate;
  /** Called each time the sheet opens, to load who inspected. */
  onOpen: () => void;
  onApply: (filters: HistoryFilters) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<HistoryFilters>(applied);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");

  // Every opening starts from what is applied. Not re-seeded on data refreshes, which would wipe a half-made selection.
  useEffect(() => {
    if (!visible) return;
    setDraft(applied);
    const range = filterRange(applied, today) ?? presetRange("7d", today);
    setFromText(applied.custom?.from ?? range.from);
    setToText(applied.custom?.to ?? range.to);
    onOpen();
  }, [visible]);

  const customRange: DateRange = { from: fromText.trim(), to: toText.trim() };
  const problem = draft.period === "custom" ? validateRange(customRange, today) : null;
  const problemText = rangeProblemText(problem, t);

  const choosePeriod = (period: PeriodKey) => {
    setDraft((previous) => ({ ...previous, period, custom: period === "custom" ? customRange : previous.custom }));
  };
  const editRange = (next: DateRange) => {
    setFromText(next.from);
    setToText(next.to);
    setDraft((previous) => ({ ...previous, custom: next }));
  };
  const step = (which: "from" | "to", days: number) => {
    const base = which === "from" ? customRange.from : customRange.to;
    if (!isYmd(base)) return;
    const moved = addDaysToYmd(base, days);
    editRange({ ...customRange, [which]: moved });
  };

  const apply = () => {
    if (problem) return;
    onApply({ ...draft, custom: draft.period === "custom" ? customRange : null, room: draft.room.trim() });
  };

  return (
    <WorkspaceSheet
      visible={visible}
      title={t("inspect.history.filter.title")}
      onClose={onClose}
      onBackdrop={onClose}
      closeLabel={t("inspect.filter.close")}
      testID="history-filter-sheet"
      t={t}
      footer={
        <View style={styles.footer}>
          <Pressable
            onPress={() => {
              setDraft(DEFAULT_HISTORY_FILTERS);
              const range = presetRange("7d", today);
              setFromText(range.from);
              setToText(range.to);
            }}
            accessibilityRole="button"
            testID="history-filter-reset"
            style={[styles.reset, { borderColor: theme.border, backgroundColor: theme.surface }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.resetText, { color: theme.textPrimary }]}>
              {t("inspect.history.filter.reset")}
            </Text>
          </Pressable>
          <Pressable
            onPress={apply}
            disabled={problem !== null}
            accessibilityRole="button"
            accessibilityState={{ disabled: problem !== null }}
            testID="history-filter-apply"
            style={[styles.apply, { backgroundColor: problem ? theme.surfaceMuted : theme.primaryAction }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.applyText, { color: problem ? theme.textDisabled : theme.onPrimary }]}>
              {t("inspect.history.filter.apply")}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.content}>
        <Section title={t("inspect.history.filter.dateRange")}>
          <View style={styles.wrap}>
            {PERIOD_KEYS.map((key) => (
              <Choice key={key} kind="radio" selected={draft.period === key} label={t(`inspect.history.period.${key}`)} onPress={() => choosePeriod(key)} testID={`history-filter-period-${key}`} />
            ))}
          </View>
          {draft.period === "custom" ? (
            <View style={styles.custom} testID="history-filter-custom">
              <DateField label={t("inspect.history.filter.from")} value={fromText} onChange={(text) => editRange({ ...customRange, from: text })} onStep={(days) => step("from", days)} t={t} testID="history-filter-from" />
              <DateField label={t("inspect.history.filter.to")} value={toText} onChange={(text) => editRange({ ...customRange, to: text })} onStep={(days) => step("to", days)} t={t} testID="history-filter-to" />
              {problemText ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.problem, { color: theme.status.dirty }]} testID="history-filter-problem">
                  {problemText}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Section>

        <Section title={t("inspect.history.filter.result")}>
          <View style={styles.wrap}>
            {RESULTS.map((key) => (
              <Choice key={key} kind="radio" selected={draft.result === key} label={t(`inspect.history.filter.resultOption.${key}`)} onPress={() => setDraft({ ...draft, result: key })} testID={`history-filter-result-${key}`} />
            ))}
          </View>
        </Section>

        <Section title={t("inspect.history.filter.type")}>
          <View style={styles.wrap}>
            {TYPES.map((key) => (
              <Choice key={key} kind="radio" selected={draft.type === key} label={t(`inspect.history.filter.typeOption.${key}`)} onPress={() => setDraft({ ...draft, type: key })} testID={`history-filter-type-${key}`} />
            ))}
          </View>
        </Section>

        <Section title={t("inspect.history.filter.room")}>
          <TextInput
            value={draft.room}
            onChangeText={(room) => setDraft({ ...draft, room })}
            placeholder={t("inspect.history.filter.roomPlaceholder")}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            maxLength={20}
            accessibilityLabel={t("inspect.history.filter.room")}
            testID="history-filter-room"
            style={[styles.input, { color: theme.textPrimary, backgroundColor: theme.surface, borderColor: theme.border }]}
          />
        </Section>

        <Section title={t("inspect.history.filter.inspector")}>
          {inspectors.status === "loading" ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="history-filter-inspectors-loading">
              {t("inspect.history.filter.inspectorsLoading")}
            </Text>
          ) : inspectors.status === "failed" && !draft.inspectorId ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="history-filter-inspectors-failed">
              {t("inspect.history.filter.inspectorsFailed")}
            </Text>
          ) : (
            <View style={styles.wrap}>
              <Choice kind="radio" selected={draft.inspectorId === null} label={t("inspect.history.filter.allInspectors")} onPress={() => setDraft({ ...draft, inspectorId: null })} testID="history-filter-inspector-all" />
              {inspectors.rows.map((inspector) => (
                <Choice
                  key={inspector.id}
                  kind="radio"
                  selected={draft.inspectorId === inspector.id}
                  label={inspector.name?.trim() || t("inspect.history.filter.inspectorUnnamed")}
                  onPress={() => setDraft({ ...draft, inspectorId: inspector.id })}
                  testID={`history-filter-inspector-${inspector.id}`}
                />
              ))}
              {draft.inspectorId && !inspectors.rows.some((inspector) => inspector.id === draft.inspectorId) ? (
                <Choice kind="radio" selected label={t("inspect.history.filter.inspectorChipUnknown")} onPress={() => undefined} testID="history-filter-inspector-selected" />
              ) : null}
            </View>
          )}
          {inspectors.status === "ready" && inspectors.rows.length === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {t("inspect.history.filter.noInspectors")}
            </Text>
          ) : null}
        </Section>

        {draft.standard ? (
          <Section title={t("inspect.history.filter.standard")}>
            <Choice kind="checkbox" selected label={draft.standard.label} onPress={() => setDraft({ ...draft, standard: null })} testID="history-filter-standard" />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {t("inspect.history.filter.standardHint")}
            </Text>
          </Section>
        ) : null}
      </View>
    </WorkspaceSheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function DateField({ label, value, onChange, onStep, t, testID }: { label: string; value: string; onChange: (text: string) => void; onStep: (days: number) => void; t: Translate; testID: string }) {
  const theme = useTheme();
  return (
    <View style={styles.dateRow}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dateLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Pressable onPress={() => onStep(-1)} accessibilityRole="button" accessibilityLabel={t("inspect.history.filter.dayBefore", { label })} style={[styles.stepper, { borderColor: theme.border }]} testID={`${testID}-minus`}>
        <Ionicons name="remove" size={18} color={theme.textPrimary} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.textMuted}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={10}
        accessibilityLabel={label}
        testID={testID}
        style={[styles.dateInput, { color: theme.textPrimary, backgroundColor: theme.surface, borderColor: theme.border }]}
      />
      <Pressable onPress={() => onStep(1)} accessibilityRole="button" accessibilityLabel={t("inspect.history.filter.dayAfter", { label })} style={[styles.stepper, { borderColor: theme.border }]} testID={`${testID}-plus`}>
        <Ionicons name="add" size={18} color={theme.textPrimary} />
      </Pressable>
    </View>
  );
}

/** A selectable option. Selection is a check mark AND a filled style - never colour alone. */
function Choice({ kind, selected, label, onPress, testID }: { kind: "radio" | "checkbox"; selected: boolean; label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const icon = kind === "radio" ? (selected ? "radio-button-on" : "radio-button-off") : selected ? "checkbox" : "square-outline";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={kind}
      accessibilityLabel={label}
      accessibilityState={kind === "radio" ? { selected } : { checked: selected }}
      testID={testID}
      style={({ pressed }) => [styles.choice, { backgroundColor: selected ? theme.primaryAction : theme.surface, borderColor: selected ? theme.primaryAction : theme.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name={icon} size={18} color={selected ? theme.onPrimary : theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.choiceLabel, { color: selected ? theme.onPrimary : theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 12.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TARGET, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: R.md, maxWidth: "100%" },
  choiceLabel: { fontSize: 14.5, fontWeight: "700", flexShrink: 1 },
  custom: { gap: 8 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateLabel: { width: 48, fontSize: 13, fontWeight: "700" },
  dateInput: { flex: 1, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, fontSize: 15 },
  stepper: { width: MIN_TARGET, height: MIN_TARGET, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  input: { minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, fontSize: 15 },
  problem: { fontSize: 13, fontWeight: "700" },
  muted: { fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: "row", gap: 10 },
  reset: { minHeight: 52, minWidth: 96, paddingHorizontal: 18, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  resetText: { fontSize: 15, fontWeight: "800" },
  apply: { flex: 1, minHeight: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  applyText: { fontSize: 16, fontWeight: "800" },
});

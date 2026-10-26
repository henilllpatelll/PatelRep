import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { CompareLines, WarningLines } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { attendanceLabel, candidateLabel, capacityText, isHighLoad, missingText } from "@/lib/housekeeping/assignmentFlowText";
import type { AssignCandidate, AssignPicker } from "@/lib/housekeeping/assignmentPicker";
import type { AssignmentFlowController } from "@/lib/housekeeping/useAssignmentFlow";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const ATTENDANCE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  on_shift: "checkmark-circle-outline",
  on_break: "cafe-outline",
  shift_ended: "time-outline",
  scheduled_not_clocked_in: "calendar-outline",
  not_clocked_in: "remove-circle-outline",
  unknown: "help-circle-outline",
};

function Tag({ label, icon, color, testID }: { label: string; icon?: keyof typeof Ionicons.glyphMap; color: string; testID?: string }) {
  return (
    <View style={[styles.tag, { borderColor: color }]} testID={testID}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tagText, { color }]}>
        {label}
      </Text>
    </View>
  );
}

function CandidateCard({ candidate, selected, t, onSelect }: { candidate: AssignCandidate; selected: boolean; t: Translate; onSelect: (userId: string) => void }) {
  const theme = useTheme();
  const name = candidate.name ?? t("assignments.v2.assign.unnamed");
  const capacity = capacityText(candidate.current, candidate.after, t);
  const missing = missingText((candidate.after ?? candidate.current).minutes, t);
  const floors = candidate.floors.length > 0 && candidate.floors.length <= 3 ? t("assignments.v2.assign.candidate.floors", { floors: candidate.floors.join(", ") }) : null;
  const proximity = candidate.proximity ? t(`assignments.v2.assign.candidate.proximity.${candidate.proximity}`) : null;
  const highLoad = isHighLoad(candidate);
  const disabled = candidate.isCurrentOwner;
  return (
    <Pressable
      onPress={() => onSelect(candidate.userId)}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled, checked: selected }}
      accessibilityLabel={candidateLabel(candidate, t)}
      accessibilityHint={disabled ? t("assignments.v2.assign.candidate.currentOwnerHint") : undefined}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? theme.primarySoft : theme.surface,
          borderColor: selected ? theme.primaryAction : theme.border,
          borderWidth: selected ? 2 : 1,
        },
        disabled && styles.dimmed,
        pressed && !disabled && styles.pressed,
      ]}
      testID={`assign-candidate-${candidate.userId}`}
    >
      <Avatar name={candidate.name ?? "?"} size={40} />
      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.name, { color: theme.textPrimary }]}>
            {name}
          </Text>
        </View>
        <View style={styles.tags}>
          {candidate.suggested ? <Tag label={t("assignments.v2.assign.candidate.suggested")} icon="sparkles-outline" color={theme.primaryAction} testID={`assign-candidate-${candidate.userId}-suggested`} /> : null}
          {candidate.isCurrentOwner ? <Tag label={t("assignments.v2.assign.candidate.currentOwner")} icon="person-circle-outline" color={theme.textSecondary} /> : null}
          {highLoad ? <Tag label={t("assignments.v2.assign.candidate.highLoad")} icon="warning-outline" color={theme.destructiveAction} testID={`assign-candidate-${candidate.userId}-high-load`} /> : null}
        </View>
        <View style={styles.attendance}>
          <Ionicons name={ATTENDANCE_ICON[candidate.attendance] ?? "help-circle-outline"} size={14} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID={`assign-candidate-${candidate.userId}-attendance`}>
            {[attendanceLabel(candidate.attendance, t), floors, proximity].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <CompareLines current={candidate.current} after={candidate.after} t={t} testIDPrefix={`assign-candidate-${candidate.userId}`} />
        {missing ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID={`assign-candidate-${candidate.userId}-missing`}>
            {missing}
          </Text>
        ) : null}
        {candidate.roomEstimateMissing && candidate.after ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
            {t("assignments.v2.assign.candidate.roomNoEstimate")}
          </Text>
        ) : null}
        {capacity ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID={`assign-candidate-${candidate.userId}-capacity`}>
            {capacity}
          </Text>
        ) : null}
        {candidate.suggested ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.primaryAction }]} testID={`assign-candidate-${candidate.userId}-reason`}>
            {t(`assignments.v2.assign.candidate.reason.${candidate.suggested}`)}
          </Text>
        ) : null}
        <WarningLines warnings={candidate.newWarnings} t={t} testIDPrefix={`assign-candidate-${candidate.userId}-warning`} />
      </View>
      <Ionicons
        name={selected ? "radio-button-on" : disabled ? "lock-closed-outline" : "radio-button-off"}
        size={22}
        color={selected ? theme.primaryAction : theme.textMuted}
      />
    </Pressable>
  );
}

export function AssignPickerStep({ controller, paused, t }: { controller: AssignmentFlowController; paused: string | null; t: Translate }) {
  const { flow, picker } = controller;
  if (!flow || !picker) return null;
  return <PickerBody controller={controller} picker={picker} paused={paused} t={t} query={flow.query} selectedId={flow.selectedId} />;
}

function PickerBody({
  controller,
  picker,
  paused,
  t,
  query,
  selectedId,
}: {
  controller: AssignmentFlowController;
  picker: AssignPicker;
  paused: string | null;
  t: Translate;
  query: string;
  selectedId: string | null;
}) {
  const theme = useTheme();
  const reassign = picker.intent === "reassign";
  const summary = [
    picker.cleanTypeLabel,
    picker.estimate ? t("assignments.v2.assign.picker.estimate", { minutes: picker.estimate.minutes }) : t("assignments.v2.assign.picker.noEstimate"),
  ]
    .filter(Boolean)
    .join(" · ");
  const chip = (filter: "on_shift" | "all", label: string) => {
    const active = picker.filter === filter;
    return (
      <Pressable
        key={filter}
        onPress={() => controller.setFilter(filter)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        style={[styles.chip, { backgroundColor: active ? theme.primaryAction : theme.surfaceMuted, borderColor: active ? theme.primaryAction : theme.border }]}
        testID={`assign-filter-${filter}`}
      >
        {active ? <Ionicons name="checkmark" size={14} color={theme.onPrimary} /> : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: active ? theme.onPrimary : theme.textPrimary }]}>
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: theme.textSecondary }]} testID="assign-picker-summary">
        {summary}
      </Text>

      <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="search-outline" size={18} color={theme.textMuted} />
        <TextInput
          value={query}
          onChangeText={controller.setQuery}
          placeholder={t("assignments.v2.assign.picker.search")}
          placeholderTextColor={theme.textMuted}
          accessibilityLabel={t("assignments.v2.assign.picker.searchLabel")}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.searchInput, { color: theme.textPrimary }]}
          testID="assign-search"
        />
        {query ? (
          <Pressable onPress={() => controller.setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("assignments.v2.assign.picker.clearSearch")} testID="assign-search-clear">
            <Ionicons name="close-circle" size={18} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {picker.rosterVerified ? (
        <View style={styles.chips} accessibilityRole="tablist">
          {chip("on_shift", t("assignments.v2.assign.picker.filterOnShift", { count: picker.counts.onShift }))}
          {chip("all", t("assignments.v2.assign.picker.filterAll", { count: picker.counts.all }))}
        </View>
      ) : (
        <View style={[styles.note, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="assign-unverified">
          <Ionicons name="help-circle-outline" size={16} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textSecondary }]}>
            {t("assignments.v2.assign.picker.unverified")}
          </Text>
        </View>
      )}

      {picker.candidates.length > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caption, { color: theme.textMuted }]}>
          {t("assignments.v2.assign.picker.caption")}
        </Text>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled testID="assign-candidates">
        {picker.empty ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="assign-empty">
            {t(`assignments.v2.assign.picker.empty.${picker.empty}`, { query: query.trim() })}
          </Text>
        ) : (
          picker.candidates.map((candidate) => (
            <CandidateCard key={candidate.userId} candidate={candidate} selected={candidate.userId === selectedId} t={t} onSelect={controller.select} />
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={t(reassign ? "assignments.v2.assign.picker.continueReassign" : "assignments.v2.assign.picker.continue")}
          onPress={controller.toReview}
          disabled={!controller.canContinue || !!paused}
          testID="assign-continue"
        />
        <Button label={t("common.cancel")} variant="secondary" onPress={controller.close} testID="assign-cancel" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 14, fontWeight: "600" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: "center" },
  chipText: { fontSize: 13.5, fontWeight: "700" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { gap: 8, paddingBottom: 6 },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 18, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: R.lg, paddingHorizontal: 12, paddingVertical: 12, minHeight: 64 },
  cardBody: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: "800" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11.5, fontWeight: "800" },
  attendance: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: { fontSize: 12.5, lineHeight: 17, flexShrink: 1 },
  dimmed: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  footer: { gap: 8, paddingTop: 6 },
});

import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Choice, Section } from "@/components/supervisor/board/BoardFilterSheet";
import { DEFAULT_VIEW_STATE, type FilterOptions, type ScheduleViewState, type TeamSortKey } from "@/lib/scheduling/teamScheduleQuery";
import { groupWindowText, statusLabel, roleLabel, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

const SORTS: readonly TeamSortKey[] = ["start", "name", "status"];

interface Props {
  visible: boolean;
  applied: ScheduleViewState;
  options: FilterOptions;
  /** Status filters only make sense on a day that makes an attendance claim. */
  showStatus: boolean;
  /** How many people the draft would show, so the button says what it will do. */
  previewCount: (draft: ScheduleViewState) => number;
  t: Translate;
  onApply: (draft: ScheduleViewState) => void;
  onClose: () => void;
}

/**
 * Filter & Sort bottom sheet. Edits a DRAFT: the list changes only when the footer button is tapped, and that
 * button says how many people it will show. Every option comes from the people on the day — a status, role or
 * shift nobody has is not offered.
 */
export function ScheduleFilterSheet({ visible, applied, options, showStatus, previewCount, t, onApply, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ScheduleViewState>(applied);

  // Every opening starts from what is applied; edits before a cancelled close are dropped.
  useEffect(() => {
    if (visible) setDraft(applied);
    // Re-seeds on open only — a background refresh must not wipe a half-made selection.
  }, [visible]);

  const { filters, sort } = draft;
  const count = useMemo(() => previewCount(draft), [previewCount, draft]);
  const set = (next: Partial<typeof filters>) => setDraft({ ...draft, filters: { ...filters, ...next } });
  // The selected option is always offered, even if nobody has it any more, so it can be seen and cleared.
  const statuses = filters.status !== "all" && !options.statuses.includes(filters.status) ? [...options.statuses, filters.status] : options.statuses;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="team-schedule-filter-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal testID="team-schedule-filter-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.headerBtn} testID="team-schedule-filter-close">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.textSecondary }]}>
                {t("common.close")}
              </Text>
            </Pressable>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
              {t("teamSchedule.filters.title")}
            </Text>
            <Pressable onPress={() => setDraft({ ...DEFAULT_VIEW_STATE, query: draft.query })} accessibilityRole="button" accessibilityLabel={t("teamSchedule.filters.reset")} style={styles.headerBtn} testID="team-schedule-filter-reset">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.primaryAction }]}>
                {t("teamSchedule.filters.reset")}
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {showStatus && statuses.length > 0 ? (
              <Section title={t("teamSchedule.filters.statusTitle")}>
                <View accessibilityRole="radiogroup" style={styles.wrap}>
                  <Choice kind="radio" selected={filters.status === "all"} label={t("teamSchedule.filters.all")} onPress={() => set({ status: "all" })} testID="team-schedule-filter-status-all" />
                  {statuses.map((status) => (
                    <Choice key={status} kind="radio" selected={filters.status === status} label={statusLabel(status, t)} onPress={() => set({ status })} testID={`team-schedule-filter-status-${status}`} />
                  ))}
                </View>
              </Section>
            ) : null}

            {options.roles.length > 1 || filters.role !== null ? (
              <Section title={t("teamSchedule.filters.roleTitle")}>
                <View accessibilityRole="radiogroup" style={styles.wrap}>
                  <Choice kind="radio" selected={filters.role === null} label={t("teamSchedule.filters.all")} onPress={() => set({ role: null })} testID="team-schedule-filter-role-all" />
                  {options.roles.map((role) => (
                    <Choice key={role} kind="radio" selected={filters.role === role} label={roleLabel(role, t)} onPress={() => set({ role })} testID={`team-schedule-filter-role-${role}`} />
                  ))}
                </View>
              </Section>
            ) : null}

            {options.shifts.length > 1 || filters.shiftKey !== null ? (
              <Section title={t("teamSchedule.filters.shiftTitle")}>
                <View accessibilityRole="radiogroup" style={styles.stack}>
                  <Choice kind="radio" selected={filters.shiftKey === null} label={t("teamSchedule.filters.all")} onPress={() => set({ shiftKey: null })} testID="team-schedule-filter-shift-all" />
                  {options.shifts.map((shift) => (
                    <Choice
                      key={shift.key}
                      kind="radio"
                      selected={filters.shiftKey === shift.key}
                      label={shift.name ?? groupWindowText(shift, t)}
                      hint={shift.name ? groupWindowText(shift, t) : undefined}
                      onPress={() => set({ shiftKey: shift.key })}
                      testID={`team-schedule-filter-shift-${shift.key}`}
                    />
                  ))}
                </View>
              </Section>
            ) : null}

            <Section title={t("teamSchedule.filters.sortTitle")}>
              <View accessibilityRole="radiogroup" style={styles.stack}>
                {SORTS.map((key) => (
                  <Choice key={key} kind="radio" selected={sort === key} label={t(`teamSchedule.filters.sort.${key}`)} onPress={() => setDraft({ ...draft, sort: key })} testID={`team-schedule-sort-${key}`} />
                ))}
              </View>
            </Section>
          </ScrollView>

          <Pressable
            onPress={() => onApply(draft)}
            accessibilityRole="button"
            accessibilityLabel={t("teamSchedule.filters.apply", { count })}
            testID="team-schedule-filter-apply"
            style={({ pressed }) => [styles.apply, { backgroundColor: theme.primaryAction }, pressed && { opacity: 0.85 }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.applyText, { color: theme.onPrimary }]} testID="team-schedule-filter-apply-text">
              {t("teamSchedule.filters.apply", { count })}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "90%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  headerBtn: { minHeight: MIN_TARGET, minWidth: 64, paddingHorizontal: 8, justifyContent: "center" },
  headerBtnText: { fontSize: 15, fontWeight: "700" },
  title: { flexShrink: 1, fontSize: 18, fontWeight: "800", textAlign: "center" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 18 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stack: { gap: 8 },
  apply: { minHeight: MIN_TARGET + 4, marginHorizontal: 16, marginTop: 8, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  applyText: { fontSize: 16, fontWeight: "800" },
});

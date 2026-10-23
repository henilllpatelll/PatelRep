import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Choice, Section } from "@/components/supervisor/board/BoardFilterSheet";
import type { AssignmentFilterOptions, AssignmentFilters, AssignmentScope, AssignmentSortKey, PriorityFilter } from "@/lib/housekeeping/assignmentQuery";
import { DEFAULT_VIEW_STATE, type AssignmentViewState } from "@/lib/housekeeping/assignmentRoomsView";
import { NONE_KEY, toggleIn } from "@/lib/housekeeping/roomBoardFilters";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The assignment axis the sheet offers. "Urgent" is a priority choice, so it is never an assignment choice. */
const SCOPES: readonly Extract<AssignmentScope, "all" | "unassigned" | "assigned" | "blocked">[] = ["all", "unassigned", "assigned", "blocked"];

/** A draft never carries the legacy "urgent" scope: that is exactly Priority → Urgent. */
function normalizeDraft(state: AssignmentViewState): AssignmentViewState {
  return state.scope === "urgent" ? { ...state, scope: "all", filters: { ...state.filters, priority: "urgent" } } : state;
}

/** Choosing a building drops floors that belong to other buildings, so the selection can never contradict itself. */
function selectBuilding(filters: AssignmentFilters, building: string | null): AssignmentFilters {
  const floors = building === null ? filters.floors : filters.floors.filter((key) => key.startsWith(`${building}|`));
  return { ...filters, building, floors };
}

/**
 * Filter & Sort bottom sheet for the Rooms tab. Edits a DRAFT: the list changes only when the footer button is
 * tapped, and that button says how many rooms it will show. Closing discards the draft. Every option comes from
 * the current rooms — a floor, building, type or status nobody has is not offered.
 */
export function AssignmentFilterSheet({
  visible,
  applied,
  options,
  previewCount,
  t,
  onApply,
  onClose,
}: {
  visible: boolean;
  applied: AssignmentViewState;
  options: AssignmentFilterOptions;
  /** How many rooms a draft would show (the screen runs the same query the list uses). */
  previewCount: (draft: AssignmentViewState) => number;
  t: Translate;
  onApply: (draft: AssignmentViewState) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<AssignmentViewState>(() => normalizeDraft(applied));

  // Every opening starts from what is applied; edits made before a cancelled close are dropped.
  useEffect(() => {
    if (visible) setDraft(normalizeDraft(applied));
    // Re-seeds on open only — not on every refresh, which would wipe a half-made selection.
  }, [visible]);

  const { filters, scope, sort } = draft;
  const multiBuilding = options.buildings.length > 1;
  const floors = useMemo(
    () => (filters.building === null ? options.floors : options.floors.filter((floor) => (floor.building ?? NONE_KEY) === filters.building)),
    [options.floors, filters.building],
  );
  const count = useMemo(() => previewCount(draft), [previewCount, draft]);
  const setFilters = (next: AssignmentFilters) => setDraft({ ...draft, filters: next });

  const priorities: PriorityFilter[] = ["any", "urgent", ...(options.hasVip || filters.priority === "vip" ? (["vip"] as const) : []), ...(options.hasAtRisk || filters.priority === "at_risk" ? (["at_risk"] as const) : [])];
  const sorts: AssignmentSortKey[] = ["priority", "roomNumber", "location", ...(options.hasDeadline || sort === "deadline" ? (["deadline"] as const) : [])];

  const floorLabel = (floor: { building: string | null; floor: number | null }): string => {
    const level = floor.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: floor.floor });
    return multiBuilding && filters.building === null
      ? t("roomBoard.filters.chipFloor", { where: floor.building ? t("roomBoard.building", { building: floor.building }) : t("roomBoard.buildingNone"), level })
      : level;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="assignments-filter-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal testID="assignments-filter-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.headerBtn} testID="assignments-filter-close">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.textSecondary }]}>
                {t("common.close")}
              </Text>
            </Pressable>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
              {t("assignments.v2.filters.title")}
            </Text>
            <Pressable onPress={() => setDraft(DEFAULT_VIEW_STATE)} accessibilityRole="button" accessibilityLabel={t("assignments.v2.filters.reset")} style={styles.headerBtn} testID="assignments-filter-reset">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.primaryAction }]}>
                {t("assignments.v2.filters.reset")}
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="assignments-filter-scroll">
            <Section title={t("assignments.v2.filters.assignment")}>
              <View accessibilityRole="radiogroup" style={styles.wrap}>
                {SCOPES.map((key) => (
                  <Choice key={key} kind="radio" selected={scope === key} label={t(`assignments.v2.filters.scope.${key}`)} onPress={() => setDraft({ ...draft, scope: key })} testID={`assignments-filter-scope-${key}`} />
                ))}
              </View>
            </Section>

            <Section title={t("assignments.v2.filters.priorityTitle")}>
              <View accessibilityRole="radiogroup" style={styles.wrap}>
                {priorities.map((key) => (
                  <Choice key={key} kind="radio" selected={filters.priority === key} label={t(`assignments.v2.filters.priority.${key}`)} onPress={() => setFilters({ ...filters, priority: key })} testID={`assignments-filter-priority-${key}`} />
                ))}
              </View>
            </Section>

            {multiBuilding || floors.length > 1 ? (
              <Section title={t("roomBoard.filters.locationTitle")}>
                {multiBuilding ? (
                  <View style={styles.block}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subTitle, { color: theme.textMuted }]}>
                      {t("roomBoard.filters.buildingTitle")}
                    </Text>
                    <View accessibilityRole="radiogroup" style={styles.wrap}>
                      <Choice kind="radio" selected={filters.building === null} label={t("roomBoard.filters.allBuildings")} onPress={() => setFilters(selectBuilding(filters, null))} testID="assignments-filter-building-all" />
                      {options.buildings.map((building) => (
                        <Choice
                          key={building}
                          kind="radio"
                          selected={filters.building === building}
                          label={building === NONE_KEY ? t("roomBoard.buildingNone") : t("roomBoard.building", { building })}
                          onPress={() => setFilters(selectBuilding(filters, building))}
                          testID={`assignments-filter-building-${building}`}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                {floors.length > 1 ? (
                  <View style={styles.block}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subTitle, { color: theme.textMuted }]}>
                      {t("roomBoard.filters.floorsTitle")}
                    </Text>
                    <View style={styles.wrap}>
                      {floors.map((floor) => (
                        <Choice key={floor.key} kind="checkbox" selected={filters.floors.includes(floor.key)} label={floorLabel(floor)} onPress={() => setFilters({ ...filters, floors: toggleIn(filters.floors, floor.key) })} testID={`assignments-filter-floor-${floor.key}`} />
                      ))}
                    </View>
                  </View>
                ) : null}
              </Section>
            ) : null}

            {options.cleanTypes.length > 1 ? (
              <Section title={t("assignments.v2.filters.cleanTypeTitle")}>
                <View style={styles.wrap}>
                  {options.cleanTypes.map((type) => (
                    <Choice
                      key={type.key}
                      kind="checkbox"
                      selected={filters.cleanTypes.includes(type.key)}
                      label={type.label ?? t("assignments.v2.filters.cleanTypeNone")}
                      onPress={() => setFilters({ ...filters, cleanTypes: toggleIn(filters.cleanTypes, type.key) })}
                      testID={`assignments-filter-type-${type.key}`}
                    />
                  ))}
                </View>
              </Section>
            ) : null}

            {options.statuses.length > 1 ? (
              <Section title={t("assignments.v2.filters.statusTitle")}>
                <View style={styles.wrap}>
                  {options.statuses.map((code) => (
                    <Choice
                      key={code}
                      kind="checkbox"
                      selected={filters.statuses.includes(code)}
                      label={t(`roomBoard.card.status.${code === "" ? "UNKNOWN" : code}`)}
                      onPress={() => setFilters({ ...filters, statuses: toggleIn(filters.statuses, code) })}
                      testID={`assignments-filter-status-${code}`}
                    />
                  ))}
                </View>
              </Section>
            ) : null}

            <Section title={t("assignments.v2.filters.sortTitle")}>
              <View accessibilityRole="radiogroup" style={styles.stack}>
                {sorts.map((key) => (
                  <Choice key={key} kind="radio" selected={sort === key} label={t(`assignments.v2.sort.${key}`)} onPress={() => setDraft({ ...draft, sort: key })} testID={`assignments-sort-${key}`} />
                ))}
              </View>
            </Section>
          </ScrollView>

          <Pressable
            onPress={() => onApply(draft)}
            accessibilityRole="button"
            accessibilityLabel={t("assignments.v2.filters.apply", { count })}
            testID="assignments-filter-apply"
            style={({ pressed }) => [styles.apply, { backgroundColor: theme.primaryAction }, pressed && { opacity: 0.85 }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.applyText, { color: theme.onPrimary }]} testID="assignments-filter-apply-text">
              {t("assignments.v2.filters.apply", { count })}
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
  subTitle: { fontSize: 12.5, fontWeight: "700" },
  block: { gap: 8 },
  stack: { gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  apply: { marginHorizontal: 16, marginTop: 10, minHeight: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  applyText: { fontSize: 16, fontWeight: "800" },
});

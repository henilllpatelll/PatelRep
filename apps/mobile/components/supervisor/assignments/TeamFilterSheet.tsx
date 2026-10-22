import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Choice, Section } from "@/components/supervisor/board/BoardFilterSheet";
import {
  DEFAULT_TEAM_VIEW_STATE,
  WORKLOAD_FILTERS,
  type TeamFilterOptions,
  type TeamFilters,
  type TeamSortKey,
  type TeamViewState,
} from "@/lib/housekeeping/assignmentTeamQuery";
import { NONE_KEY, toggleIn } from "@/lib/housekeeping/roomBoardFilters";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Choosing a building drops floors that belong to other buildings, so the selection can never contradict itself. */
function selectBuilding(filters: TeamFilters, building: string | null): TeamFilters {
  const floors = building === null ? filters.floors : filters.floors.filter((key) => key.startsWith(`${building}|`));
  return { ...filters, building, floors };
}

/**
 * Filter & Sort bottom sheet for the Team tab — the same sheet pattern as the Rooms tab's. Edits a DRAFT: the list
 * changes only when the footer button is tapped, and that button says how many people it will show. Every
 * attendance, building and floor option comes from the current team: a state nobody is in is not offered.
 */
export function TeamFilterSheet({
  visible,
  applied,
  options,
  rosterVerified,
  previewCount,
  t,
  onApply,
  onClose,
}: {
  visible: boolean;
  applied: TeamViewState;
  options: TeamFilterOptions;
  /** Without a verified roster "Most available" cannot rank anyone; the sheet says so instead of offering a false promise. */
  rosterVerified: boolean;
  previewCount: (draft: TeamViewState) => number;
  t: Translate;
  onApply: (draft: TeamViewState) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<TeamViewState>(applied);

  // Every opening starts from what is applied; edits made before a cancelled close are dropped.
  useEffect(() => {
    if (visible) setDraft(applied);
    // Re-seeds on open only — not on every refresh, which would wipe a half-made selection.
  }, [visible]);

  const { filters, sort } = draft;
  const multiBuilding = options.buildings.length > 1;
  const floors = useMemo(
    () => (filters.building === null ? options.floors : options.floors.filter((floor) => (floor.building ?? NONE_KEY) === filters.building)),
    [options.floors, filters.building],
  );
  const count = useMemo(() => previewCount(draft), [previewCount, draft]);
  const setFilters = (next: TeamFilters) => setDraft({ ...draft, filters: next });

  // The selected option is always offered, even if nobody is in that state any more, so it can be seen and cleared.
  const attendanceOptions = options.attendance.includes(filters.attendance as never) || filters.attendance === "all" ? options.attendance : [...options.attendance, filters.attendance as never];
  const sorts: TeamSortKey[] = ["available", "name", "least_remaining", "most_remaining", "most_rooms", "most_completed", ...(options.capacitySort || sort === "capacity" ? (["capacity"] as const) : [])];

  const floorLabel = (floor: { building: string | null; floor: number | null }): string => {
    const level = floor.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: floor.floor });
    return multiBuilding && filters.building === null
      ? t("roomBoard.filters.chipFloor", { where: floor.building ? t("roomBoard.building", { building: floor.building }) : t("roomBoard.buildingNone"), level })
      : level;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="assignments-team-filter-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal testID="assignments-team-filter-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.headerBtn} testID="assignments-team-filter-close">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.textSecondary }]}>
                {t("common.close")}
              </Text>
            </Pressable>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
              {t("assignments.v2.team.filters.title")}
            </Text>
            <Pressable onPress={() => setDraft(DEFAULT_TEAM_VIEW_STATE)} accessibilityRole="button" accessibilityLabel={t("assignments.v2.filters.reset")} style={styles.headerBtn} testID="assignments-team-filter-reset">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.primaryAction }]}>
                {t("assignments.v2.filters.reset")}
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="assignments-team-filter-scroll">
            <Section title={t("assignments.v2.team.filters.attendanceTitle")}>
              <View accessibilityRole="radiogroup" style={styles.wrap}>
                <Choice kind="radio" selected={filters.attendance === "all"} label={t("assignments.v2.team.filters.attendance.all")} onPress={() => setFilters({ ...filters, attendance: "all" })} testID="assignments-team-filter-attendance-all" />
                {attendanceOptions.map((key) => (
                  <Choice key={key} kind="radio" selected={filters.attendance === key} label={t(`assignments.v2.team.filters.attendance.${key}`)} onPress={() => setFilters({ ...filters, attendance: key })} testID={`assignments-team-filter-attendance-${key}`} />
                ))}
              </View>
            </Section>

            <Section title={t("assignments.v2.team.filters.workloadTitle")}>
              <View accessibilityRole="radiogroup" style={styles.wrap}>
                <Choice kind="radio" selected={filters.workload === "all"} label={t("assignments.v2.team.filters.workload.all")} onPress={() => setFilters({ ...filters, workload: "all" })} testID="assignments-team-filter-workload-all" />
                {WORKLOAD_FILTERS.map((key) => (
                  <Choice key={key} kind="radio" selected={filters.workload === key} label={t(`assignments.v2.team.filters.workload.${key}`)} onPress={() => setFilters({ ...filters, workload: key })} testID={`assignments-team-filter-workload-${key}`} />
                ))}
              </View>
            </Section>

            {multiBuilding || floors.length > 1 ? (
              <Section title={t("assignments.v2.team.filters.coverageTitle")}>
                {multiBuilding ? (
                  <View style={styles.block}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subTitle, { color: theme.textMuted }]}>
                      {t("roomBoard.filters.buildingTitle")}
                    </Text>
                    <View accessibilityRole="radiogroup" style={styles.wrap}>
                      <Choice kind="radio" selected={filters.building === null} label={t("roomBoard.filters.allBuildings")} onPress={() => setFilters(selectBuilding(filters, null))} testID="assignments-team-filter-building-all" />
                      {options.buildings.map((building) => (
                        <Choice
                          key={building}
                          kind="radio"
                          selected={filters.building === building}
                          label={building === NONE_KEY ? t("roomBoard.buildingNone") : t("roomBoard.building", { building })}
                          onPress={() => setFilters(selectBuilding(filters, building))}
                          testID={`assignments-team-filter-building-${building}`}
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
                        <Choice key={floor.key} kind="checkbox" selected={filters.floors.includes(floor.key)} label={floorLabel(floor)} onPress={() => setFilters({ ...filters, floors: toggleIn(filters.floors, floor.key) })} testID={`assignments-team-filter-floor-${floor.key}`} />
                      ))}
                    </View>
                  </View>
                ) : null}
              </Section>
            ) : null}

            <Section title={t("assignments.v2.filters.sortTitle")}>
              {!rosterVerified ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subTitle, { color: theme.textMuted }]} testID="assignments-team-sort-unverified">
                  {t("assignments.v2.team.sortUnverified")}
                </Text>
              ) : null}
              <View accessibilityRole="radiogroup" style={styles.stack}>
                {sorts.map((key) => (
                  <Choice key={key} kind="radio" selected={sort === key} label={t(`assignments.v2.team.sort.${key}`)} onPress={() => setDraft({ ...draft, sort: key })} testID={`assignments-team-sort-${key}`} />
                ))}
              </View>
            </Section>
          </ScrollView>

          <Pressable
            onPress={() => onApply(draft)}
            accessibilityRole="button"
            accessibilityLabel={t("assignments.v2.team.filters.apply", { count })}
            testID="assignments-team-filter-apply"
            style={({ pressed }) => [styles.apply, { backgroundColor: theme.primaryAction }, pressed && { opacity: 0.85 }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.applyText, { color: theme.onPrimary }]} testID="assignments-team-filter-apply-text">
              {t("assignments.v2.team.filters.apply", { count })}
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

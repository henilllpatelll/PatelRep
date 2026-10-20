import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import {
  EMPTY_FILTERS,
  FLAG_FILTERS,
  NONE_KEY,
  STATUS_FILTERS,
  floorsForBuilding,
  selectBuilding,
  toggleIn,
  type BoardFilters,
  type FilterAvailability,
} from "@/lib/housekeeping/roomBoardFilters";
import type { FilterDraft } from "@/lib/housekeeping/roomBoardQuery";
import { BOARD_SORTS, DEFAULT_SORT } from "@/lib/housekeeping/roomBoardSort";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Filter & Sort bottom sheet. Edits a DRAFT: the board changes only when "Apply filters" is tapped.
 * Closing (backdrop, Close, Android back) discards the draft; reopening starts from what is applied.
 */
export function BoardFilterSheet({
  visible,
  applied,
  availability,
  t,
  onApply,
  onClose,
}: {
  visible: boolean;
  applied: FilterDraft;
  availability: FilterAvailability;
  t: Translate;
  onApply: (draft: FilterDraft) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<FilterDraft>(applied);

  // Every opening starts from the applied selection; edits made before a cancelled close are dropped.
  useEffect(() => {
    if (visible) setDraft(applied);
    // Re-seeds on open only — not on every board refresh, which would wipe a half-made selection.
  }, [visible]);

  const { filters, sort } = draft;
  const multiBuilding = availability.buildings.length > 1;
  const floors = useMemo(() => floorsForBuilding(availability, filters.building), [availability, filters.building]);
  const statusKeys = STATUS_FILTERS.filter(
    (key) => key !== "unrecognized" || availability.hasUnrecognized || filters.statuses.includes("unrecognized"),
  );

  const floorLabel = (floor: { building: string | null; floor: number | null }): string => {
    const level = floor.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: floor.floor });
    return multiBuilding && filters.building === null
      ? t("roomBoard.filters.chipFloor", {
          where: floor.building ? t("roomBoard.building", { building: floor.building }) : t("roomBoard.buildingNone"),
          level,
        })
      : level;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          testID="board-filter-backdrop"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.background,
              paddingBottom: Math.max(16, insets.bottom + 8),
            },
          ]}
          accessibilityViewIsModal
          testID="board-filter-sheet"
        >
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              style={styles.headerBtn}
              testID="board-filter-close"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.textSecondary }]}>
                {t("common.close")}
              </Text>
            </Pressable>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
              {t("roomBoard.filters.title")}
            </Text>
            <Pressable
              onPress={() => setDraft({ filters: EMPTY_FILTERS, sort: DEFAULT_SORT })}
              accessibilityRole="button"
              accessibilityLabel={t("roomBoard.filters.reset")}
              style={styles.headerBtn}
              testID="board-filter-reset"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.headerBtnText, { color: theme.primaryAction }]}>
                {t("roomBoard.filters.reset")}
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="board-filter-scroll">
            <Section title={t("roomBoard.filters.sortTitle")}>
              <View accessibilityRole="radiogroup" style={styles.stack}>
                {BOARD_SORTS.map((key) => (
                  <Choice
                    key={key}
                    kind="radio"
                    selected={sort === key}
                    label={t(`roomBoard.sort.${key}`)}
                    onPress={() => setDraft({ ...draft, sort: key })}
                    testID={`board-sort-${key}`}
                  />
                ))}
              </View>
            </Section>

            <Section title={t("roomBoard.filters.statusTitle")}>
              <View style={styles.wrap}>
                {statusKeys.map((key) => (
                  <Choice
                    key={key}
                    kind="checkbox"
                    selected={filters.statuses.includes(key)}
                    label={t(`roomBoard.filters.status.${key}`)}
                    onPress={() =>
                      setDraft({
                        ...draft,
                        filters: {
                          ...filters,
                          statuses: toggleIn(filters.statuses, key),
                        },
                      })
                    }
                    testID={`board-filter-status-${key}`}
                  />
                ))}
              </View>
            </Section>

            <Section title={t("roomBoard.filters.operationalTitle")}>
              <View style={styles.wrap}>
                {FLAG_FILTERS.map((key) => {
                  const unavailable = availability.unavailableFlags.has(key);
                  return (
                    <Choice
                      key={key}
                      kind="checkbox"
                      selected={filters.flags.includes(key)}
                      disabled={unavailable && !filters.flags.includes(key)}
                      label={t(`roomBoard.filters.flag.${key}`)}
                      hint={unavailable ? t("roomBoard.filters.noData") : undefined}
                      onPress={() =>
                        setDraft({
                          ...draft,
                          filters: {
                            ...filters,
                            flags: toggleIn(filters.flags, key),
                          },
                        })
                      }
                      testID={`board-filter-flag-${key}`}
                    />
                  );
                })}
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
                      <Choice
                        kind="radio"
                        selected={filters.building === null}
                        label={t("roomBoard.filters.allBuildings")}
                        onPress={() =>
                          setDraft({
                            ...draft,
                            filters: selectBuilding(filters, null),
                          })
                        }
                        testID="board-filter-building-all"
                      />
                      {availability.buildings.map((building) => (
                        <Choice
                          key={building}
                          kind="radio"
                          selected={filters.building === building}
                          label={building === NONE_KEY ? t("roomBoard.buildingNone") : t("roomBoard.building", { building })}
                          onPress={() =>
                            setDraft({
                              ...draft,
                              filters: selectBuilding(filters, building),
                            })
                          }
                          testID={`board-filter-building-${building}`}
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
                        <Choice
                          key={floor.key}
                          kind="checkbox"
                          selected={filters.floors.includes(floor.key)}
                          label={floorLabel(floor)}
                          onPress={() =>
                            setDraft({
                              ...draft,
                              filters: {
                                ...filters,
                                floors: toggleIn(filters.floors, floor.key),
                              },
                            })
                          }
                          testID={`board-filter-floor-${floor.key}`}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </Section>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={() => onApply(draft)}
            accessibilityRole="button"
            accessibilityLabel={t("roomBoard.filters.apply")}
            testID="board-filter-apply"
            style={({ pressed }) => [styles.apply, { backgroundColor: theme.primaryAction }, pressed && { opacity: 0.85 }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.applyText, { color: theme.onPrimary }]}>
              {t("roomBoard.filters.apply")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textPrimary }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A selectable option. Selection is a check mark AND a filled style — never colour alone. */
function Choice({
  kind,
  selected,
  label,
  hint,
  disabled,
  onPress,
  testID,
}: {
  kind: "radio" | "checkbox";
  selected: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const icon = kind === "radio" ? (selected ? "radio-button-on" : "radio-button-off") : selected ? "checkbox" : "square-outline";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={kind}
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      accessibilityState={kind === "radio" ? { selected, disabled: Boolean(disabled) } : { checked: selected, disabled: Boolean(disabled) }}
      testID={testID}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? theme.primaryAction : theme.surface,
          borderColor: selected ? theme.primaryAction : theme.border,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={selected ? theme.onPrimary : theme.textMuted} />
      <View style={styles.choiceText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.choiceLabel, { color: selected ? theme.onPrimary : theme.textPrimary }]}>
          {label}
        </Text>
        {hint ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.choiceHint, { color: theme.textMuted }]}>
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  headerBtn: {
    minHeight: MIN_TARGET,
    minWidth: 64,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  headerBtnText: { fontSize: 15, fontWeight: "700" },
  title: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 18 },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  subTitle: { fontSize: 12.5, fontWeight: "700" },
  block: { gap: 8 },
  stack: { gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: R.md,
  },
  choiceText: { flexShrink: 1 },
  choiceLabel: { fontSize: 14.5, fontWeight: "700" },
  choiceHint: { fontSize: 11.5, marginTop: 1 },
  apply: {
    marginHorizontal: 16,
    marginTop: 10,
    minHeight: 52,
    borderRadius: R.md,
    alignItems: "center",
    justifyContent: "center",
  },
  applyText: { fontSize: 16, fontWeight: "800" },
});

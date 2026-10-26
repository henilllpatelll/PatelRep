import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, findNodeHandle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import {
  CLEAN_KINDS,
  DEFAULT_QUEUE_DRAFT,
  PRIORITY_FILTERS,
  QUEUE_SORTS,
  REVIEW_KINDS,
  parseFloorKey,
  toggleIn,
  type FloorOption,
  type QueueAvailability,
  type QueueDraft,
} from "@/lib/inspections/queueView";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * Filter & Sort bottom drawer. It edits a DRAFT: the list changes only when "Show N rooms" is tapped, and closing
 * (backdrop, X, Android back) throws the draft away. The count on the button is the real result of the draft.
 */
export function InspectFilterSheet({
  visible,
  applied,
  availability,
  previewCount,
  t,
  onApply,
  onClose,
}: {
  visible: boolean;
  applied: QueueDraft;
  availability: QueueAvailability;
  /** How many rooms the draft would list (search included). */
  previewCount: (draft: QueueDraft) => number;
  t: Translate;
  onApply: (draft: QueueDraft) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<QueueDraft>(applied);
  const titleRef = useRef<Text>(null);

  // Every opening starts from what is applied; edits from a cancelled close are dropped. Not re-seeded on data
  // refreshes, which would wipe a half-made selection.
  useEffect(() => {
    if (!visible) return;
    setDraft(applied);
    const timer = setTimeout(() => {
      try {
        // Move a screen reader's focus to the sheet title. Not available on every platform (web throws).
        const handle = titleRef.current ? findNodeHandle(titleRef.current) : null;
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      } catch {
        // Focus is a nicety; the sheet works without it.
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [visible]);

  const { filters, sort } = draft;
  const count = useMemo(() => (visible ? previewCount(draft) : 0), [visible, draft, previewCount]);

  // A floor chosen earlier that no longer has rooms stays visible, so it can still be unticked.
  const floors = useMemo<FloorOption[]>(() => {
    const known = new Set(availability.floors.map((floor) => floor.key));
    const extra = filters.floors.filter((key) => !known.has(key)).map((key): FloorOption => ({ key, ...parseFloorKey(key) }));
    return [...availability.floors, ...extra];
  }, [availability.floors, filters.floors]);

  const floorLabel = (floor: FloorOption): string => {
    const level = floor.floor === null ? t("inspect.filter.floorUnknown") : t("inspect.filter.floor", { floor: floor.floor });
    return availability.multiBuilding
      ? t("inspect.filter.buildingFloor", { building: floor.building ?? t("inspect.filter.buildingNone"), floor: floor.floor ?? "—" })
      : level;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("inspect.filter.close")} testID="inspect-filter-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal testID="inspect-filter-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <Text ref={titleRef} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
              {t("inspect.filter.title")}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("inspect.filter.close")} style={styles.closeBtn} hitSlop={6} testID="inspect-filter-close">
              <Ionicons name="close" size={24} color={theme.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="inspect-filter-scroll">
            <Section title={t("inspect.filter.priorityTitle")}>
              <View style={styles.wrap}>
                <Choice kind="checkbox" selected={filters.priority.length === 0} label={t("inspect.filter.all")} onPress={() => setDraft({ ...draft, filters: { ...filters, priority: [] } })} testID="inspect-filter-priority-all" />
                {PRIORITY_FILTERS.map((key) => {
                  const unavailable = !availability.priority[key] && !filters.priority.includes(key);
                  return (
                    <Choice
                      key={key}
                      kind="checkbox"
                      selected={filters.priority.includes(key)}
                      disabled={unavailable}
                      label={t(`inspect.filter.priority.${key}`)}
                      hint={unavailable ? t("inspect.filter.noData") : undefined}
                      onPress={() => setDraft({ ...draft, filters: { ...filters, priority: toggleIn(filters.priority, key) } })}
                      testID={`inspect-filter-priority-${key}`}
                    />
                  );
                })}
              </View>
            </Section>

            <Section title={t("inspect.filter.floorTitle")}>
              <View style={styles.wrap}>
                <Choice kind="checkbox" selected={filters.floors.length === 0} label={t("inspect.filter.allFloors")} onPress={() => setDraft({ ...draft, filters: { ...filters, floors: [] } })} testID="inspect-filter-floor-all" />
                {floors.map((floor) => (
                  <Choice
                    key={floor.key}
                    kind="checkbox"
                    selected={filters.floors.includes(floor.key)}
                    label={floorLabel(floor)}
                    onPress={() => setDraft({ ...draft, filters: { ...filters, floors: toggleIn(filters.floors, floor.key) } })}
                    testID={`inspect-filter-floor-${floor.key}`}
                  />
                ))}
              </View>
            </Section>

            <Section title={t("inspect.filter.typeTitle")}>
              <View style={styles.wrap}>
                {REVIEW_KINDS.map((key) => (
                  <Choice
                    key={key}
                    kind="checkbox"
                    selected={filters.review.includes(key)}
                    label={t(`inspect.filter.review.${key}`)}
                    onPress={() => setDraft({ ...draft, filters: { ...filters, review: toggleIn(filters.review, key) } })}
                    testID={`inspect-filter-review-${key}`}
                  />
                ))}
              </View>
              <View style={styles.wrap}>
                {CLEAN_KINDS.map((key) => {
                  const unavailable = !availability.clean[key] && !filters.clean.includes(key);
                  return (
                    <Choice
                      key={key}
                      kind="checkbox"
                      selected={filters.clean.includes(key)}
                      disabled={unavailable}
                      label={t(`inspect.filter.clean.${key}`)}
                      hint={unavailable ? t("inspect.filter.noData") : undefined}
                      onPress={() => setDraft({ ...draft, filters: { ...filters, clean: toggleIn(filters.clean, key) } })}
                      testID={`inspect-filter-clean-${key}`}
                    />
                  );
                })}
              </View>
            </Section>

            <Section title={t("inspect.filter.sortTitle")}>
              <View accessibilityRole="radiogroup" style={styles.stack}>
                {QUEUE_SORTS.map((key) => (
                  <Choice key={key} kind="radio" selected={sort === key} label={t(`inspect.filter.sort.${key}`)} onPress={() => setDraft({ ...draft, sort: key })} testID={`inspect-sort-${key}`} />
                ))}
              </View>
            </Section>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={() => setDraft(DEFAULT_QUEUE_DRAFT)}
              accessibilityRole="button"
              accessibilityLabel={t("inspect.filter.reset")}
              testID="inspect-filter-reset"
              style={({ pressed }) => [styles.reset, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && { opacity: 0.85 }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.resetText, { color: theme.textPrimary }]}>
                {t("inspect.filter.reset")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onApply(draft)}
              accessibilityRole="button"
              accessibilityLabel={t("inspect.filter.show", { count })}
              testID="inspect-filter-apply"
              style={({ pressed }) => [styles.apply, { backgroundColor: theme.primaryAction }, pressed && { opacity: 0.85 }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.applyText, { color: theme.onPrimary }]}>
                {t("inspect.filter.show", { count })}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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

/** A selectable option. Selection is a check mark AND a filled style - never colour alone. */
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
        { backgroundColor: selected ? theme.primaryAction : theme.surface, borderColor: selected ? theme.primaryAction : theme.border, opacity: disabled ? 0.55 : pressed ? 0.85 : 1 },
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
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "90%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  title: { flexShrink: 1, fontSize: 20, fontWeight: "800" },
  closeBtn: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 18 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 12.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  stack: { gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TARGET, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: R.md },
  choiceText: { flexShrink: 1 },
  choiceLabel: { fontSize: 14.5, fontWeight: "700" },
  choiceHint: { fontSize: 11.5, marginTop: 1 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 10 },
  reset: { minHeight: 52, minWidth: 96, paddingHorizontal: 18, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  resetText: { fontSize: 15, fontWeight: "800" },
  apply: { flex: 1, minHeight: 52, borderRadius: R.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  applyText: { fontSize: 16, fontWeight: "800" },
});

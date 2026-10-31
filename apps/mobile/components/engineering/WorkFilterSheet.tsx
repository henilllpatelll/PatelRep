import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { WORK_ORDER_PRIORITIES, type WorkOrderCategory, type WorkOrderStatus } from "@/lib/engineering/workOrders";
import {
  EMPTY_FILTERS,
  QUEUE_SORTS,
  allowedStatuses,
  canViewTeamWork,
  dateFiltersFor,
  defaultSort,
  effectiveSort,
  hasAssignmentFilter,
  hasStatusFilter,
  type QueueAssignment,
  type QueueFilters,
  type QueueView,
} from "@/lib/engineering/workQueue";

const CATEGORIES: readonly WorkOrderCategory[] = [
  "plumbing",
  "electrical",
  "hvac",
  "furniture",
  "appliance",
  "structural",
  "safety",
  "doors_locks",
  "painting",
  "general",
];

interface Props {
  visible: boolean;
  view: QueueView;
  role: string | null | undefined;
  filters: QueueFilters;
  onApply: (filters: QueueFilters) => void;
  onClose: () => void;
}

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      style={[
        styles.chip,
        { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surface },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? theme.primary : theme.textSecondary }]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

/** Filter & Sort. Nothing applies until "Show results"; Reset clears the draft, not the screen behind it. */
export function WorkFilterSheet({ visible, view, role, filters, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<QueueFilters>(filters);
  const [floorText, setFloorText] = useState(filters.floor != null ? String(filters.floor) : "");

  useEffect(() => {
    if (visible) {
      setDraft(filters);
      setFloorText(filters.floor != null ? String(filters.floor) : "");
    }
  }, [visible, filters]);

  const set = (patch: Partial<QueueFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleStatus = (status: WorkOrderStatus) =>
    view === "done"
      ? set({ statuses: [status] })
      : set({ statuses: draft.statuses.includes(status) ? draft.statuses.filter((s) => s !== status) : [...draft.statuses, status] });

  const assignments: QueueAssignment[] = canViewTeamWork(role) ? ["any", "mine", "unassigned", "others"] : ["any", "mine", "unassigned"];
  const doneStatus = draft.statuses[0] ?? "completed";

  const apply = () => {
    const floor = floorText.trim() === "" ? null : Number.parseInt(floorText, 10);
    onApply({ ...draft, floor: floor != null && Number.isFinite(floor) ? floor : null, building: draft.building?.trim() || null });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.close")}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12 }]}
          onPress={() => undefined}
          testID="work-filter-sheet"
        >
          <Text style={[styles.title, { color: theme.textPrimary }]} accessibilityRole="header">
            {t("workQueue.filter.title")}
          </Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {hasStatusFilter(view) ? (
              <Section title={t("workQueue.filter.status")}>
                {allowedStatuses(view).map((status) => (
                  <Chip
                    key={status}
                    label={t(`workOrders.status.${status}`)}
                    selected={view === "done" ? doneStatus === status : draft.statuses.includes(status)}
                    onPress={() => toggleStatus(status)}
                    testID={`filter-status-${status}`}
                  />
                ))}
              </Section>
            ) : null}

            <Section title={t("workQueue.filter.priority")}>
              <Chip label={t("workQueue.filter.any")} selected={draft.priority == null} onPress={() => set({ priority: null })} testID="filter-priority-any" />
              {WORK_ORDER_PRIORITIES.map((priority) => (
                <Chip
                  key={priority}
                  label={t(`workQueue.priority.${priority}`)}
                  selected={draft.priority === priority}
                  onPress={() => set({ priority })}
                  testID={`filter-priority-${priority}`}
                />
              ))}
            </Section>

            <Section title={t("workQueue.filter.category")}>
              <Chip label={t("workQueue.filter.any")} selected={draft.category == null} onPress={() => set({ category: null })} />
              {CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  label={t(`workOrders.category.${category}`)}
                  selected={draft.category === category}
                  onPress={() => set({ category })}
                  testID={`filter-category-${category}`}
                />
              ))}
            </Section>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.textMuted }]} accessibilityRole="header">
                {t("workQueue.filter.location")}
              </Text>
              <View style={styles.fieldRow}>
                <TextInput
                  style={[styles.field, { borderColor: theme.border, color: theme.textPrimary }]}
                  value={floorText}
                  onChangeText={(text) => setFloorText(text.replace(/[^0-9]/g, "").slice(0, 3))}
                  placeholder={t("workQueue.filter.floor")}
                  placeholderTextColor={theme.textDisabled}
                  keyboardType="number-pad"
                  accessibilityLabel={t("workQueue.filter.floor")}
                  testID="filter-floor"
                />
                <TextInput
                  style={[styles.field, { borderColor: theme.border, color: theme.textPrimary }]}
                  value={draft.building ?? ""}
                  onChangeText={(text) => set({ building: text.slice(0, 20) })}
                  placeholder={t("workQueue.filter.building")}
                  placeholderTextColor={theme.textDisabled}
                  autoCapitalize="characters"
                  accessibilityLabel={t("workQueue.filter.building")}
                  testID="filter-building"
                />
              </View>
            </View>

            {hasAssignmentFilter(view) ? (
              <Section title={t("workQueue.filter.assignment")}>
                {assignments.map((assignment) => (
                  <Chip
                    key={assignment}
                    label={t(`workQueue.filter.assignmentOptions.${assignment}`)}
                    selected={draft.assignment === assignment}
                    onPress={() => set({ assignment })}
                    testID={`filter-assignment-${assignment}`}
                  />
                ))}
              </Section>
            ) : null}

            <Section title={t("workQueue.filter.date")}>
              <Chip label={t("workQueue.filter.any")} selected={draft.date == null} onPress={() => set({ date: null })} />
              {dateFiltersFor(view).map((date) => (
                <Chip
                  key={date}
                  label={t(`workQueue.filter.dateOptions.${date}`)}
                  selected={draft.date === date}
                  onPress={() => set({ date })}
                  testID={`filter-date-${date}`}
                />
              ))}
            </Section>

            <Section title={t("workQueue.filter.sort")}>
              {QUEUE_SORTS.map((sort) => (
                <Chip
                  key={sort}
                  label={t(`workQueue.filter.sortOptions.${sort}`)}
                  selected={effectiveSort(view, draft) === sort}
                  onPress={() => set({ sort: sort === defaultSort(view) ? null : sort })}
                  testID={`filter-sort-${sort}`}
                />
              ))}
            </Section>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={t("workQueue.filter.reset")}
              variant="ghost"
              onPress={() => {
                setDraft(EMPTY_FILTERS);
                setFloorText("");
              }}
              style={styles.footerButton}
              testID="filter-reset"
            />
            <Button label={t("workQueue.filter.show")} onPress={apply} style={styles.footerPrimary} testID="filter-apply" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 18, maxHeight: "88%" },
  title: { fontSize: 18, fontWeight: "700", paddingHorizontal: 18, marginBottom: 6 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 8 },
  section: { marginTop: 14, gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600" },
  fieldRow: { flexDirection: "row", gap: 10 },
  field: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 10 },
  footerButton: { flex: 1 },
  footerPrimary: { flex: 2 },
});

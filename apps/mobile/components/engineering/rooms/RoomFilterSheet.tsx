import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { Button } from "@/components/ui/Button";
import {
  EMPTY_ROOM_FILTERS,
  ROOM_MAINTENANCE_FILTERS,
  ROOM_OCCUPANCY_FILTERS,
  ROOM_PRIORITY_FILTERS,
  ROOM_SORTS,
  type RoomFilters,
} from "@/lib/engineering/roomModel";

interface Props {
  visible: boolean;
  filters: RoomFilters;
  /** Floors and buildings that exist in this hotel, from the server. Empty until a read succeeds. */
  floors: readonly number[];
  buildings: readonly string[];
  onApply: (filters: RoomFilters) => void;
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
      style={[styles.chip, { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surface }]}
    >
      <Text style={[styles.chipText, { color: selected ? theme.primary : theme.textSecondary }]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  const x = useV2Text();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, x.label, { color: theme.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

/** Filter & Sort. Nothing applies until "Show rooms"; Reset clears the draft, not the list behind it. */
export function RoomFilterSheet({ visible, filters, floors, buildings, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<RoomFilters>(filters);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  const set = (patch: Partial<RoomFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12 }]} onPress={() => undefined} accessible={false} onAccessibilityEscape={onClose} testID="room-filter-sheet">
          <Text style={[styles.title, { color: theme.textPrimary }]} accessibilityRole="header">
            {t("engRooms.filter.title")}
          </Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Section title={t("engRooms.filter.maintenance")}>
              <Chip label={t("engRooms.filter.all")} selected={draft.maintenance == null} onPress={() => set({ maintenance: null })} testID="room-filter-maintenance-all" />
              {ROOM_MAINTENANCE_FILTERS.map((value) => (
                <Chip key={value} label={t(`engRooms.filter.maintenanceOptions.${value}`)} selected={draft.maintenance === value} onPress={() => set({ maintenance: value })} testID={`room-filter-maintenance-${value}`} />
              ))}
            </Section>

            <Section title={t("engRooms.filter.occupancy")}>
              <Chip label={t("engRooms.filter.any")} selected={draft.occupancy == null} onPress={() => set({ occupancy: null })} testID="room-filter-occupancy-any" />
              {ROOM_OCCUPANCY_FILTERS.map((value) => (
                <Chip key={value} label={t(`engRooms.occupancy.${value}`)} selected={draft.occupancy === value} onPress={() => set({ occupancy: value })} testID={`room-filter-occupancy-${value}`} />
              ))}
            </Section>

            <Section title={t("engRooms.filter.floor")}>
              <Chip label={t("engRooms.filter.any")} selected={draft.floor == null} onPress={() => set({ floor: null })} testID="room-filter-floor-any" />
              {floors.map((floor) => (
                <Chip key={floor} label={String(floor)} selected={draft.floor === floor} onPress={() => set({ floor })} testID={`room-filter-floor-${floor}`} />
              ))}
            </Section>

            {buildings.length > 1 ? (
              <Section title={t("engRooms.filter.building")}>
                <Chip label={t("engRooms.filter.any")} selected={draft.building == null} onPress={() => set({ building: null })} testID="room-filter-building-any" />
                {buildings.map((building) => (
                  <Chip key={building} label={building} selected={draft.building === building} onPress={() => set({ building })} testID={`room-filter-building-${building}`} />
                ))}
              </Section>
            ) : null}

            <Section title={t("engRooms.filter.priority")}>
              <Chip label={t("engRooms.filter.any")} selected={draft.priority == null} onPress={() => set({ priority: null })} testID="room-filter-priority-any" />
              {ROOM_PRIORITY_FILTERS.map((value) => (
                <Chip key={value} label={t(`workQueue.priority.${value}`)} selected={draft.priority === value} onPress={() => set({ priority: value })} testID={`room-filter-priority-${value}`} />
              ))}
            </Section>
            <Text style={[styles.note, { color: theme.textMuted }]}>{t("engRooms.filter.priorityNote")}</Text>

            <Section title={t("engRooms.filter.sort")}>
              {ROOM_SORTS.map((sort) => (
                <Chip key={sort} label={t(`engRooms.filter.sortOptions.${sort}`)} selected={draft.sort === sort} onPress={() => set({ sort })} testID={`room-filter-sort-${sort}`} />
              ))}
            </Section>
          </ScrollView>

          <View style={styles.footer}>
            <Button label={t("engRooms.filter.reset")} variant="ghost" onPress={() => setDraft({ ...EMPTY_ROOM_FILTERS })} style={styles.footerButton} testID="room-filter-reset" />
            <Button label={t("engRooms.filter.show")} onPress={() => onApply(draft)} style={styles.footerPrimary} testID="room-filter-apply" />
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
  note: { fontSize: 12.5, marginTop: 6 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 10 },
  footerButton: { flex: 1 },
  footerPrimary: { flex: 2 },
});

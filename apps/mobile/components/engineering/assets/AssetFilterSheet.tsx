import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import type { AssetCategory } from "@/lib/api/assets";
import {
  ASSET_MAINTENANCE_FILTERS,
  ASSET_RELIABILITY_FILTERS,
  ASSET_SERVICE_STATUSES,
  ASSET_SORTS,
  EMPTY_ASSET_FILTERS,
  type AssetFilters,
} from "@/lib/engineering/assetModel";

interface Props {
  visible: boolean;
  filters: AssetFilters;
  /** Categories that exist in this hotel; empty while they load or if that read failed (the section then says so). */
  categories: readonly AssetCategory[];
  categoriesFailed: boolean;
  onApply: (filters: AssetFilters) => void;
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

/** Filter & Sort. Nothing applies until "Show results"; Reset clears the draft, not the list behind it. */
export function AssetFilterSheet({ visible, filters, categories, categoriesFailed, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const [draft, setDraft] = useState<AssetFilters>(filters);
  const [floorText, setFloorText] = useState(filters.floor != null ? String(filters.floor) : "");

  useEffect(() => {
    if (visible) {
      setDraft(filters);
      setFloorText(filters.floor != null ? String(filters.floor) : "");
    }
  }, [visible, filters]);

  const set = (patch: Partial<AssetFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const apply = () => {
    const floor = floorText.trim() === "" ? null : Number.parseInt(floorText, 10);
    onApply({ ...draft, floor: floor != null && Number.isFinite(floor) ? floor : null, building: draft.building?.trim() || null });
  };

  return (
    <BottomSheet
      visible={visible}
      title={t("assets.filter.title")}
      onClose={onClose}
      tall
      testID="asset-filter-sheet"
      footer={
        <View style={styles.footer}>
          <Button
            label={t("assets.filter.reset")}
            variant="ghost"
            onPress={() => {
              setDraft({ ...EMPTY_ASSET_FILTERS, quick: draft.quick });
              setFloorText("");
            }}
            style={styles.footerButton}
            testID="asset-filter-reset"
          />
          <Button label={t("assets.filter.show")} onPress={apply} style={styles.footerPrimary} testID="asset-filter-apply" />
        </View>
      }
    >
      <Section title={t("assets.filter.category")}>
        <Chip label={t("assets.filter.any")} selected={draft.categoryId == null} onPress={() => set({ categoryId: null })} testID="asset-filter-category-any" />
        {categories.map((category) => (
          <Chip
            key={category.id}
            label={category.name}
            selected={draft.categoryId === category.id}
            onPress={() => set({ categoryId: category.id })}
            testID={`asset-filter-category-${category.id}`}
          />
        ))}
      </Section>
      {categoriesFailed ? (
        <Text style={[styles.note, { color: theme.textMuted }]}>{t("assets.filter.categoriesFailed")}</Text>
      ) : null}

      <Section title={t("assets.filter.status")}>
        <Chip label={t("assets.filter.any")} selected={draft.status == null} onPress={() => set({ status: null })} testID="asset-filter-status-any" />
        {ASSET_SERVICE_STATUSES.map((status) => (
          <Chip key={status} label={t(`assets.status.${status}`)} selected={draft.status === status} onPress={() => set({ status })} testID={`asset-filter-status-${status}`} />
        ))}
      </Section>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, x.label, { color: theme.textMuted }]} accessibilityRole="header">
          {t("assets.filter.location")}
        </Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={[styles.field, { borderColor: theme.border, color: theme.textPrimary }]}
            value={floorText}
            onChangeText={(text) => setFloorText(text.replace(/[^0-9]/g, "").slice(0, 3))}
            placeholder={t("assets.filter.floor")}
            placeholderTextColor={theme.textDisabled}
            keyboardType="number-pad"
            accessibilityLabel={t("assets.filter.floor")}
            testID="asset-filter-floor"
          />
          <TextInput
            style={[styles.field, { borderColor: theme.border, color: theme.textPrimary }]}
            value={draft.building ?? ""}
            onChangeText={(text) => set({ building: text.slice(0, 20) })}
            placeholder={t("assets.filter.building")}
            placeholderTextColor={theme.textDisabled}
            autoCapitalize="characters"
            accessibilityLabel={t("assets.filter.building")}
            testID="asset-filter-building"
          />
        </View>
      </View>

      <Section title={t("assets.filter.maintenance")}>
        <Chip label={t("assets.filter.any")} selected={draft.maintenance == null} onPress={() => set({ maintenance: null })} testID="asset-filter-maintenance-any" />
        {ASSET_MAINTENANCE_FILTERS.map((value) => (
          <Chip
            key={value}
            label={t(`assets.filter.maintenanceOptions.${value}`)}
            selected={draft.maintenance === value}
            onPress={() => set({ maintenance: value })}
            testID={`asset-filter-maintenance-${value}`}
          />
        ))}
      </Section>

      <Section title={t("assets.filter.reliability")}>
        <Chip label={t("assets.filter.any")} selected={draft.reliability == null} onPress={() => set({ reliability: null })} testID="asset-filter-reliability-any" />
        {ASSET_RELIABILITY_FILTERS.map((value) => (
          <Chip
            key={value}
            label={t(`assets.filter.reliabilityOptions.${value}`)}
            selected={draft.reliability === value}
            onPress={() => set({ reliability: value })}
            testID={`asset-filter-reliability-${value}`}
          />
        ))}
      </Section>

      <Section title={t("assets.filter.sort")}>
        {ASSET_SORTS.map((sort) => (
          <Chip key={sort} label={t(`assets.filter.sortOptions.${sort}`)} selected={draft.sort === sort} onPress={() => set({ sort })} testID={`asset-filter-sort-${sort}`} />
        ))}
      </Section>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 14, gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600" },
  note: { fontSize: 12.5, marginTop: 6 },
  fieldRow: { flexDirection: "row", gap: 10 },
  field: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 10 },
  footerButton: { flex: 1 },
  footerPrimary: { flex: 2 },
});

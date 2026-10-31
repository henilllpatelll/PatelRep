import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import type { QueueView } from "@/lib/engineering/workQueue";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface Props {
  views: QueueView[];
  view: QueueView;
  onView: (view: QueueView) => void;
  searchText: string;
  onSearchText: (text: string) => void;
  filterCount: number;
  onOpenFilters: () => void;
  chips: FilterChip[];
  onNew: () => void;
}

/** Title, search, the five queue views and the active-filter chips. Stays put while the list below scrolls. */
export function WorkQueueHeader({ views, view, onView, searchText, onSearchText, filterCount, onOpenFilters, chips, onNew }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ backgroundColor: theme.background, paddingBottom: 4 }}>
      <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: theme.shell.ink }]} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
              {t("workQueue.title")}
            </Text>
            <Text style={[styles.subtitle, { color: theme.shell.ink2 }]} maxFontSizeMultiplier={1.3}>
              {t("workQueue.subtitle")}
            </Text>
          </View>
          <Pressable
            onPress={onNew}
            style={[styles.newButton, { backgroundColor: theme.primaryAction }]}
            accessibilityRole="button"
            accessibilityLabel={t("workQueue.newA11y")}
            testID="wo-new"
          >
            <Ionicons name="add" size={18} color={theme.shell.ink} />
            <Text style={[styles.newText, { color: theme.shell.ink }]} maxFontSizeMultiplier={1.3}>
              {t("workQueue.new")}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="search-outline" size={17} color={theme.textDisabled} />
          <TextInput
            style={[styles.searchInput, { color: theme.textPrimary }]}
            value={searchText}
            onChangeText={onSearchText}
            placeholder={t("workQueue.searchPlaceholder")}
            placeholderTextColor={theme.textDisabled}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel={t("workQueue.searchPlaceholder")}
            testID="wo-search"
          />
          {searchText ? (
            <Pressable
              onPress={() => onSearchText("")}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t("workQueue.clearSearch")}
              testID="wo-search-clear"
            >
              <Ionicons name="close-circle" size={18} color={theme.textDisabled} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onOpenFilters}
          style={[styles.filterButton, { backgroundColor: filterCount > 0 ? theme.primarySoft : theme.surface, borderColor: filterCount > 0 ? theme.primaryAction : theme.border }]}
          accessibilityRole="button"
          accessibilityLabel={filterCount > 0 ? t("workQueue.filterA11yActive", { count: filterCount }) : t("workQueue.filterA11y")}
          testID="wo-filter-open"
        >
          <Ionicons name="options-outline" size={20} color={filterCount > 0 ? theme.primary : theme.textSecondary} />
          {filterCount > 0 ? (
            <View style={[styles.filterBadge, { backgroundColor: theme.primaryAction }]}>
              <Text style={[styles.filterBadgeText, { color: theme.shell.ink }]}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        accessibilityRole="tablist"
        testID="wo-views"
      >
        {views.map((item) => {
          const selected = item === view;
          return (
            <Pressable
              key={item}
              onPress={() => onView(item)}
              style={[styles.tab, { backgroundColor: selected ? theme.primaryAction : theme.surface, borderColor: selected ? theme.primaryAction : theme.border }]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              testID={`wo-view-${item}`}
            >
              <Text style={[styles.tabText, { color: selected ? theme.shell.ink : theme.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {t(`workQueue.views.${item}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {chips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} testID="wo-filter-chips">
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              onPress={chip.onRemove}
              style={[styles.chip, { backgroundColor: theme.primarySoft, borderColor: theme.primaryAction }]}
              accessibilityRole="button"
              accessibilityLabel={t("workQueue.removeFilter", { filter: chip.label })}
              testID={`wo-chip-${chip.key}`}
            >
              <Text style={[styles.chipText, { color: theme.primary }]} maxFontSizeMultiplier={1.3}>
                {chip.label}
              </Text>
              <Ionicons name="close" size={14} color={theme.primary} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  titleBlock: { flex: 1 },
  title: { fontSize: 27, lineHeight: 32, fontWeight: "700" },
  subtitle: { fontSize: 14, marginTop: 4 },
  newButton: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, marginTop: 2 },
  newText: { fontSize: 14, fontWeight: "700" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, marginTop: 14 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderRadius: R.md },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  filterButton: { width: 48, height: 48, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  filterBadge: { position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  filterBadgeText: { fontSize: 11, fontWeight: "800" },
  tabs: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 8 },
  tab: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 14, fontWeight: "700" },
  chips: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: "600" },
});

import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { WorkViewTabs } from "@/components/engineering/work/WorkViewTabs";
import type { QueueView } from "@/lib/engineering/workQueue";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface Props {
  view: QueueView;
  /** Tabs, the shortcuts beneath them, and where Back returns to (see lib/engineering/workNavigation). */
  primary: QueueView[];
  secondary: QueueView[];
  home: QueueView;
  onView: (view: QueueView) => void;
  /** Can assign work (chief engineer / GM): Available then reads as "needs an owner", not "you can take". */
  manager: boolean;
  searchText: string;
  onSearchText: (text: string) => void;
  filterCount: number;
  onOpenFilters: () => void;
  chips: FilterChip[];
  onNew: () => void;
  /** The My Work tiles, when this view has them. */
  summary?: ReactNode;
}

/** Which queue this is, search and filters, the view tabs, the optional summary tiles and the active-filter chips. */
export function WorkQueueHeader({
  view,
  primary,
  secondary,
  home,
  onView,
  manager,
  searchText,
  onSearchText,
  filterCount,
  onOpenFilters,
  chips,
  onNew,
  summary,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ backgroundColor: theme.background, paddingBottom: 14 }}>
      <View style={[styles.hero, { paddingTop: insets.top + 10, backgroundColor: theme.shell.bg }]}>
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={[styles.eyebrow, x.label, { color: theme.shell.ink2 }]} maxFontSizeMultiplier={1.3}>
              {t("workQueue.eyebrow")}
            </Text>
            <Text style={[styles.title, { color: theme.shell.ink }]} accessibilityRole="header" maxFontSizeMultiplier={1.3} testID="wo-title">
              {t(`workQueue.viewTitles.${view}`)}
            </Text>
            <Text style={[styles.subtitle, { color: theme.shell.ink2 }]} maxFontSizeMultiplier={1.3} testID="wo-subtitle">
              {t(view === "available" && manager ? "workQueue.viewSubtitles.availableManager" : `workQueue.viewSubtitles.${view}`)}
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

      <WorkViewTabs view={view} primary={primary} secondary={secondary} home={home} onView={onView} />

      {summary}

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

      {view === "done" ? (
        <Text style={[styles.note, { color: theme.textMuted }]} maxFontSizeMultiplier={1.3} testID="wo-history-note">
          {t("workQueue.historyNote")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 18, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  titleBlock: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 24, lineHeight: 29, fontWeight: "700", marginTop: 2 },
  subtitle: { fontSize: 13.5, marginTop: 2 },
  newButton: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, marginTop: 2 },
  newText: { fontSize: 14, fontWeight: "700" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, marginTop: 12 },
  searchBox: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderRadius: R.md },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  filterButton: { width: 48, height: 48, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  filterBadge: { position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  filterBadgeText: { fontSize: 11, fontWeight: "800" },
  chips: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: "600" },
  note: { fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingTop: 10 },
});

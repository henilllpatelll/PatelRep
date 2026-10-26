import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * Room-number search and the Filter & Sort entry. Filters as the person types (no request, no search button).
 * The filter button only exists on the list it applies to, so a filter never silently reshapes another list.
 */
export function InspectSearchBar({
  value,
  onChangeText,
  onClear,
  onOpenFilters,
  activeCount,
  showFilters,
  t,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  onOpenFilters: () => void;
  /** Applied filters plus a non-default sort; drives the badge. */
  activeCount: number;
  showFilters: boolean;
  t: Translate;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row} testID="inspect-search-bar">
      <View style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="search" size={18} color={theme.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={t("inspect.search.placeholder")}
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.textPrimary }]}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          returnKeyType="search"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
          accessibilityLabel={t("inspect.search.label")}
          testID="inspect-search"
        />
        {value.length > 0 ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel={t("inspect.search.clear")}
            hitSlop={8}
            style={styles.clear}
            testID="inspect-search-clear"
          >
            <Ionicons name="close-circle" size={20} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {showFilters ? (
        <Pressable
          onPress={onOpenFilters}
          accessibilityRole="button"
          accessibilityLabel={activeCount > 0 ? t("inspect.search.openFiltersActive", { active: activeCount }) : t("inspect.search.openFilters")}
          testID="inspect-filter-button"
          style={({ pressed }) => [
            styles.filter,
            { backgroundColor: activeCount > 0 ? theme.primaryAction : theme.surface, borderColor: activeCount > 0 ? theme.primaryAction : theme.border },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="options-outline" size={22} color={activeCount > 0 ? theme.onPrimary : theme.textPrimary} />
          {activeCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: theme.onPrimary }]} testID="inspect-filter-badge">
              <Text maxFontSizeMultiplier={1.2} style={[styles.badgeText, { color: theme.primaryAction }]}>
                {activeCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 6 },
  field: { flex: 1, minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: R.md },
  input: { flex: 1, minHeight: MIN_TARGET - 4, fontSize: 16, paddingVertical: 0 },
  clear: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  filter: { width: MIN_TARGET, height: MIN_TARGET, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 11, fontWeight: "800" },
});

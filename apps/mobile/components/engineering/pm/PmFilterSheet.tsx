import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { DEFAULT_PM_FILTERS, type PmFilterState, type PmFrequency, type PmSort } from "@/lib/engineering/pmFilters";
import type { PmDueState } from "@/lib/engineering/pmSchedules";

interface Props {
  visible: boolean;
  filters: PmFilterState;
  categories: readonly string[];
  onApply: (filters: PmFilterState) => void;
  onClose: () => void;
}

const STATES: readonly PmDueState[] = ["overdue", "due_today", "due_soon", "upcoming"];
const FREQUENCIES: readonly PmFrequency[] = ["daily", "weekly", "monthly", "quarterly", "annual", "custom"];
const SORTS: readonly PmSort[] = ["due_soonest", "most_overdue", "equipment"];

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      style={[styles.chip, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.groupTitle, { color: theme.textMuted }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Filter & Sort. Nothing applies until "Show results"; Reset clears the draft inside the sheet only. */
export function PmFilterSheet({ visible, filters, categories, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PmFilterState>(filters);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  const stateLabel = (s: PmDueState) =>
    s === "overdue" ? t("pmSchedules.overdue") : s === "due_today" ? t("pmSchedules.dueToday") : s === "due_soon" ? t("pmSchedules.dueSoon") : t("pmSchedules.upcoming");

  return (
    <BottomSheet
      visible={visible}
      title={t("pm.filter.title")}
      onClose={onClose}
      tall
      testID="pm-filter-sheet"
      footer={
        <View style={styles.footer}>
          <Button label={t("pm.filter.reset")} variant="ghost" onPress={() => setDraft({ ...DEFAULT_PM_FILTERS, query: draft.query })} testID="pm-filter-reset" />
          <Button label={t("pm.filter.apply")} onPress={() => onApply(draft)} testID="pm-filter-apply" style={styles.apply} />
        </View>
      }
    >
      <Group title={t("pm.filter.status")}>
        {STATES.map((s) => (
          <Chip key={s} label={stateLabel(s)} selected={draft.states.includes(s)} onPress={() => setDraft({ ...draft, states: toggle(draft.states, s) })} testID={`pm-filter-state-${s}`} />
        ))}
      </Group>
      <Group title={t("pm.filter.frequency")}>
        {FREQUENCIES.map((f) => (
          <Chip
            key={f}
            label={t(`pmSchedules.interval.${f}`)}
            selected={draft.frequencies.includes(f)}
            onPress={() => setDraft({ ...draft, frequencies: toggle(draft.frequencies, f) })}
            testID={`pm-filter-frequency-${f}`}
          />
        ))}
      </Group>
      {categories.length > 0 ? (
        <Group title={t("pm.filter.category")}>
          <Chip label={t("pm.filter.any")} selected={draft.category == null} onPress={() => setDraft({ ...draft, category: null })} testID="pm-filter-category-any" />
          {categories.map((c) => (
            <Chip key={c} label={c} selected={draft.category === c} onPress={() => setDraft({ ...draft, category: c })} testID={`pm-filter-category-${c}`} />
          ))}
        </Group>
      ) : null}
      <Group title={t("pm.filter.sort")}>
        {SORTS.map((s) => (
          <Chip key={s} label={t(`pm.sort.${s}`)} selected={draft.sort === s} onPress={() => setDraft({ ...draft, sort: s })} testID={`pm-filter-sort-${s}`} />
        ))}
      </Group>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8, marginBottom: 16 },
  groupTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600" },
  footer: { flexDirection: "row", gap: 10, alignItems: "center" },
  apply: { flex: 1 },
});

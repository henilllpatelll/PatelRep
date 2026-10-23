import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Body, Notice, ToggleChip } from "@/components/supervisor/assignments/BulkParts";
import { type BulkScope, type ScopeGroup } from "@/lib/housekeeping/assignmentBulk";
import { scopeLabel } from "@/lib/housekeeping/assignmentBulkView";
import type { BulkSelectionController } from "@/lib/housekeeping/useBulkSelection";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── The selection bar ─────────────────────────────────────────────────────
   Fixed above the list while selection mode is on: cancel, the counts, "Select all" and one-tap floor / building
   shortcuts. Every shortcut says exactly which rooms it takes: "Select all" means the ELIGIBLE rooms matching the
   current search and filters; a floor or building means the eligible rooms there across the hotel. Nothing here
   selects a room that cannot be assigned. */

export function BulkSelectionBar({ selection, topInset, t }: { selection: BulkSelectionController; topInset: number; t: Translate }) {
  const theme = useTheme();
  const { summary, blockedVisible, matching, floors, buildings, notice, limit } = selection;
  const counts = [t("assignments.v2.bulk.selectedCount", { count: summary.selectedCount }), blockedVisible > 0 ? t("assignments.v2.bulk.blockedCount", { count: blockedVisible }) : null].filter(Boolean).join(" · ");
  const groups: ScopeGroup[] = [...floors, ...buildings];
  const noticeText = notice?.kind === "refused" ? (notice.reason === "limit" ? t("assignments.v2.bulk.notice.limit", { max: limit }) : t("assignments.v2.bulk.notice.notSelectable", { room: notice.roomNumber })) : notice?.kind === "truncated" ? t("assignments.v2.bulk.notice.truncated", { max: limit }) : null;

  return (
    <View style={[styles.bar, { paddingTop: topInset + 6, backgroundColor: theme.background, borderBottomColor: theme.border }]} testID="bulk-bar">
      <View style={styles.row}>
        <Pressable onPress={selection.stop} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.cancel")} hitSlop={6} style={[styles.icon, { backgroundColor: theme.surfaceSubtle }]} testID="bulk-cancel">
          <Ionicons name="close" size={22} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {t("assignments.v2.bulk.title")}
        </Text>
        <Pressable
          onPress={selection.selectAllMatching}
          disabled={matching === 0}
          accessibilityRole="button"
          accessibilityLabel={t("assignments.v2.bulk.selectAll")}
          accessibilityHint={t("assignments.v2.bulk.selectAllHint", { count: matching })}
          accessibilityState={{ disabled: matching === 0 }}
          style={[styles.selectAll, matching === 0 && { opacity: 0.45 }]}
          testID="bulk-select-all"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.selectAllText, { color: theme.primaryAction }]}>
            {t("assignments.v2.bulk.selectAll")}
          </Text>
        </Pressable>
      </View>

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={[styles.counts, { color: theme.textSecondary }]} testID="bulk-counts">
        {counts}
      </Text>

      {groups.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled" testID="bulk-scopes">
          {groups.map((group) => (
            <ScopeChip key={group.id} group={group} selection={selection} t={t} />
          ))}
        </ScrollView>
      ) : null}

      {noticeText ? (
        <Notice tone="alert" icon="alert-circle-outline" live testID="bulk-notice">
          {noticeText}
        </Notice>
      ) : null}

      {summary.invalid.length > 0 ? (
        <View style={styles.invalid} testID="bulk-invalid">
          <Notice tone="alert" icon="alert-circle-outline" live>
            {t("assignments.v2.bulk.invalid.title", { count: summary.invalid.length })} {t("assignments.v2.bulk.invalid.body")}
          </Notice>
          <Pressable onPress={selection.removeInvalid} accessibilityRole="button" style={styles.invalidAction} testID="bulk-remove-invalid">
            <Body tone="alert" strong>
              {t("assignments.v2.bulk.invalid.remove")}
            </Body>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ScopeChip({ group, selection, t }: { group: ScopeGroup; selection: BulkSelectionController; t: Translate }) {
  const scope: BulkScope = group.scope;
  const state = selection.stateOfScope(scope);
  const name = scopeLabel(group, t);
  return (
    <ToggleChip
      label={t("assignments.v2.bulk.scope.chip", { name, count: group.eligible })}
      state={state}
      onPress={() => selection.toggleScope(scope)}
      a11yLabel={t("assignments.v2.bulk.scope.a11y", { name, count: group.eligible })}
      a11yHint={t(state === "all" ? "assignments.v2.bulk.scope.hintClear" : "assignments.v2.bulk.scope.hintSelect", { name })}
      testID={`bulk-scope-${group.id}`}
    />
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800" },
  selectAll: { minHeight: MIN_TARGET, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  selectAllText: { fontSize: 15, fontWeight: "800" },
  counts: { fontSize: 14, fontWeight: "700" },
  chips: { gap: 8, paddingRight: 8 },
  invalid: { gap: 2 },
  invalidAction: { minHeight: MIN_TARGET, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 4 },
});

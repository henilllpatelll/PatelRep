import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { TemplateFormSheet, type DepartmentOption } from "@/components/scheduling/TemplateFormSheet";
import { ScheduleEmptyCard } from "@/components/scheduling/ScheduleStates";
import { Button } from "@/components/ui/Button";
import type { ShiftTemplate } from "@/lib/api/schedulingManage";
import { fetchTeamSchedule } from "@/lib/api/schedulingTeam";
import { durationText } from "@/lib/scheduling/shiftText";
import { templateClock } from "@/lib/scheduling/shiftForm";
import { formatWallClock } from "@/lib/scheduling/teamScheduleDates";
import { departmentLabel } from "@/lib/scheduling/teamScheduleText";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { useTemplates } from "@/lib/scheduling/useTemplates";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Shift templates ───────────────────────────────────────────────────────
   The hotel's reusable shift patterns, read from the server. A template is only a pattern for NEW shifts; editing or
   archiving one never changes a shift already scheduled. Nothing is deleted: removing a template archives it. */

type Editing = { template: ShiftTemplate | null } | null;

export function TemplatesScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((state) => state.isOnline);
  const { today, zone } = useHotelToday();
  const language = i18n.language;
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const { state, reload } = useTemplates({ includeArchived: showArchived });

  // The supervisor's departments, from the same scoped read the schedule uses (a template belongs to a department).
  useEffect(() => {
    let live = true;
    fetchTeamSchedule({ dateFrom: today }).then(
      (schedule) => {
        if (!live) return;
        const seen = new Map<string, string>();
        for (const person of schedule.people) if (person.departmentId && person.departmentCode) seen.set(person.departmentId, person.departmentCode);
        setDepartments([...seen.entries()].map(([id, code]) => ({ id, code })));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [today]);

  const codeOf = useMemo(() => new Map(departments.map((d) => [d.id, d.code])), [departments]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);
  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/team-schedule" as never);
  }, []);

  const list = state.templates ?? [];
  const sorted = useMemo(() => [...list].sort((a, b) => Number(a.archived) - Number(b.archived) || Number(b.isActive) - Number(a.isActive) || (templateClock(a.startTime)?.minutes ?? 0) - (templateClock(b.startTime)?.minutes ?? 0) || a.name.localeCompare(b.name)), [list]);

  const renderItem = ({ item }: { item: ShiftTemplate }) => {
    const start = templateClock(item.startTime);
    const end = templateClock(item.endTime);
    const code = item.departmentId ? codeOf.get(item.departmentId) : null;
    const status = item.archived ? "archived" : item.isActive ? "active" : "inactive";
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={`template-${item.id}`}>
        <View style={styles.cardText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={2}>
            {item.name}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
            {t("teamSchedule.window", { start: formatWallClock(today, item.startTime, "", zone, language), end: formatWallClock(today, item.endTime, "", zone, language) })}
            {start && end ? ` · ${durationText(start, end, t)}` : ""}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textMuted }]}>
            {[code ? departmentLabel(code, t) : null, t(`teamSchedule.manage.templates.status.${status}`)].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Pressable
          onPress={() => setEditing({ template: item })}
          disabled={!isOnline}
          accessibilityRole="button"
          accessibilityLabel={t("teamSchedule.manage.templates.edit", { name: item.name })}
          accessibilityState={{ disabled: !isOnline }}
          testID={`template-edit-${item.id}`}
          style={({ pressed }) => [styles.edit, { borderColor: theme.primaryLine, backgroundColor: theme.surface }, !isOnline && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="create-outline" size={20} color={theme.primaryAction} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="templates-screen">
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")} testID="templates-back" style={[styles.back, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}>
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {t("teamSchedule.manage.templates.title")}
        </Text>
      </View>

      {state.status === "loading" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: theme.textMuted }]} testID="templates-loading">
          {t("teamSchedule.manage.templates.loading")}
        </Text>
      ) : state.status === "failed" ? (
        <View style={styles.status} testID="templates-error">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
            {t("teamSchedule.manage.templates.loadFailed")}
          </Text>
          <Button label={t("teamSchedule.retry")} variant="secondary" onPress={() => void reload()} testID="templates-retry" />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primaryAction} />}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {!isOnline ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="templates-offline">{t("teamSchedule.manage.offline")}</Text> : null}
              {state.error ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="templates-stale">{t("teamSchedule.manage.templates.refreshFailed")}</Text> : null}
              {state.unreadable > 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>{t("teamSchedule.manage.templates.unreadable", { count: state.unreadable })}</Text> : null}
              <Button label={t("teamSchedule.manage.templates.new")} icon="add" onPress={() => setEditing({ template: null })} disabled={!isOnline} testID="templates-new" />
              <View style={styles.switchRow}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.switchLabel, { color: theme.textPrimary }]}>
                  {t("teamSchedule.manage.templates.showArchived")}
                </Text>
                <Switch value={showArchived} onValueChange={setShowArchived} accessibilityLabel={t("teamSchedule.manage.templates.showArchived")} testID="templates-show-archived" />
              </View>
            </View>
          }
          ListEmptyComponent={<ScheduleEmptyCard title={t("teamSchedule.manage.templates.emptyTitle")} body={t("teamSchedule.manage.templates.emptyBody")} testID="templates-empty" />}
          testID="templates-list"
        />
      )}

      {editing ? <TemplateFormSheet key={editing.template?.id ?? "new"} template={editing.template} departments={departments} isOnline={isOnline} onChanged={() => void reload()} onClose={() => setEditing(null)} t={t} /> : null}
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  back: { width: MIN_TARGET, height: MIN_TARGET, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 22, fontWeight: "800" },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  listHeader: { gap: 12, paddingBottom: 12 },
  status: { padding: 24, gap: 12, fontSize: 15 },
  card: { borderWidth: 1, borderRadius: R.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 17, fontWeight: "800" },
  sub: { fontSize: 14, lineHeight: 19 },
  edit: { width: MIN_TARGET, height: MIN_TARGET, borderWidth: 1, borderRadius: R.md, alignItems: "center", justifyContent: "center" },
  separator: { height: 10 },
  switchRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  switchLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
});

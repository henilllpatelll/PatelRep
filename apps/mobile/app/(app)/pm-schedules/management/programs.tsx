import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { ManagementHeader } from "@/components/engineering/pm/management/ManagementChrome";
import { AssignInspectionSheet, type AssignTarget } from "@/components/engineering/pm/management/AssignInspectionSheet";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { listPmPrograms, type PmProgram, type ProgramQuery } from "@/lib/api/pmManagement";
import { classifyLoadFailure, resolveLoadState, type LoadFailure } from "@/lib/engineering/loadState";
import { canManagePmSchedules } from "@/lib/engineering/roles";
import { pmScheduleRoute, PM_LIST_ROUTE } from "@/lib/engineering/routes";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

type Filter = "all" | "overdue" | "unassigned" | "checklist";
const FILTERS: readonly Filter[] = ["all", "overdue", "unassigned", "checklist"];
const PAGE = 25;

function queryFor(filter: Filter, text: string, assigneeId: string | null): ProgramQuery {
  return {
    q: text,
    overdueOnly: filter === "overdue",
    unassignedOnly: filter === "unassigned",
    missingChecklist: filter === "checklist",
    assigneeId,
    limit: PAGE,
  };
}

export default function PmProgramsScreen() {
  const params = useLocalSearchParams<{ filter?: string; assignee?: string; assigneeName?: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const timezone = useAppStore((s) => s.hotelTimezone);
  const role = user?.effective_role ?? user?.role;
  const allowed = canManagePmSchedules(role);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;

  const [filter, setFilter] = useState<Filter>(() => (FILTERS as readonly string[]).includes(params.filter ?? "") ? (params.filter as Filter) : "all");
  const [text, setText] = useState("");
  const [assigneeId] = useState<string | null>(params.assignee ?? null);
  const [rows, setRows] = useState<PmProgram[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const ticket = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const mine = ++ticket.current;
      offset === 0 ? setLoading(true) : setLoadingMore(true);
      try {
        const page = await listPmPrograms({ ...queryFor(filter, text, assigneeId), offset });
        if (mine !== ticket.current) return;
        setRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
        setTotal(page.total);
        setHasMore(page.hasMore);
        setFailure(null);
      } catch (err) {
        if (mine === ticket.current) setFailure(classifyLoadFailure(err));
      } finally {
        if (mine === ticket.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filter, text, assigneeId],
  );

  // The query is server-side; a short pause keeps typing from firing a request per keystroke.
  useEffect(() => {
    if (!allowed) return;
    setRows([]);
    const handle = setTimeout(() => void load(0), text ? 250 : 0);
    return () => clearTimeout(handle);
  }, [load, allowed, scope, text]);

  const state = resolveLoadState({ loading: loading && rows.length === 0, failure: allowed ? failure : "forbidden", count: rows.length, offline: !isOnline && rows.length === 0 });
  const day = (iso: string | null | undefined) => (iso ? formatDayYear(iso, timezone, i18n.language) : null);

  const openAssign = (p: PmProgram) =>
    setTarget({
      id: p.id,
      name: p.name,
      assetName: p.assets?.name ?? null,
      location: p.assets?.location_text ?? null,
      dueAt: p.next_due_at ?? null,
      estimatedMinutes: p.estimated_minutes ?? null,
      assigneeId: p.effective_assigned_to,
      assigneeName: p.assignee_name,
      rowVersion: p.row_version ?? 1,
    });

  const renderItem = ({ item: p }: { item: PmProgram }) => {
    const issue = p.checklist_issue ? t(`pmMgmt.programs.checklist.${p.checklist?.state}`) : p.checklist?.state === "unassigned" ? t("pmMgmt.programs.checklist.unassigned") : null;
    return (
      <Card style={styles.card}>
        <Pressable onPress={() => router.push((pmScheduleRoute(p.id) ?? PM_LIST_ROUTE) as never)} accessibilityRole="button" style={styles.cardMain} testID={`pm-program-${p.id}`}>
          <View style={styles.cardTop}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={2}>
              {p.name}
            </Text>
            {p.is_overdue ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pill, { color: theme.status.dirty, backgroundColor: theme.status.dirtySoft }]}>
                {t("pmMgmt.programs.overdue")}
              </Text>
            ) : null}
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={2}>
            {[p.assets?.name, p.assets?.location_text].filter(Boolean).join(" · ")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
            {[day(p.next_due_at) ? t("pmMgmt.programs.due", { date: day(p.next_due_at) }) : null, t(`pmSchedules.interval.${p.interval_type}`, { defaultValue: p.interval_type })].filter(Boolean).join(" · ")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: p.effective_assigned_to ? theme.textSecondary : theme.status.pickup }]} testID={`pm-program-assignee-${p.id}`}>
            {p.effective_assigned_to ? t("pmMgmt.programs.assignedTo", { name: p.assignee_name ?? t("pmMgmt.assign.unknownPerson") }) : p.assignment_lapsed ? t("pmMgmt.programs.lapsed") : t("pmMgmt.programs.unassigned")}
          </Text>
          {issue ? (
            <View style={styles.issue}>
              <Ionicons name="alert-circle-outline" size={16} color={p.checklist_issue ? theme.status.dirty : theme.textMuted} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: p.checklist_issue ? theme.status.dirty : theme.textMuted, flex: 1 }]} testID={`pm-program-checklist-${p.id}`}>
                {issue}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Button label={p.effective_assigned_to ? t("pmMgmt.programs.reassign") : t("pmMgmt.programs.assign")} variant="secondary" onPress={() => openAssign(p)} disabled={!isOnline || !p.is_active} testID={`pm-program-assign-${p.id}`} />
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ManagementHeader title={t("pmMgmt.programs.title")} subtitle={params.assigneeName ? t("pmMgmt.programs.forTechnician", { name: params.assigneeName }) : t("pmMgmt.programs.subtitle")} testID="pm-programs" />
      <View style={styles.tools}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t("pmMgmt.programs.search")}
          placeholderTextColor={theme.textMuted}
          accessibilityLabel={t("pmMgmt.programs.search")}
          autoCorrect={false}
          style={[styles.search, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
          testID="pm-programs-search"
        />
        <View style={styles.chips} accessibilityRole="radiogroup">
          {FILTERS.map((key) => (
            <Pressable key={key} onPress={() => setFilter(key)} accessibilityRole="radio" accessibilityState={{ selected: filter === key }} testID={`pm-programs-filter-${key}`}
              style={[styles.chip, { backgroundColor: filter === key ? theme.primarySoft : theme.surfaceSubtle, borderColor: filter === key ? theme.primaryLine : theme.border }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: filter === key ? theme.primaryAction : theme.textPrimary }]}>{t(`pmMgmt.programs.filter.${key}`)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {state.status !== "ready" ? (
        <EngineeringState status={state.status} onRetry={() => void load(0)} emptyIcon="clipboard-outline" emptyTitle={t("pmMgmt.programs.empty")} emptyBody={t("pmMgmt.programs.emptyBody")} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          ListHeaderComponent={<Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]} testID="pm-programs-count">{t("pmMgmt.programs.shown", { shown: rows.length, total })}</Text>}
          ListFooterComponent={hasMore ? <Button label={t("pmMgmt.programs.more")} variant="ghost" onPress={() => void load(rows.length)} loading={loadingMore} testID="pm-programs-more" /> : undefined}
        />
      )}

      <AssignInspectionSheet
        visible={target != null}
        target={target}
        timezone={timezone}
        language={i18n.language}
        isOnline={isOnline}
        onClose={() => setTarget(null)}
        onAssigned={(_program, action) => {
          toast.success(t(`pmMgmt.assign.done.${action}`));
          void load(0);
        }}
        onNeedsRefresh={() => void load(0)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tools: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  search: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, justifyContent: "center" },
  chipText: { fontSize: 13, fontWeight: "600" },
  list: { padding: 16, gap: 10 },
  count: { fontSize: 12, marginBottom: 4 },
  card: { padding: 14, gap: 10 },
  cardMain: { gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "700" },
  pill: { fontSize: 11, fontWeight: "700", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
  sub: { fontSize: 13, lineHeight: 18 },
  issue: { flexDirection: "row", alignItems: "center", gap: 6 },
});

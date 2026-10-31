import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeSheetHost, useHomeSheet, type HomeSheetGo } from "@/components/home/HomeSheetHost";
import { LinkButton, MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Button } from "@/components/ui/Button";
import { useAssistantOptional } from "@/lib/ai/AssistantProvider";
import { isAssistantRole } from "@/lib/ai/fab";
import { StateBlock } from "@/components/ui/StateBlock";
import { attentionWhyLines, type WhyLine } from "@/lib/housekeeping/attentionWhy";
import {
  attentionAction,
  buildAttentionCenter,
  effectiveFilter,
  itemsForFilter,
  type AttentionCenterItem,
  type AttentionFilter,
} from "@/lib/housekeeping/homeAttention";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import type { AttentionGroup } from "@/lib/housekeeping/homeState";
import { describeAttentionRow, describeSync } from "@/lib/housekeeping/homeText";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";
import { useHomeBridge } from "@/stores/homeBridgeStore";

const ICON: Record<AttentionGroup, keyof typeof Ionicons.glyphMap> = {
  critical: "alert-circle",
  actionable: "construct-outline",
  message: "chatbubble-ellipses-outline",
  restricted: "lock-closed-outline",
  info: "information-circle-outline",
};

/**
 * The full "Needs your attention" list. It reads the model Home already built
 * (published through the home bridge), so the two screens can never disagree
 * and nothing is fetched or polled twice. Filters partition the real items;
 * every tap goes to the existing room workflow or one of the Home drawers.
 */
export function AttentionCenterScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, isOnline } = useAppStore();
  const scope = user ? `${user.tenant_id}:${user.id}` : null;
  const bridge = useHomeBridge();
  const model = bridge.scope === scope ? bridge.model : null;
  const sheets = useHomeSheet();
  const assistant = useAssistantOptional();
  const role = user?.effective_role ?? user?.role;
  const [filter, setFilter] = useState<AttentionFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const language: "en" | "es" = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("es") ? "es" : "en";
  const ctx = useMemo(() => ({ language, timeZone: model?.timeZone ?? null }), [language, model?.timeZone]);

  const center = useMemo(() => (model ? buildAttentionCenter(model) : null), [model]);
  const active = center ? effectiveFilter(center, filter) : "all";
  const shown = center ? itemsForFilter(center, active) : [];

  const goHome = useCallback(() => router.replace("/(app)/home" as never), []);
  const refresh = bridge.refresh;
  const onRefresh = useCallback(async () => {
    if (!refresh) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const go = useMemo<HomeSheetGo>(
    () => ({
      openRoom: (roomId) => router.push(`/(app)/my-rooms/${roomId}?from=attention` as never),
      roomAction: (roomId, action) => router.push(`/(app)/my-rooms/${roomId}?action=${action}&from=attention` as never),
      openWorkOrder: (woId) => router.push(`/(app)/work-orders/${woId}` as never),
      openMyRooms: () => router.push("/(app)/my-rooms" as never),
      openProcedure: (documentId) => router.push(`/(app)/sop/${documentId}` as never),
      // Only identifiers this phone already holds are handed over; the server authorises them again.
      askAboutRoom:
        assistant && isAssistantRole(role)
          ? (roomId, roomNumber, live) =>
              assistant.openAssistant({ contextType: live ? "cleaningSession" : "room", entityId: roomId, label: roomNumber })
          : undefined,
      openLink: (link) => {
        if (link.kind === "room") router.push(`/(app)/my-rooms/${link.roomId}?from=attention` as never);
        else if (link.kind === "schedule") router.push({ pathname: link.target.pathname, params: link.target.params } as never);
        else router.push({ pathname: "/(app)/tasks", params: { taskId: link.taskId } } as never);
      },
    }),
    [assistant, role],
  );

  const open = useCallback(
    (row: AttentionCenterItem, which: "primary" | "details") => {
      const spec = attentionAction(row.item);
      const target = which === "details" ? ({ type: "details", itemId: row.item.id } as const) : spec.target;
      if (target.type === "room") go.openRoom(target.roomId);
      else if (target.type === "details") sheets.open({ kind: "issue", itemId: target.itemId });
      else if (target.type === "message") sheets.open({ kind: "message" });
      else go.openMyRooms();
    },
    [go, sheets],
  );

  const markNoteRead = useCallback(async () => {
    const mark = useHomeBridge.getState().markNoteRead;
    return mark ? mark() : ({ ok: false, reason: "failed" } as const);
  }, []);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.borderSubtle }]}>
      <Pressable
        onPress={goHome}
        accessibilityRole="button"
        accessibilityLabel={t("home.attentionCenter.backA11y")}
        hitSlop={8}
        style={styles.back}
        testID="attention-back"
      >
        <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
      </Pressable>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
        {t("home.attentionCenter.title")}
      </Text>
      {center ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]} testID="attention-total">
          {center.counts.all}
        </Text>
      ) : null}
    </View>
  );

  if (!model || !center) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]} testID="attention-center">
        {header}
        <View style={styles.centered}>
          <StateBlock
            status="empty"
            emptyIcon="home-outline"
            emptyTitle={t("home.attentionCenter.notReadyTitle")}
            emptyBody={t("home.attentionCenter.notReadyBody")}
          />
          <Button label={t("home.attentionCenter.goHome")} onPress={goHome} variant="secondary" testID="attention-go-home" />
        </View>
      </View>
    );
  }

  const sync = describeSync(model, t, ctx);
  // "2 urgent · 1 access" from the same counts the filters show, so the line can never disagree with them.
  const summary = (["urgent", "access", "messages", "other"] as const)
    .filter((bucket) => center.counts[bucket] > 0)
    .map((bucket) => t(`home.attentionCenter.summary.${bucket}`, { count: center.counts[bucket] }))
    .join(" · ");
  const boardDown = model.board.state === "unavailable";

  const filterLabel = (value: AttentionFilter) => t(`home.attentionCenter.filter.${value}`);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="attention-center">
      {header}

      <View style={styles.filters} accessibilityRole="tablist">
        {center.filters.map((value) => {
          const selected = value === active;
          return (
            <Pressable
              key={value}
              onPress={() => setFilter(value)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t("home.attentionCenter.filterA11y", { label: filterLabel(value), count: center.counts[value] })}
              style={[
                styles.chip,
                { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primary : theme.surfaceSubtle },
              ]}
              testID={`attention-filter-${value}`}
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.chipText, { color: selected ? theme.onPrimary : theme.textPrimary }]}
              >
                {filterLabel(value)} {center.counts[value]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {summary ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: theme.textPrimary }]} accessibilityRole="header" testID="attention-summary">
          {summary}
        </Text>
      ) : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sync, { color: theme.textMuted }]} testID="attention-sync">
        {sync.text}
      </Text>

      <FlatList
        data={shown}
        keyExtractor={(row) => row.item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} />}
        initialNumToRender={8}
        windowSize={7}
        ListEmptyComponent={
          boardDown ? (
            <View style={styles.centered}>
              <StateBlock
                status="error"
                errorMessage={t("home.attentionCenter.unavailable")}
                onRetry={() => void onRefresh()}
                retryLabel={t("common.retry")}
              />
            </View>
          ) : (
            <StateBlock
              status="empty"
              emptyIcon="checkmark-circle-outline"
              emptyTitle={t("home.attentionCenter.emptyTitle")}
              emptyBody={t("home.attentionCenter.emptyBody")}
              style={styles.empty}
            />
          )
        }
        renderItem={({ item: row, index }) => (
          <View style={styles.cardWrap}>
            {index === 0 || shown[index - 1].group !== row.group ? (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                accessibilityRole="header"
                style={[styles.sectionTitle, { color: theme.textMuted }]}
                testID={`attention-section-${row.group}`}
              >
                {t(`home.attentionCenter.section.${row.group}`)}
              </Text>
            ) : null}
            <AttentionCard
              row={row}
              why={attentionWhyLines(row, model, ctx)}
              note={model.supervisorInstruction}
              ctx={ctx}
              t={t}
              onPrimary={() => open(row, "primary")}
              onDetails={() => open(row, "details")}
              onAsk={
                go.askAboutRoom && row.item.kind === "room" && row.entry
                  ? () => go.askAboutRoom?.(row.entry!.room.id, row.entry!.room.room_number, row.entry!.category === "current")
                  : undefined
              }
            />
          </View>
        )}
        testID="attention-list"
      />

      <HomeSheetHost
        model={model}
        sheet={sheets.sheet}
        visible={sheets.visible}
        onClose={sheets.close}
        role={user?.role}
        isOnline={isOnline}
        pendingCount={model.sync.pending}
        language={language}
        t={t}
        ctx={ctx}
        go={go}
        markNoteRead={markNoteRead}
      />
    </View>
  );
}

interface CardProps {
  row: AttentionCenterItem;
  why: WhyLine[];
  onAsk?: () => void;
  note: HomeModel["supervisorInstruction"];
  ctx: TextContext;
  t: Translate;
  onPrimary: () => void;
  onDetails: () => void;
}

function AttentionCard({ row, why, note, ctx, t, onPrimary, onDetails, onAsk }: CardProps) {
  const theme = useTheme();
  const copy = describeAttentionRow(row, note, t, ctx);
  const spec = attentionAction(row.item);
  const tone: Record<AttentionGroup, string> = {
    critical: theme.status.dirty,
    actionable: theme.status.pickup,
    message: theme.status.clean,
    restricted: theme.textMuted,
    info: theme.textMuted,
  };
  const priority = row.item.severity === "critical" ? t("home.attentionCenter.priority.critical") : row.item.severity === "warning" ? t("home.attentionCenter.priority.warning") : null;
  const label = [copy.title, priority, copy.detail].filter(Boolean).join(". ");

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
      accessible={false}
      testID={`attention-card-${row.item.id}`}
    >
      <View style={styles.cardTop} accessible accessibilityLabel={label}>
        <Ionicons name={ICON[row.group]} size={22} color={tone[row.group]} style={styles.cardIcon} />
        <View style={styles.cardText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
            {copy.title}
          </Text>
          {priority ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.priority, { color: tone[row.group] }]} testID={`attention-priority-${row.item.id}`}>
              {priority}
            </Text>
          ) : null}
          {copy.detail ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardDetail, { color: theme.textSecondary }]}>
              {copy.detail}
            </Text>
          ) : null}
          {why.map((line) => (
            <Text
              key={line.code}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.cardWhy, { color: theme.textMuted }]}
              testID={`attention-why-${row.item.id}-${line.code}`}
            >
              {t(`home.attentionCenter.why.${line.code}`, line.values)}
            </Text>
          ))}
        </View>
      </View>
      <View style={styles.cardActions}>
        <Button label={t(spec.labelKey)} onPress={onPrimary} variant="secondary" size="md" testID={`attention-primary-${row.item.id}`} />
        {spec.detailsLink ? (
          <LinkButton label={t("home.attentionCenter.details")} onPress={onDetails} testID={`attention-details-${row.item.id}`} />
        ) : null}
        {onAsk ? <LinkButton label={t("home.attentionCenter.ask")} onPress={onAsk} testID={`attention-ask-${row.item.id}`} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800" },
  count: { fontSize: 14, fontWeight: "800", paddingRight: 8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: 22, paddingHorizontal: 16 },
  chipText: { fontSize: 14, fontWeight: "700" },
  summary: { fontSize: 15, fontWeight: "700", paddingHorizontal: 18, paddingTop: 12 },
  sync: { fontSize: 12, paddingHorizontal: 18, paddingTop: 10 },
  cardWrap: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", paddingTop: 6 },
  cardWhy: { fontSize: 13, lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingTop: 10, gap: 12, flexGrow: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  empty: { padding: 24, alignItems: "center" },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  cardTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  cardIcon: { marginTop: 1 },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: "800", lineHeight: 22 },
  priority: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  cardDetail: { fontSize: 14, lineHeight: 20 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
});

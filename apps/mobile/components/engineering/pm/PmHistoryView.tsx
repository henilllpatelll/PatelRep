import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { listPmCompletions, type PmCompletionSummary } from "@/lib/api/pm";
import { classifyLoadFailure, resolveLoadState, type LoadFailure } from "@/lib/engineering/loadState";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { formatDueDate } from "@/lib/engineering/pmSchedules";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Meta } from "./pmUi";

interface Props {
  scope: string | null;
  hotelTimezone: string | null | undefined;
  language?: string;
  /** Bumped by the screen after a completion so the list re-reads. */
  refreshToken: number;
  assetId?: string;
  onOpen: (row: PmCompletionSummary) => void;
}

const PAGE = 20;

/** Completed inspections, newest first, read a page at a time and only once this view is opened. */
export function PmHistoryView({ scope, hotelTimezone, language, refreshToken, assetId, onOpen }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [rows, setRows] = useState<PmCompletionSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (append: boolean, offset: number) => {
      const ticket = ++generation.current;
      if (append) setLoadingMore(true);
      try {
        const page = await listPmCompletions({ offset, limit: PAGE, assetId });
        if (ticket !== generation.current) return;
        setRows((prev) => (append ? [...prev, ...page.rows.filter((r) => !prev.some((p) => p.id === r.id))] : page.rows));
        setHasMore(page.hasMore);
        setFailure(null);
      } catch (err) {
        if (ticket !== generation.current) return;
        setFailure(classifyLoadFailure(err));
      } finally {
        if (ticket === generation.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [assetId],
  );

  // A different hotel/person, asset filter, or a completion elsewhere restarts from the newest page.
  useEffect(() => {
    generation.current += 1;
    setRows([]);
    setHasMore(false);
    setLoading(true);
    if (scope) void load(false, 0);
  }, [scope, assetId, refreshToken, load]);

  const state = resolveLoadState({ loading, failure, count: rows.length });

  return (
    <View style={styles.stack} testID="pm-history">
      {state.stale ? (
        <Text style={[styles.note, { color: theme.status.pickup }]} accessibilityLiveRegion="polite">
          {t("pm.historyStale")}
        </Text>
      ) : null}
      {rows.map((row) => {
        const date = formatDueDate(hotelDateKey(row.completed_at, hotelTimezone), language);
        const hasFailures = row.failed_count > 0;
        return (
          <Card key={row.id} style={styles.card}>
            <Pressable
              onPress={() => onOpen(row)}
              style={({ pressed }) => [styles.body, { opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`${row.schedule_name ?? t("pm.inspection")}, ${row.asset_name ?? ""}, ${date ?? ""}`}
              testID={`pm-history-${row.id}`}
            >
              <View style={styles.titleRow}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
                  {row.schedule_name ?? t("pm.inspection")}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
                {[row.asset_name, date, row.technician_name].filter(Boolean).join(" · ")}
              </Text>
              <View style={styles.metaRow}>
                <Meta icon="checkmark-circle-outline" text={t("pm.countPassed", { count: row.passed_count })} color={theme.status.ready} />
                {hasFailures ? <Meta icon="close-circle-outline" text={t("pm.countFailed", { count: row.failed_count })} color={theme.status.dirty} /> : null}
                {row.not_applicable_count > 0 ? <Meta icon="remove-circle-outline" text={t("pm.countNa", { count: row.not_applicable_count })} /> : null}
              </View>
            </Pressable>
          </Card>
        );
      })}
      <EngineeringState
        status={state.status === "ready" ? "ready" : state.status}
        onRetry={() => void load(false, 0)}
        emptyIcon="clipboard-outline"
        emptyTitle={t("pm.historyEmptyTitle")}
        emptyBody={t("pm.historyEmptyBody")}
      />
      {hasMore ? (
        <Button label={t("pm.loadMore")} variant="secondary" onPress={() => void load(true, rows.length)} loading={loadingMore} disabled={loadingMore} testID="pm-history-more" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  card: { padding: 14 },
  body: { gap: 5 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "700" },
  sub: { fontSize: 13 },
  metaRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  note: { fontSize: 13 },
});

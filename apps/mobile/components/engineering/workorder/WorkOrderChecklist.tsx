import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { StateBlock } from "@/components/ui/StateBlock";
import { Button } from "@/components/ui/Button";
import type { ChecklistItemError } from "@/lib/engineering/useWorkOrderChecklist";
import { progressRatio, type ChecklistItem, type ChecklistLoad, type ChecklistReadOnlyReason } from "@/lib/engineering/workOrderChecklist";

interface Props {
  load: ChecklistLoad;
  pending: ReadonlySet<string>;
  itemErrors: Readonly<Record<string, ChecklistItemError>>;
  stale: boolean;
  canEdit: boolean;
  readOnlyReason: ChecklistReadOnlyReason;
  locale: "en" | "es";
  onToggle: (itemId: string, next: boolean) => void;
  onRetry: () => void;
  /** Opens Review Completion. Offered only when the person can complete the order. */
  onReviewCompletion?: (() => void) | null;
}

/**
 * The work order's checklist, straight from the server. Every state is its own thing: loading, a failed read (with
 * retry), "no checklist assigned" and a real list are never confused. A step only changes after the server confirms it.
 */
export function WorkOrderChecklist({ load, pending, itemErrors, stale, canEdit, readOnlyReason, locale, onToggle, onRetry, onReviewCompletion }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (load.phase === "loading") {
    return <StateBlock status="loading" style={styles.center} />;
  }
  if (load.phase === "error") {
    return (
      <StateBlock
        status="error"
        errorIcon={load.failure === "offline" ? "cloud-offline-outline" : "alert-circle-outline"}
        errorMessage={t(load.failure === "forbidden" ? "workOrders.repair.checklist.errorForbidden" : "workOrders.repair.checklist.errorLoad")}
        onRetry={load.failure === "forbidden" ? undefined : onRetry}
        retryLabel={t("common.retry")}
        style={styles.center}
      />
    );
  }

  const { items, summary } = load.snapshot;
  if (items.length === 0) {
    return (
      <View style={[styles.card, styles.centered, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="wo-checklist-empty">
        <Ionicons name="list-outline" size={24} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={{ color: theme.textPrimary, fontSize: 16, fontWeight: "700" }}>
          {t("workOrders.repair.checklist.emptyTitle")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5, lineHeight: 20, textAlign: "center" }}>
          {t("workOrders.repair.checklist.emptyBody")}
        </Text>
      </View>
    );
  }

  const ratio = progressRatio(summary) ?? 0;
  const hasRequired = summary.required_total > 0;
  const remaining = summary.required_remaining.length;

  return (
    <View style={styles.stack}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="wo-checklist-summary">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={{ color: theme.textPrimary, fontSize: 16, fontWeight: "700" }}>
          {t("workOrders.repair.checklist.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textSecondary, fontSize: 14 }} testID="wo-checklist-count">
          {t("workOrders.repair.checklist.progress", { done: summary.completed, total: summary.total })}
        </Text>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t("workOrders.repair.checklist.progressA11y", { done: summary.completed, total: summary.total })}
          accessibilityValue={{ min: 0, max: summary.total, now: summary.completed }}
          style={[styles.track, { backgroundColor: theme.borderSubtle }]}
          testID="wo-checklist-bar"
        >
          <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.primaryAction }]} />
        </View>
        {hasRequired ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityLiveRegion="polite"
            style={{ color: remaining > 0 ? theme.status.pickup : theme.textSecondary, fontSize: 13, fontWeight: "700" }}
            testID="wo-checklist-required"
          >
            {remaining > 0 ? t("workOrders.repair.checklist.requiredRemaining", { count: remaining }) : t("workOrders.repair.checklist.requiredDone")}
          </Text>
        ) : null}
        {stale ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }} testID="wo-checklist-stale">
            {t("workOrders.repair.checklist.stale")}
          </Text>
        ) : null}
        {!canEdit && readOnlyReason ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5, lineHeight: 18 }} testID="wo-checklist-readonly">
            {t(`workOrders.repair.checklist.readOnly.${readOnlyReason}`)}
          </Text>
        ) : null}
      </View>

      <View style={[styles.card, styles.list, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {items.map((item, index) => (
          <ChecklistRow
            key={item.id}
            item={item}
            first={index === 0}
            showRequirement={hasRequired}
            busy={pending.has(item.id)}
            disabled={!canEdit}
            error={itemErrors[item.id]}
            locale={locale}
            onToggle={onToggle}
          />
        ))}
      </View>

      {onReviewCompletion ? (
        <Button label={t("workOrders.repair.checklist.reviewCompletion")} variant="secondary" icon="clipboard-outline" onPress={onReviewCompletion} testID="wo-checklist-review" />
      ) : null}
    </View>
  );
}

function ChecklistRow({
  item,
  first,
  showRequirement,
  busy,
  disabled,
  error,
  locale,
  onToggle,
}: {
  item: ChecklistItem;
  first: boolean;
  showRequirement: boolean;
  busy: boolean;
  disabled: boolean;
  error: ChecklistItemError | undefined;
  locale: "en" | "es";
  onToggle: (itemId: string, next: boolean) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const requirement = showRequirement ? t(item.is_required ? "workOrders.repair.checklist.required" : "workOrders.repair.checklist.optional") : null;
  const doneAt = item.is_done && item.done_at ? formatTime(item.done_at, locale) : null;
  const a11y = [item.label, t(item.is_done ? "workOrders.repair.checklist.stateDone" : "workOrders.repair.checklist.stateOpen"), requirement, busy ? t("workOrders.repair.checklist.saving") : null]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={[!first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
      <Pressable
        onPress={() => onToggle(item.id, !item.is_done)}
        disabled={disabled || busy}
        accessibilityRole="checkbox"
        accessibilityLabel={a11y}
        accessibilityState={{ checked: item.is_done, disabled: disabled || busy, busy }}
        testID={`wo-checklist-item-${item.id}`}
        style={styles.row}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.primaryAction} style={styles.box} testID={`wo-checklist-saving-${item.id}`} />
        ) : (
          <Ionicons
            name={item.is_done ? "checkmark-circle" : "ellipse-outline"}
            size={26}
            color={item.is_done ? theme.primaryAction : theme.textDisabled}
            style={styles.box}
          />
        )}
        <View style={styles.rowText}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{ color: theme.textPrimary, fontSize: 15, lineHeight: 21, textDecorationLine: item.is_done ? "line-through" : "none", opacity: item.is_done ? 0.75 : 1 }}
          >
            {item.label}
          </Text>
          {requirement || doneAt ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: item.is_required && !item.is_done ? theme.status.pickup : theme.textMuted, fontSize: 12.5, fontWeight: item.is_required ? "700" : "500" }}>
              {[requirement, doneAt ? t("workOrders.repair.checklist.doneAt", { time: doneAt }) : null].filter(Boolean).join("  ·  ")}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {error ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={{ color: theme.status.dirty, fontSize: 12.5, paddingHorizontal: 16, paddingBottom: 10 }} testID={`wo-checklist-error-${item.id}`}>
          {t(`workOrders.repair.checklist.itemError.${error}`)}
        </Text>
      ) : null}
    </View>
  );
}

function formatTime(iso: string, locale: "en" | "es"): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(locale === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit" });
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  stack: { gap: 12 },
  card: { borderWidth: 1, borderRadius: R.lg, padding: 16, gap: 8 },
  centered: { alignItems: "center", padding: 20 },
  list: { padding: 0, gap: 0, overflow: "hidden" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 },
  box: { width: 28, height: 28, alignItems: "center", justifyContent: "center", textAlign: "center" },
  rowText: { flex: 1, gap: 2 },
});

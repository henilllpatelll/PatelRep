import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { R } from "@/components/shared/tokens";
import { workOrderLocation } from "@/lib/engineering/workOrders";
import type { AttentionItem } from "@/lib/engineering/homeModel";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { HOME_MAX_FONT, HOME_MIN_TOUCH, useHomeStyles } from "./homeStyles";

/** Rows shown before "View all". The full set (work orders, PM and blocked saves) is one tap away, in place. */
export const ATTENTION_PREVIEW = 3;

const REASON_KEY: Record<AttentionItem["reason"], string> = {
  emergency: "emergency",
  urgent_unassigned: "urgentUnassigned",
  past_due: "pastDue",
  pm_overdue: "pmOverdue",
  on_hold: "onHold",
  sync_blocked: "syncBlocked",
};

interface Props {
  items: AttentionItem[];
  viewerId: string | null | undefined;
  /** Both sources that can raise an item have loaded, so an empty list is a real all-clear. */
  trusted: boolean;
  onOpen: (item: AttentionItem) => void;
}

function Row({ item, viewerId, onOpen }: { item: AttentionItem; viewerId: string | null | undefined; onOpen: (item: AttentionItem) => void }) {
  const homeStyles = useHomeStyles();
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  let where: string | null = null;
  let title = "";
  let detail: string | null = null;
  if (item.kind === "wo") {
    const loc = workOrderLocation(item.wo);
    where = loc.room ? t("home.engineer.roomLabel", { room: loc.room }) : loc.text;
    title = item.wo.title;
    detail = !item.wo.assigned_to ? t("home.engineer.notAssigned") : item.wo.assigned_to === viewerId ? t("home.engineer.assignedToYou") : null;
  } else if (item.kind === "pm") {
    where = item.pm.assetName;
    title = item.pm.name;
    detail = t("home.engineer.pmDaysOverdue", { days: Math.abs(item.pm.daysUntilDue ?? 0) });
  } else {
    title = t("home.engineer.syncBlockedTitle", { count: item.count });
    detail = t("home.engineer.syncBlockedHint");
  }
  const hot = item.reason === "emergency" || item.reason === "urgent_unassigned" || item.reason === "pm_overdue" || item.reason === "sync_blocked";
  const heading = [t(`home.engineer.reason.${REASON_KEY[item.reason]}`), where].filter(Boolean).join(" · ");
  const tone = hot ? theme.status.dirty : theme.status.pickup;
  const icon = hot ? "alert-circle" : "time-outline";
  return (
    <Pressable
      onPress={() => onOpen(item)}
      accessibilityRole="button"
      accessibilityLabel={[heading, title, detail].filter(Boolean).join(". ")}
      testID={`attention-${item.key}`}
      style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <View style={[styles.bar, { backgroundColor: tone }]} />
      <View style={styles.body}>
        <View style={styles.headRow}>
          <Ionicons name={icon} size={14} color={tone} accessibilityElementsHidden importantForAccessibility="no" />
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.heading, x.label, { color: tone }]}>
            {heading}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        {detail ? (
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textMuted }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * Needs Attention: the top few signals with a "View all" that expands the same list in place, so the full set always
 * includes PM and blocked saves (a Work-only destination would silently drop them).
 */
export function TechnicianAttentionSection({ items, viewerId, trusted, onOpen }: Props) {
  const homeStyles = useHomeStyles();
  const { t } = useTranslation();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, ATTENTION_PREVIEW);
  const hidden = items.length - ATTENTION_PREVIEW;
  return (
    <View style={styles.section}>
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[homeStyles.sectionTitle, { color: theme.textMuted }]}>
        {t("home.engineer.attentionTitle")}
      </Text>
      <View style={styles.list}>
        {shown.length > 0 ? (
          shown.map((item) => <Row key={item.key} item={item} viewerId={viewerId} onOpen={onOpen} />)
        ) : trusted ? (
          <Card style={homeStyles.emptyRow} testID="attention-empty">
            <Ionicons name="checkmark-done-outline" size={18} color={theme.status.ready} />
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary }]}>
              {t("home.engineer.attentionEmpty")}
            </Text>
          </Card>
        ) : null}
        {hidden > 0 ? (
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={homeStyles.linkRow}
            testID="attention-view-all"
          >
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.link, { color: theme.primaryAction }]}>
              {expanded ? t("home.engineer.attentionShowLess") : t("home.engineer.attentionViewAll", { count: items.length })}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingRight: 12, minHeight: HOME_MIN_TOUCH + 16, overflow: "hidden" },
  bar: { width: 4, alignSelf: "stretch" },
  body: { flex: 1, paddingVertical: 10, gap: 2 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heading: { flexShrink: 1, fontSize: 11.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
});

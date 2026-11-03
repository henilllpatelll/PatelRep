import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { R } from "@/components/shared/tokens";
import { PRIORITY_PREVIEW, canAssignFromPriority, type Priorities, type PriorityItem } from "@/lib/engineering/chiefHomeModel";
import { workOrderCode } from "@/lib/engineering/teamModel";
import { useTheme } from "@/lib/theme/useTheme";
import { HOME_MAX_FONT, HOME_MIN_TOUCH, homeStyles } from "../homeStyles";
import { HomeLoadNotice } from "../HomeLoadNotice";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

interface Props {
  priorities: Priorities;
  /** Chief engineers and GMs may assign; the server enforces it regardless. */
  canAssign: boolean;
  online: boolean;
  /** The overview is cut off (the server read fewer orders than exist): a calm state would be a guess. */
  truncated: boolean;
  onOpen: (item: PriorityItem) => void;
  onAssign: (item: Extract<PriorityItem, { kind: "wo" }>) => void;
  onViewAll: () => void;
  onRetry: () => void;
}

function describe(item: PriorityItem, t: (key: string, o?: Record<string, unknown>) => string) {
  switch (item.kind) {
    case "wo": {
      const wo = item.wo;
      const owner = wo.assigned_to ? (wo.assigned_to_name ? t("workQueue.assignedTo", { name: wo.assigned_to_name }) : t("workQueue.assignedUnknown")) : t("workQueue.unassigned");
      const hold = wo.kind === "on_hold" ? (wo.hold_reason_code ? t(`workOrders.holdReason.${wo.hold_reason_code}`, { defaultValue: t("workQueue.holdReasonOther") }) : t("workQueue.holdReasonUnrecorded")) : null;
      return {
        icon: (wo.kind === "emergency_unassigned" || wo.kind === "urgent_overdue" ? "alert-circle" : wo.kind === "escalated" ? "arrow-up-circle-outline" : "pause-circle-outline") as IconName,
        hot: wo.kind === "emergency_unassigned" || wo.kind === "urgent_overdue",
        heading: [t(`engineeringTeam.attention.${wo.kind}`), workOrderCode(wo)].filter(Boolean).join(" · "),
        title: wo.title ?? "",
        meta: [wo.room_number ? t("workQueue.roomLabel", { room: wo.room_number }) : null, owner, hold].filter(Boolean).join(" · "),
      };
    }
    case "rooms":
      return {
        icon: "bed-outline" as IconName,
        hot: item.pastExpected > 0,
        heading: t("home.chief.roomsDownHeading"),
        title: t("home.chief.roomsDownTitle", { count: item.total }),
        meta: item.pastExpected > 0 ? t("home.chief.roomsPastReturn", { count: item.pastExpected }) : t("home.chief.roomsNoneLate"),
      };
    case "pm":
      return {
        icon: "calendar-outline" as IconName,
        hot: true,
        heading: t("home.chief.pmOverdueHeading"),
        title: item.name ?? t("engineeringTeam.pmOversight"),
        meta: item.assetName ?? "",
      };
    case "repeat":
      return {
        icon: "warning-outline" as IconName,
        hot: false,
        heading: t("home.chief.repeatHeading"),
        title: item.assetName ?? t("engineeringTeam.equipment"),
        meta: t("engineeringTeam.repeatDefects", { count: item.count, days: item.days }),
      };
  }
}

function Row({ item, canAssign, online, onOpen, onAssign }: { item: PriorityItem; canAssign: boolean; online: boolean; onOpen: Props["onOpen"]; onAssign: Props["onAssign"] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const d = describe(item, t as never);
  const tone = d.hot ? theme.status.dirty : theme.status.pickup;
  const assignable = canAssign && canAssignFromPriority(item);
  const reassign = item.kind === "wo" && item.wo.assigned_to != null;
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        onPress={() => onOpen(item)}
        accessibilityRole="button"
        accessibilityLabel={[d.heading, d.title, d.meta].filter(Boolean).join(". ")}
        style={styles.main}
        testID={`priority-${item.key}`}
      >
        <View style={[styles.bar, { backgroundColor: tone }]} />
        <View style={styles.body}>
          <View style={styles.headRow}>
            <Ionicons name={d.icon} size={14} color={tone} />
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} numberOfLines={1} style={[styles.heading, { color: tone }]}>
              {d.heading}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>
            {d.title}
          </Text>
          {d.meta ? (
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} numberOfLines={2} style={[homeStyles.meta, { color: theme.textMuted }]}>
              {d.meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {assignable && item.kind === "wo" ? (
        <Pressable
          onPress={() => onAssign(item)}
          disabled={!online}
          accessibilityRole="button"
          accessibilityState={{ disabled: !online }}
          accessibilityLabel={`${reassign ? t("engineeringTeam.assign.reassignTitle") : t("engineeringTeam.assign.title")}: ${item.wo.title ?? ""}`}
          style={[styles.assignBtn, { borderColor: theme.border, opacity: online ? 1 : 0.5 }]}
          testID={`priority-assign-${item.wo.id}`}
        >
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.link, { color: theme.primaryAction }]}>
            {reassign ? t("engineeringTeam.assign.reassignShort") : t("engineeringTeam.assign.assignShort")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Property Priorities: the highest-priority items from the team overview. "View all" expands the same list in place, so
 * work orders, rooms and PM stay together (a Work-only destination would drop the PM and room rows); anything the server
 * did not send is reachable from Team Overview. A source that could not be read says so; it is never an all-clear.
 */
export function PropertyPriorities({ priorities, canAssign, online, truncated, onOpen, onAssign, onViewAll, onRetry }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { items } = priorities;
  const shown = expanded ? items : items.slice(0, PRIORITY_PREVIEW);
  const hidden = items.length - PRIORITY_PREVIEW;
  return (
    <View style={styles.section} testID="chief-priorities">
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[homeStyles.sectionTitle, { color: theme.textMuted }]}>
        {t("home.chief.prioritiesTitle")}
      </Text>

      {!online && canAssign && items.some((i) => canAssignFromPriority(i)) ? (
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textMuted }]} testID="priority-offline-note">
          {t("home.chief.assignNeedsConnection")}
        </Text>
      ) : null}

      <View style={styles.list}>
        {shown.map((item) => (
          <Row key={item.key} item={item} canAssign={canAssign} online={online} onOpen={onOpen} onAssign={onAssign} />
        ))}

        {priorities.allClear ? (
          <Card style={homeStyles.emptyRow} testID="priority-empty">
            <Ionicons name="checkmark-done-outline" size={18} color={theme.status.ready} />
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary, flex: 1 }]}>
              {t("home.chief.prioritiesEmpty")}
            </Text>
          </Card>
        ) : null}

        {hidden > 0 ? (
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={homeStyles.linkRow}
            testID="priority-view-all"
          >
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.link, { color: theme.primaryAction }]}>
              {expanded ? t("home.engineer.attentionShowLess") : t("home.engineer.attentionViewAll", { count: items.length })}
            </Text>
          </Pressable>
        ) : null}

        {priorities.hiddenWorkOrders > 0 ? (
          <Pressable onPress={onViewAll} accessibilityRole="button" style={homeStyles.linkRow} testID="priority-more-in-team">
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.link, { color: theme.primaryAction }]}>
              {t("home.chief.moreInTeam", { count: priorities.hiddenWorkOrders })}
            </Text>
          </Pressable>
        ) : null}

        {truncated ? (
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.status.pickup }]} testID="priority-truncated">
            {t("engineeringTeam.truncated")}
          </Text>
        ) : null}

        {priorities.roomsUnavailable ? <HomeLoadNotice message={t("home.chief.roomsUnavailable")} actionLabel={t("common.retry")} onPress={onRetry} testID="rooms-unavailable" /> : null}
        {priorities.pmUnavailable ? <HomeLoadNotice message={t("home.chief.pmUnavailable")} actionLabel={t("common.retry")} onPress={onRetry} testID="pm-unavailable" /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: R.md, overflow: "hidden", minHeight: HOME_MIN_TOUCH + 16 },
  main: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "stretch" },
  bar: { width: 4 },
  body: { flex: 1, minWidth: 0, paddingVertical: 10, paddingHorizontal: 10, gap: 2 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heading: { flexShrink: 1, fontSize: 11.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  assignBtn: { minHeight: HOME_MIN_TOUCH - 4, minWidth: 64, marginRight: 10, paddingHorizontal: 12, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center" },
});

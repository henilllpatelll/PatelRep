import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { R, monoFont } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SectionHeader } from "@/components/shared/evening";
import type { TimelineItem } from "@/lib/engineering/repairWorkspace";

interface Props {
  items: readonly TimelineItem[];
  locale: string;
  /** The history requests failed: say so rather than show a quiet, empty list. */
  failed: boolean;
}

const COLLAPSED = 12;

/**
 * Oldest first. System events are plain and italic; a technician's note carries a stronger dot and the word
 * "Note", so a person's words are never mistaken for a machine record. Long histories open collapsed to the latest.
 */
export function WorkOrderActivityTimeline({ items, locale, failed }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const [expanded, setExpanded] = useState(false);
  const hidden = !expanded && items.length > COLLAPSED ? items.length - COLLAPSED : 0;
  const visible = hidden > 0 ? items.slice(hidden) : items;

  return (
    <View testID="wo-timeline">
      <SectionHeader title={t("workOrders.activity")} hint={items.length > 0 ? String(items.length) : undefined} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {failed ? <Text style={{ color: theme.textMuted, fontSize: 13, marginBottom: 6 }}>{t("workOrders.repair.timeline.loadFailed")}</Text> : null}
        {items.length === 0 && !failed ? <Text style={{ color: theme.textDisabled, fontSize: 13 }}>{t("workOrders.noActivity")}</Text> : null}
        {hidden > 0 ? (
          <Pressable onPress={() => setExpanded(true)} accessibilityRole="button" style={styles.more} testID="wo-timeline-more">
            <Text style={{ color: theme.primaryAction, fontWeight: "700", fontSize: 13 }}>{t("workOrders.repair.timeline.showEarlier", { count: hidden })}</Text>
          </Pressable>
        ) : null}
        {visible.map((item, index) => {
          const at = new Date(item.at);
          const stamp = Number.isNaN(at.getTime()) ? "" : at.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          const person = item.kind === "note" && !item.machine;
          const reason = item.params?.reason ? t(`workOrders.holdReason.${item.params.reason}`, { defaultValue: "" }) : "";
          const base = item.labelKey
            ? t(`workOrders.repair.timeline.${item.labelKey}`, { type: item.params?.type ? t(`workOrders.repair.evidence.types.${item.params.type}`) : "" })
            : null;
          const headline = base && reason ? `${base}: ${reason}` : base;
          return (
            <View key={item.id} style={[styles.row, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: 1 }]} testID={`wo-timeline-${item.kind}`}>
              <View style={[styles.dot, { backgroundColor: person ? theme.primaryAction : theme.textDisabled }]} />
              <View style={{ flex: 1, gap: 2 }}>
                {person ? <Text style={{ color: theme.primaryAction, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 }}>{t(item.mine ? "workOrders.repair.timeline.noteMine" : "workOrders.repair.timeline.noteOther")}</Text> : null}
                {headline ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textPrimary, fontSize: 13.5, lineHeight: 19 }}>
                    {headline}
                    {item.actorName ? <Text style={{ color: theme.textMuted }}>{`  ·  ${item.actorName}`}</Text> : null}
                  </Text>
                ) : null}
                {item.text ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[{ color: item.machine && item.kind === "note" ? theme.textMuted : theme.textPrimary, fontSize: 13.5, lineHeight: 19 }, item.machine && item.kind === "note" && { fontStyle: "italic" }]}>
                    {item.text}
                  </Text>
                ) : null}
                <Text style={[{ color: theme.textDisabled, fontSize: 11, fontFamily: monoFont }, x.num]}>{stamp}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 10, paddingVertical: 9 },
  dot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 6 },
  more: { minHeight: 44, justifyContent: "center" },
});

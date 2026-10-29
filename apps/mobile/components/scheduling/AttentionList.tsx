import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { SectionCard, SectionHeader } from "@/components/supervisor/today/TodayBlocks";
import type { AttentionItem } from "@/lib/scheduling/teamScheduleModel";
import { attentionBody, attentionTitle, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

interface ItemProps {
  item: AttentionItem;
  nowMs: number;
  zone: string | null;
  language?: string;
  /** Present when the item names a person whose shift sheet can open. */
  onOpenPerson?: (userId: string) => void;
  t: Translate;
}

/** One real observation: what, who, when. Only items the data supports are ever built (see buildAttention). */
export function AttentionRow({ item, nowMs, zone, language, onOpenPerson, t }: ItemProps) {
  const theme = useTheme();
  const warn = item.severity === "warning";
  const title = attentionTitle(item, t);
  const body = attentionBody(item, { nowMs, zone, language }, t);
  const tap = item.userId && onOpenPerson ? () => onOpenPerson(item.userId as string) : null;
  const content = (
    <>
      <Ionicons name={warn ? "alert-circle-outline" : "information-circle-outline"} size={20} color={warn ? theme.status.pickup : theme.textSecondary} />
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {body}
        </Text>
      </View>
      {tap ? <Ionicons name="chevron-forward" size={16} color={theme.textMuted} /> : null}
    </>
  );
  const style = [styles.row, { backgroundColor: warn ? theme.status.pickupSoft : theme.surfaceMuted, borderColor: warn ? theme.status.pickupLine : theme.border }];
  return tap ? (
    <Pressable onPress={tap} accessibilityRole="button" accessibilityLabel={`${title}. ${body}`} testID={`team-schedule-attention-${item.id}`} style={({ pressed }) => [...style, pressed && { opacity: 0.8 }]}>
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={`${title}. ${body}`} accessibilityRole="alert" testID={`team-schedule-attention-${item.id}`} style={style}>
      {content}
    </View>
  );
}

/** "Needs a look": hidden entirely when there is nothing real to show — never filler. */
export function AttentionList({ items, nowMs, zone, language, onOpenPerson, t }: Omit<ItemProps, "item"> & { items: readonly AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <SectionCard testID="team-schedule-attention">
      <SectionHeader title={t("teamSchedule.attention.title")} />
      <View style={styles.list}>
        {items.map((item) => (
          <AttentionRow key={item.id} item={item} nowMs={nowMs} zone={zone} language={language} onOpenPerson={onOpenPerson} t={t} />
        ))}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14.5, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 18 },
});

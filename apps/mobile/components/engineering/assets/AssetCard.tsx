import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { assetCardModel, type AssetRow } from "@/lib/engineering/assetModel";
import { Fact, StatusBadge, useStatusTone } from "./assetUi";

interface Props {
  row: AssetRow;
  onPress: (assetId: string) => void;
}

/** One piece of equipment: name, tag + category, where it is, its service status and any open maintenance signal. The whole card opens it. */
function AssetCardBase({ row, onPress }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const card = assetCardModel(row);
  const tone = useStatusTone(card.status);
  const tagLine = [card.tag, card.category].filter(Boolean).join(" · ");
  const where = card.room ? t("assets.roomLabel", { room: card.room }) : card.locationText;
  const label = [card.title, tagLine, where, t(`assets.status.${card.status}`)].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={() => onPress(card.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t("assets.card.openHint")}
      testID={`asset-card-${card.id}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.rail, { backgroundColor: tone.fg }]} />
      <View style={[styles.tile, { backgroundColor: tone.bg }]}>
        <Ionicons name="cube-outline" size={18} color={tone.fg} />
      </View>
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.name, { color: theme.textPrimary }]}>
          {card.title}
        </Text>
        {tagLine ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.sub, { color: theme.textSecondary }]}>
            {tagLine}
          </Text>
        ) : null}
        {where ? (
          <Fact icon={card.room ? "bed-outline" : "location-outline"} text={where} />
        ) : null}
        <View style={styles.badges}>
          <StatusBadge status={card.status} testID={`asset-status-${card.id}`} />
          {card.activeRepairs > 0 ? <Fact icon="construct-outline" text={t("assets.card.activeRepairs", { count: card.activeRepairs })} /> : null}
          {card.pmOverdue ? <Fact icon="calendar-outline" text={t("assets.card.pmOverdue")} tone="alert" /> : null}
          {card.hasPrediction ? <Fact icon="pulse-outline" text={t("assets.card.signal")} tone="warn" /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textDisabled} />
    </Pressable>
  );
}

export const AssetCard = memo(AssetCardBase);

const styles = StyleSheet.create({
  card: { position: "relative", overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 12, paddingVertical: 13, borderRadius: 16, borderWidth: 1, minHeight: 64 },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 15, fontWeight: "700" },
  sub: { fontSize: 12.5 },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 },
});

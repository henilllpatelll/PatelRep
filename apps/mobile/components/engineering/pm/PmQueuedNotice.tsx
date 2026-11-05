import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { needsPerson, stateLabelKey, type EngineeringSyncState } from "@/lib/engineering/pmSyncState";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";

interface Props {
  state: EngineeringSyncState;
  onOpenSync: () => void;
  onBack: () => void;
}

/**
 * Shown instead of the inspection form once a completion has been frozen and saved on this phone. It says plainly that
 * the inspection is NOT recorded yet - the state is written out in words, never signalled by colour or a check alone -
 * and the only way on is Sync Status, where it can be retried, reviewed or discarded.
 */
export function PmQueuedNotice({ state, onOpenSync, onBack }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const attention = needsPerson(state);
  const tone = attention ? theme.status.dirty : theme.status.pickup;
  return (
    <View style={styles.wrap} testID="pm-queued">
      <Card style={styles.card}>
        <View style={styles.head} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${t(stateLabelKey(state))}. ${t(attention ? "pm.queued.reviewTitle" : "pm.queued.title")}`}>
          <Ionicons name={attention ? "alert-circle-outline" : "cloud-upload-outline"} size={26} color={tone} />
          <View style={styles.flex}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.state, x.pill, { color: tone }]} testID="pm-queued-state">
              {t(stateLabelKey(state))}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
              {t(attention ? "pm.queued.reviewTitle" : "pm.queued.title")}
            </Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t(attention ? "pm.queued.reviewBody" : "pm.queued.body")}
        </Text>
        <Button label={t("pm.queued.openSync")} onPress={onOpenSync} size="lg" testID="pm-queued-open-sync" />
        <Button label={t("pm.queued.back")} onPress={onBack} variant="secondary" size="lg" testID="pm-queued-back" />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16 },
  card: { gap: 14 },
  head: { flexDirection: "row", gap: 12, alignItems: "center" },
  flex: { flex: 1, gap: 2 },
  state: { fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  title: { fontSize: 18, fontWeight: "800" },
  body: { fontSize: 15, lineHeight: 22 },
});

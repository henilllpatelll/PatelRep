import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  roomNumber: string;
  /** "Departure · S1K · Floor 2" — already translated and joined. */
  subtitle: string | null;
  statusKey: StatusKey;
  statusLabel: string;
  rush: boolean;
  onBack: () => void;
  /** Opens Report / More. Omitted where nothing can be reported. */
  onMore?: () => void;
}

/**
 * Compact navigation row plus room identity. The room number is the dominant
 * element; everything else on the screen is subordinate to it.
 */
export function RoomDetailHeader({ roomNumber, subtitle, statusKey, statusLabel, rush, onBack, onMore }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="room-detail-header"
      style={[styles.root, { paddingTop: insets.top + 6, backgroundColor: theme.background, borderBottomColor: theme.borderSubtle }]}
    >
      <View style={styles.navRow}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={t("rooms.title")}
          testID="room-detail-back"
        >
          <Ionicons name="chevron-back" size={20} color={theme.primaryAction} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.backLabel, { color: theme.primaryAction }]}>
            {t("rooms.title")}
          </Text>
        </Pressable>
        {onMore ? (
          <Pressable
            onPress={onMore}
            hitSlop={8}
            style={styles.more}
            accessibilityRole="button"
            accessibilityLabel={t("rooms.work.actions.more")}
            testID="room-detail-more"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.identity}>
        <View style={styles.numberCol}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={t("rooms.work.roomA11y", { number: roomNumber })}
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.number, { color: theme.textPrimary }]}
          >
            {roomNumber}
          </Text>
          {subtitle ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.badges}>
          {rush ? (
            <View
              accessible
              accessibilityLabel={t("rooms.dash.rush.title")}
              style={[styles.rush, { backgroundColor: theme.status.dirty }]}
            >
              <Ionicons name="flash" size={12} color={theme.onPrimary} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rushText, { color: theme.onPrimary }]}>
                {t("rooms.work.rushBadge")}
              </Text>
            </View>
          ) : null}
          <StatusBadge statusKey={statusKey} label={statusLabel} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, gap: 4 },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44 },
  backLabel: { fontSize: 15, fontWeight: "600" },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -8 },
  identity: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  numberCol: { flexShrink: 1, gap: 2 },
  number: { fontFamily: monoFont, fontSize: 48, lineHeight: 54, fontWeight: "800" },
  subtitle: { fontSize: 14, fontWeight: "600" },
  badges: { alignItems: "flex-end", gap: 6, paddingTop: 8 },
  rush: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  rushText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
});

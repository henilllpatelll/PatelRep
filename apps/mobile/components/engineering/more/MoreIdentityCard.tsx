import type React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/shared/mobileHandoff";
import { MIN_TOUCH, SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  name: string;
  roleLabel: string | null;
  hotelName: string | null;
  avatarUri: string | null;
  /** Real sync status from the engineering queues: words, an icon and a tone colour (never colour alone). */
  connection: { text: string; color: string; icon: React.ComponentProps<typeof Ionicons>["name"]; hint: string };
  onProfile: () => void;
  onSync: () => void;
}

/** Who is signed in (opens Personal Information) with the connection row (opens the Sync Center) beneath. */
export function MoreIdentityCard({ name, roleLabel, hotelName, avatarUri, connection, onProfile, onSync }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="more-identity">
      <Pressable
        onPress={onProfile}
        accessibilityRole="button"
        accessibilityLabel={[name, roleLabel, hotelName].filter(Boolean).join(", ") + ". " + t("engineeringMore.viewProfile")}
        style={({ pressed }) => [styles.profile, pressed && { backgroundColor: theme.surfaceMuted }]}
        testID="more-profile"
      >
        <Avatar name={name} size={56} uri={avatarUri} />
        <View style={styles.text}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.name, { color: theme.textPrimary }]} testID="more-name">
            {name}
          </Text>
          {roleLabel ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.primary }]} testID="more-role">
              {roleLabel}
            </Text>
          ) : null}
          {hotelName ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.hotel, { color: theme.textMuted }]} testID="more-hotel">
              {hotelName}
            </Text>
          ) : null}
          <View style={styles.viewRow}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.view, { color: theme.primary }]}>
              {t("engineeringMore.viewProfile")}
            </Text>
            <Ionicons name="arrow-forward" size={14} color={theme.primary} />
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onSync}
        accessibilityRole="button"
        accessibilityLabel={connection.text}
        accessibilityHint={connection.hint}
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [styles.sync, { borderTopColor: theme.borderSubtle }, pressed && { backgroundColor: theme.surfaceMuted }]}
        testID="more-sync"
      >
        <Ionicons name={connection.icon} size={18} color={connection.color} testID="more-sync-icon" />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.syncText, { color: theme.textPrimary }]} testID="more-sync-text">
          {connection.text}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, overflow: "hidden" },
  profile: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 88 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 19, fontWeight: "700" },
  role: { fontSize: 13, fontWeight: "700" },
  hotel: { fontSize: 13 },
  viewRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  view: { fontSize: 13, fontWeight: "600" },
  sync: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TOUCH, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  syncText: { flex: 1, fontSize: 13.5, fontWeight: "600", paddingVertical: 4 },
});

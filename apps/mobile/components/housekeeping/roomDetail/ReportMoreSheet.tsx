import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import type { ReportActionId, ReportActionState } from "@/lib/housekeeping/reportActions";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";

/** Everything the hub can open. "flags" is the room-condition flags sheet (only when the room has any). */
export type ReportTarget = ReportActionId | "flags";

interface Props {
  visible: boolean;
  room: Room;
  actions: ReportActionState[];
  /** The room has condition flags (pet room, smoke smell, late checkout). */
  hasFlags: boolean;
  /** Flags create server records, so they need a connection. */
  isOnline: boolean;
  /** Changes waiting to reach the server; shown on the sync row. */
  pendingCount: number;
  onClose: () => void;
  /** The screen sequences the hand-off so the next sheet opens reliably. */
  onSelect: (target: ReportTarget) => void;
}

const ICONS: Record<ReportTarget, React.ComponentProps<typeof Ionicons>["name"]> = {
  exception: "hand-left-outline",
  issue: "build-outline",
  supplies: "cube-outline",
  found: "bag-outline",
  note: "chatbubble-outline",
  info: "information-circle-outline",
  linen: "layers-outline",
  sync: "sync-outline",
  flags: "flag-outline",
};

function Row({
  target,
  title,
  hint,
  disabledReason,
  badge,
  onPress,
}: {
  target: ReportTarget;
  title: string;
  hint: string;
  disabledReason: string | null;
  badge?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const disabled = Boolean(disabledReason);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${disabledReason ?? hint}${badge ? `. ${badge}` : ""}`}
      accessibilityState={{ disabled }}
      style={[styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }, disabled && styles.dim]}
      testID={`more-${target}`}
    >
      <Ionicons name={ICONS[target]} size={22} color={theme.textSecondary} />
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        {/* The reason is words under the row, not just a dimmed row. */}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: disabledReason ? theme.status.pickup : theme.textSecondary }]}>
          {disabledReason ?? hint}
        </Text>
      </View>
      {badge ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badge, { color: theme.status.pickup }]}>
          {badge}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </Pressable>
  );
}

/**
 * The one secondary-action hub on Room Detail. Each row opens a focused sheet; only
 * what this person may do is listed, and an unavailable row says why. The forms
 * themselves are not mounted here, so opening the hub costs nothing.
 */
export function ReportMoreSheet({ visible, room, actions, hasFlags, isOnline, pendingCount, onClose, onSelect }: Props) {
  const { t } = useTranslation();

  const ordered: Array<{ target: ReportTarget; disabledReason: string | null }> = actions.map((action) => ({
    target: action.id,
    disabledReason: action.disabledReason ? t(`rooms.work.more.disabled.${action.disabledReason}`) : null,
  }));
  if (hasFlags) {
    const at = ordered.findIndex((entry) => entry.target === "note");
    ordered.splice(at < 0 ? ordered.length : at + 1, 0, { target: "flags", disabledReason: isOnline ? null : t("rooms.work.more.disabled.needsConnection") });
  }

  return (
    <BottomSheet visible={visible} title={t("rooms.work.more.title", { room: room.room_number })} onClose={onClose} testID="report-more-sheet">
      {ordered.map(({ target, disabledReason }) => (
        <Row
          key={target}
          target={target}
          title={t(`rooms.work.more.rows.${target}.title`)}
          hint={t(`rooms.work.more.rows.${target}.hint`)}
          disabledReason={disabledReason}
          badge={target === "sync" && pendingCount > 0 ? String(pendingCount) : undefined}
          onPress={() => onSelect(target)}
        />
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  copy: { flex: 1, gap: 1 },
  title: { fontSize: 15, fontWeight: "800" },
  hint: { fontSize: 13, lineHeight: 18 },
  badge: { fontSize: 14, fontWeight: "900" },
  dim: { opacity: 0.6 },
});

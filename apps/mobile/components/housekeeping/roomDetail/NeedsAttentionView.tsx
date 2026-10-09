import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import type { RoomDetailView } from "@/lib/housekeeping/roomDetailState";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { RushPriorityPanel } from "@/components/housekeeping/RushPriorityPanel";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  room: Room;
  view: RoomDetailView;
  ctx: TextContext;
  /** The Phase 3 restriction panel (DND / declined / come back later), built by the screen. */
  restriction: ReactNode;
  onOpenInfo: () => void;
}

const SOFT_COPY = {
  checkout_unverified: "rooms.work.attention.checkoutUnverified",
  guest_inside: "rooms.work.attention.guestInside",
  access_problem: "rooms.work.attention.accessProblem",
} as const;

/**
 * A room that cannot simply be started. Hard restrictions (DND, declined service,
 * come back later) reuse the Phase 3 panel with its real attempt history; the
 * unverified-access reasons explain why entry goes through the protocol. Rush is
 * shown as context only — it never turns a restricted room into a prompt to go in.
 */
export function NeedsAttentionView({ room, view, ctx, restriction, onOpenInfo }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const restricted = view.startBlock === "restricted";
  const soft = view.attention && view.attention in SOFT_COPY ? (view.attention as keyof typeof SOFT_COPY) : null;
  const lastCheckout = formatClock(room.checkout_time, ctx);

  return (
    <View style={styles.root} testID="needs-attention-view">
      {restricted ? restriction : null}

      {soft ? (
        <View
          testID="access-notice"
          accessibilityRole="alert"
          style={[styles.card, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}
        >
          <View style={styles.titleRow}>
            <Ionicons name="warning" size={18} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.status.dirty }]}>
              {t(`${SOFT_COPY[soft]}.title`)}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
            {t(`${SOFT_COPY[soft]}.body`)}
          </Text>
          {soft === "checkout_unverified" && lastCheckout ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
              {t("rooms.work.attention.scheduledCheckout", { time: lastCheckout })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <RushPriorityPanel room={room} classification={view.classification} ctx={ctx} />

      <Pressable
        onPress={onOpenInfo}
        accessibilityRole="button"
        accessibilityLabel={t("rooms.work.roomInfo.open")}
        style={[styles.infoLink, { borderColor: theme.border, backgroundColor: theme.surface }]}
        testID="open-room-info"
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoLinkText, { color: theme.primaryAction }]}>
          {t("rooms.work.roomInfo.open")}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={theme.primaryAction} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  card: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "900", letterSpacing: 0.3 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  meta: { fontSize: 14, lineHeight: 20 },
  infoLink: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  infoLinkText: { fontSize: 15, fontWeight: "800" },
});

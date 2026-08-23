import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { monoFont } from "@/components/shared/tokens";
import { useHousekeeperAccent, useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore, type Room } from "@/stores/appStore";
import { getChecklistForRoom, isArrivalSoon } from "@/lib/housekeeping/roomWorkflow";
import { markRoomClean } from "@/lib/housekeeping/markClean";
import type { SmartQueueEntry } from "@/lib/ai/briefing";
import { Button } from "@/components/ui/Button";

const HOLD_DURATION_MS = 700;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface Props {
  visible: boolean;
  room: Room;
  elapsedSec: number;
  /** The room to start next once this one's confirmed — the queue entry right
   *  after this room, if there is one. Drives the "Up next" footer. */
  nextUp?: SmartQueueEntry | null;
  onClose: () => void;
  /** Fired after the PATCH succeeds — caller should optimistically update myRooms. */
  onConfirmed: (roomId: string) => void;
}

/** Home's quick "mark clean" entry point for an in-progress stayover/pickup room.
 *  DEP rooms need linen counts entered on the detail screen — never route one here. */
export default function HoldToConfirmSheet({ visible, room, elapsedSec, nextUp, onClose, onConfirmed }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const accent = useHousekeeperAccent();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((s) => s.isOnline);
  const enqueueAction = useAppStore((s) => s.enqueueAction);
  const checklistProgress = useAppStore((s) => s.roomChecklistProgress[room.id]);
  const [confirming, setConfirming] = useState(false);
  const fill = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checklist = getChecklistForRoom(room);
  const progress = checklistProgress ?? {};
  const doneCount = checklist.filter((key) => progress[key]).length;
  const complete = doneCount === checklist.length;

  useEffect(() => {
    if (!visible && holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      fill.setValue(0);
    }
  }, [visible, fill]);

  async function handleConfirmed() {
    setConfirming(true);
    try {
      await markRoomClean(room, { isOnline, enqueueAction });
      onConfirmed(room.id);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? t("rooms.detail.alerts.updateRoomFailed"));
      Animated.timing(fill, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    } finally {
      setConfirming(false);
    }
  }

  function handlePressIn() {
    if (!complete || confirming) return;
    Animated.timing(fill, {
      toValue: 1,
      duration: HOLD_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      void handleConfirmed();
    }, HOLD_DURATION_MS);
  }

  function handlePressOut() {
    if (!holdTimer.current) return;
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
    Animated.timing(fill, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  }

  function openRoomToFinish() {
    onClose();
    router.push(`/(app)/my-rooms/${room.id}` as never);
  }

  const fillStyle = { width: fill.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} testID="hold-confirm-overlay">
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.sheet, { paddingBottom: insets.bottom + 20, backgroundColor: theme.surface }]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.borderSubtle }]} />

          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>
              {t("home.holdConfirm.title", { room: room.room_number })}
            </Text>
            <Text style={[styles.elapsed, { color: theme.status.ready }]}>{formatClock(elapsedSec)}</Text>
          </View>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{t("home.holdConfirm.subtitle")}</Text>

          <View
            style={[
              styles.checklistCard,
              { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle },
            ]}
            testID="hold-confirm-checklist"
          >
            <View
              style={[
                styles.checklistIcon,
                complete
                  ? { backgroundColor: theme.status.ready, borderColor: theme.status.ready }
                  : { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
              ]}
            >
              <Ionicons
                name={complete ? "checkmark" : "ellipsis-horizontal"}
                size={12}
                color={complete ? theme.onPrimary : theme.status.pickup}
              />
            </View>
            <Text style={[styles.checklistText, { color: theme.textPrimary }]}>
              {t("home.holdConfirm.checklistStatus", { done: doneCount, total: checklist.length })}
            </Text>
          </View>

          {complete ? (
            <>
              <Pressable
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={confirming}
                accessibilityRole="button"
                accessibilityLabel={t("home.holdConfirm.cta")}
                testID="hold-confirm-button"
                style={[styles.holdBtn, { backgroundColor: accent.bgPressed }]}
              >
                <Animated.View style={[styles.holdFill, fillStyle, { backgroundColor: accent.bg }]} />
                <Text style={styles.holdBtnText}>
                  {confirming ? t("home.holdConfirm.confirming") : t("home.holdConfirm.cta")}
                </Text>
              </Pressable>
              <Text style={[styles.releaseHint, { color: theme.textMuted }]}>
                {t("home.holdConfirm.releaseHint")}
              </Text>
            </>
          ) : (
            <Button
              label={t("home.holdConfirm.openRoom")}
              onPress={openRoomToFinish}
              size="lg"
              testID="hold-confirm-open-room"
              style={styles.openRoomBtn}
            />
          )}

          {nextUp ? (
            <View style={[styles.nextUpRow, { borderTopColor: theme.borderSubtle }]} testID="hold-confirm-next-up">
              <Text style={[styles.nextUpText, { color: theme.textMuted }]} numberOfLines={1}>
                {t("home.holdConfirm.nextUp", { room: nextUp.room.room_number })}
              </Text>
              {isArrivalSoon(nextUp.room) && nextUp.room.checkin_time ? (
                <Text style={[styles.nextUpMeta, { color: accent.bg }]}>
                  {t("home.holdConfirm.startBy", { time: formatClockTime(new Date(nextUp.room.checkin_time)) })}
                </Text>
              ) : (
                <Text style={[styles.nextUpMeta, { color: theme.textMuted }]}>
                  {t("home.holdConfirm.nextUpMinutes", { minutes: nextUp.estimateMinutes })}
                </Text>
              )}
            </View>
          ) : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3, flex: 1 },
  elapsed: { fontFamily: monoFont, fontSize: 13, fontWeight: "700" },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: -6 },

  checklistCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
  },
  checklistIcon: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  checklistText: { fontSize: 13, fontWeight: "600" },

  holdBtn: {
    height: 54,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  holdFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  holdBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  releaseHint: { textAlign: "center", fontSize: 12, marginTop: -6 },
  openRoomBtn: { borderRadius: 12 },
  nextUpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 2,
  },
  nextUpText: { flex: 1, fontSize: 12, fontWeight: "600" },
  nextUpMeta: { fontFamily: monoFont, fontSize: 12, fontWeight: "700" },
});

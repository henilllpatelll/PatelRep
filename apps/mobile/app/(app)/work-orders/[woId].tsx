import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { enqueueAction } from "@/lib/offline/db";
import { useAppStore } from "@/stores/appStore";
import { api } from "@/lib/api/client";
import {
  addWorkOrderComment,
  claimWorkOrder,
  completeWorkOrder,
  getWorkOrder,
  setWorkOrderStatus,
  uploadWorkOrderPhoto,
  workOrderPhotoUrl,
} from "@/lib/api/workOrders";
import { fetchBoard } from "@/lib/api/housekeepingSupervisor";
import {
  dueState,
  formatClock,
  formatDuration,
  minutesSince,
  workOrderLocation,
  type WorkOrder,
  type WorkOrderComment,
  type WorkOrderPhoto,
} from "@/lib/engineering/workOrders";
import { normalizeBoardRooms } from "@/lib/housekeeping/supervisor";
import { localDate } from "@/lib/utils/date";
import { C, R, monoFont } from "@/components/shared/tokens";
import { CATEGORY_META } from "@/components/engineering/WorkOrderCard";
import { SectionHeader } from "@/components/shared/evening";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { StateBlock } from "@/components/ui/StateBlock";

/* ─── Work-order detail — the workbench ─────────────────────────────────────
   Everything on this screen is real: SLA timing from due_at, elapsed time
   from started_at, photos from work_order_photos, the activity trail from
   work_order_comments. Actions follow the API state machine:
   open → claim & start → (hold ⇄ resume) → complete. */

// Statuses that map cleanly onto a StatusBadge StatusKey render via the primitive;
// the rest (open/in_progress/cancelled) keep the local themed StatusPill fallback —
// no force-fit onto an ill-matching StatusKey (mirrors 08-02's ChecklistSection rule).
const WO_STATUS_BADGE_KEY: Partial<Record<string, StatusKey>> = {
  on_hold: "onHold",
  completed: "completed",
};

type RoomOccupancy = "occupied" | "vacant";

async function resolveRoomOccupancy(wo: WorkOrder): Promise<RoomOccupancy | null> {
  if (!wo.room_id && !wo.rooms?.room_number) return null;

  try {
    const board = await fetchBoard(localDate());
    const rooms = normalizeBoardRooms(board);
    const match = rooms.find(
      (room) =>
        (wo.room_id != null && room.roomId === wo.room_id) ||
        (wo.rooms?.room_number != null && room.roomNumber === wo.rooms.room_number),
    );

    if (!match?.foStatus) return null;
    return match.foStatus === "OCC" ? "occupied" : "vacant";
  } catch {
    return null;
  }
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const theme = useTheme();
  const tone: Record<string, { fg: string; bg: string; line: string }> = {
    open: { fg: theme.status.clean, bg: theme.status.cleanSoft, line: theme.status.cleanLine },
    in_progress: { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine },
    cancelled: { fg: theme.status.outOfOrder, bg: theme.status.outOfOrderSoft, line: theme.status.outOfOrderLine },
  };
  const resolved = tone[status] ?? tone.open;
  return (
    <View style={[pillStyles.pill, { backgroundColor: resolved.bg, borderColor: resolved.line }]}>
      <Text style={[pillStyles.text, { color: resolved.fg }]}>{label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  text: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },
});

export default function WorkOrderDetailScreen() {
  const { woId } = useLocalSearchParams<{ woId: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const { isOnline, user } = useAppStore();
  const locale = user?.language_pref === "es" ? "es" : "en";
  const role = user?.effective_role ?? user?.role;

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [roomOccupancy, setRoomOccupancy] = useState<RoomOccupancy | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [parts, setParts] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"claim" | "complete" | "hold" | "resume" | "comment" | "photo" | "arrive" | "escalate" | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const nextWo = await getWorkOrder(String(woId));
      setWo(nextWo);
      setRoomOccupancy(await resolveRoomOccupancy(nextWo));
    } catch {
      setWo(null);
      setRoomOccupancy(null);
    } finally {
      setLoading(false);
    }
  }, [woId]);

  useEffect(() => {
    load();
  }, [load]);

  // Minute tick keeps the elapsed/SLA lines honest while the screen is open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isMine = wo?.assigned_to != null && wo.assigned_to === user?.id;
  const isManager = role === "gm";
  const canClaim = wo?.status === "open" && !wo.assigned_to;
  const canComplete = wo?.status === "in_progress" && (isManager || isMine);
  const canResume = wo?.status === "on_hold" && (isManager || isMine);
  const claimedElsewhere =
    wo != null && (wo.status === "in_progress" || wo.status === "on_hold") && !isMine && !isManager;

  const due = wo ? dueState(wo, locale, now) : null;
  const elapsed = wo?.status === "in_progress" ? minutesSince(wo.started_at, now) : null;
  const { room, text: locationText } = wo ? workOrderLocation(wo) : { room: null, text: null };
  const categoryKey = wo?.category && CATEGORY_META[wo.category] ? wo.category : "general";

  const comments = useMemo(() => {
    const list = [...(wo?.work_order_comments ?? [])];
    list.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    return list;
  }, [wo?.work_order_comments]);

  const photos = wo?.work_order_photos ?? [];

  async function handleClaim() {
    if (!wo) return;
    setBusy("claim");
    try {
      if (isOnline) {
        await claimWorkOrder(wo.id);
        await load();
      } else {
        await enqueueAction("work_order", "claim", {}, wo.id);
        setWo({ ...wo, status: "in_progress", assigned_to: user?.id ?? null, started_at: new Date().toISOString() });
      }
    } catch (err) {
      toast.error((err as Error).message ?? t("workOrders.alerts.claimFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete() {
    if (!wo) return;
    setBusy("complete");
    const payload = {
      notes: notes.trim() || undefined,
      parts_used: parts.trim() || undefined,
    };
    try {
      if (isOnline) {
        await completeWorkOrder(wo.id, payload);
        toast.success(t("workOrders.completedMessage"));
        router.back();
      } else {
        await enqueueAction("work_order", "complete", payload, wo.id);
        setWo({ ...wo, status: "completed", completed_at: new Date().toISOString() });
        toast.info(t("workOrders.offlineQueued"));
      }
    } catch (err) {
      toast.error((err as Error).message ?? t("workOrders.alerts.completeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSetStatus(status: "on_hold" | "in_progress") {
    if (!wo) return;
    setBusy(status === "on_hold" ? "hold" : "resume");
    try {
      await setWorkOrderStatus(wo.id, status);
      await load();
    } catch (err) {
      toast.error((err as Error).message ?? t("workOrders.alerts.setStatusFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleAddComment() {
    if (!wo || !comment.trim()) return;
    setBusy("comment");
    try {
      const created = await addWorkOrderComment(wo.id, comment.trim());
      setComment("");
      if (created) {
        setWo({ ...wo, work_order_comments: [...(wo.work_order_comments ?? []), created] });
      } else {
        await load();
      }
    } catch (err) {
      Alert.alert(t("common.error"), (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleArrive() {
    if (!wo || busy) return;
    setBusy("arrive");
    try {
      const timeStr = new Date().toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
      await addWorkOrderComment(wo.id, `Engineer arrived on site — ${timeStr}`);
      await load();
    } catch (err) {
      toast.error((err as Error).message ?? t("workOrders.alerts.arriveFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function handleEscalate() {
    if (!wo || busy) return;
    // This is a genuine Yes/Cancel choice gating a state-changing escalation —
    // stays a blocking confirm dialog per D-04 (T-08-06-02). Do NOT convert to Toast.
    Alert.alert(
      t("workOrders.escalateTitle"),
      t("workOrders.escalateConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("workOrders.escalateConfirmBtn"),
          style: "destructive",
          onPress: async () => {
            setBusy("escalate");
            try {
              await api.patch(`/work-orders/${wo.id}`, { priority: "urgent" });
              await addWorkOrderComment(wo.id, "Escalated to chief engineer");
              await load();
            } catch (err) {
              toast.error((err as Error).message ?? t("workOrders.alerts.escalateFailed"));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  }

  async function handleAddPhoto() {
    if (!wo) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("workOrders.photos"), t("workOrders.cameraDenied"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    setBusy("photo");
    try {
      const compact = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      const photo = await uploadWorkOrderPhoto(wo.id, compact.uri);
      if (photo) {
        setWo({ ...wo, work_order_photos: [...(wo.work_order_photos ?? []), photo] });
      }
    } catch (err) {
      Alert.alert(t("common.error"), (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <StateBlock status="loading" style={[styles.center, { backgroundColor: theme.background }]} />;
  }

  if (!wo) {
    return (
      <StateBlock
        status="error"
        errorIcon="cloud-offline-outline"
        errorMessage={t("workOrders.errorLoad")}
        onRetry={() => router.back()}
        retryLabel={t("common.back")}
        style={[styles.center, { backgroundColor: theme.background }]}
      />
    );
  }

  const category = CATEGORY_META[categoryKey];
  const showWrapUp = canComplete;
  const hasFooter = canClaim || canComplete || canResume;
  const occupancyLabel = roomOccupancy ? t(`workOrders.roomOccupancy.${roomOccupancy}`) : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
        <View style={styles.heroNav}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          >
            <Ionicons name="arrow-back" size={22} color={theme.shell.ink} />
          </TouchableOpacity>
          <View style={styles.headerBody}>
            <Text style={[styles.headerKicker, { color: theme.shell.ink3 }]}>{t("workOrders.detailKicker")}</Text>
          </View>
          {wo.priority === "urgent" ? (
            <StatusBadge statusKey="urgent" label={t("workOrders.chipUrgent")} />
          ) : null}
          {WO_STATUS_BADGE_KEY[wo.status] ? (
            <StatusBadge statusKey={WO_STATUS_BADGE_KEY[wo.status]!} label={t(`workOrders.status.${wo.status}`)} />
          ) : (
            <StatusPill status={wo.status} label={t(`workOrders.status.${wo.status}`)} />
          )}
        </View>

        {/* Identity — what and where */}
        <Text style={[styles.title, { color: theme.shell.ink }]}>{wo.title}</Text>
        <View style={styles.metaLine}>
          <View style={[styles.categoryTile, { backgroundColor: category.bg }]}>
            <Ionicons name={category.icon} size={13} color={category.fg} />
          </View>
          <Text style={[styles.categoryText, { color: theme.shell.ink2 }]}>{t(`workOrders.category.${categoryKey}`)}</Text>
          {room ? (
            <>
              <View style={[styles.dot, { backgroundColor: theme.shell.ink3 }]} />
              <Ionicons name="location-outline" size={13} color={theme.shell.ink3} />
              <Text style={[styles.roomText, { color: theme.shell.ink2 }]}>
                {room}
                {wo.rooms?.floor != null ? `  ·  ${t("workOrders.floor", { floor: wo.rooms.floor })}` : ""}
              </Text>
              {occupancyLabel ? (
                <View
                  style={[
                    styles.occupancyChip,
                    roomOccupancy === "occupied"
                      ? { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }
                      : { backgroundColor: theme.status.readySoft, borderColor: theme.status.readyLine },
                  ]}
                >
                  <Text
                    style={[
                      styles.occupancyChipText,
                      { color: roomOccupancy === "occupied" ? theme.status.dirty : theme.status.ready },
                    ]}
                  >
                    {occupancyLabel}
                  </Text>
                </View>
              ) : null}
            </>
          ) : locationText ? (
            <>
              <View style={[styles.dot, { backgroundColor: theme.shell.ink3 }]} />
              <Ionicons name="location-outline" size={13} color={theme.shell.ink3} />
              <Text style={[styles.locationPlain, { color: theme.shell.ink2 }]} numberOfLines={1}>
                {locationText}
              </Text>
            </>
          ) : null}
          {wo.guest_reported ? (
            <View style={[styles.guestChip, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]}>
              <Ionicons name="person-outline" size={10} color={theme.status.clean} />
              <Text style={[styles.guestChipText, { color: theme.status.clean }]}>{t("workOrders.chipGuest")}</Text>
            </View>
          ) : null}
        </View>

        {/* Timing — created / SLA / clock */}
        <View style={[styles.timingCard, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}>
          <View style={styles.timingItem}>
            <Text style={[styles.timingLabel, { color: theme.shell.ink3 }]}>{t("workOrders.factCreated")}</Text>
            <Text style={[styles.timingValue, { color: theme.shell.ink }]}>
              {minutesSince(wo.created_at, now) != null
                ? t("workOrders.ago", { time: formatDuration(minutesSince(wo.created_at, now)!) })
                : "—"}
            </Text>
          </View>
          {wo.status === "completed" ? (
            <View style={styles.timingItem}>
              <Text style={[styles.timingLabel, { color: theme.shell.ink3 }]}>{t("workOrders.factCompleted")}</Text>
              <Text style={[styles.timingValue, { color: theme.status.readyLine }]}>
                {formatClock(wo.completed_at, locale) ?? "—"}
              </Text>
            </View>
          ) : (
            <View style={styles.timingItem}>
              <Text style={[styles.timingLabel, { color: theme.shell.ink3 }]}>{t("workOrders.factDue")}</Text>
              {due?.kind === "overdue" ? (
                <Text style={[styles.timingValue, { color: theme.status.dirtyLine }]}>
                  {t("workOrders.overdueBy", { time: formatDuration(due.minutes) })}
                </Text>
              ) : due?.kind === "due" ? (
                <Text style={[styles.timingValue, { color: theme.shell.ink }]}>{due.clock}</Text>
              ) : (
                <Text style={[styles.timingValue, { color: theme.shell.ink }]}>—</Text>
              )}
            </View>
          )}
          {elapsed != null ? (
            <View style={styles.timingItem}>
              <Text style={[styles.timingLabel, { color: theme.shell.ink3 }]}>{t("workOrders.factOnClock")}</Text>
              <Text style={[styles.timingValue, { color: theme.status.pickupLine }]}>{formatDuration(elapsed)}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, hasFooter && styles.contentWithFooter]}>
        {claimedElsewhere ? (
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={14} color={theme.textMuted} />
            <Text style={[styles.noticeText, { color: theme.textMuted }]}>{t("workOrders.claimedElsewhere")}</Text>
          </View>
        ) : null}

        {wo.status === "in_progress" && isMine ? (
          <Button
            label={t("workOrders.arrivedOnSite")}
            onPress={handleArrive}
            loading={busy === "arrive"}
            disabled={busy === "arrive"}
            variant="secondary"
            size="sm"
            icon="location-outline"
          />
        ) : null}

        {/* Details */}
        {wo.description ? (
          <View>
            <SectionHeader title={t("workOrders.details")} />
            <View style={styles.card}>
              <Text style={styles.descriptionText}>{wo.description}</Text>
            </View>
          </View>
        ) : null}

        {/* Linked asset */}
        {wo.assets?.name ? (
          <View>
            <SectionHeader title={t("workOrders.asset")} />
            <View style={[styles.card, styles.assetCard]}>
              <View style={styles.assetTile}>
                <Ionicons name="cube-outline" size={17} color={C.primary} />
              </View>
              <View style={styles.assetBody}>
                <Text style={styles.assetName}>{wo.assets.name}</Text>
                {wo.assets.location_text ? (
                  <Text style={styles.assetSub}>{wo.assets.location_text}</Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {/* Photos */}
        <View>
          <SectionHeader
            title={t("workOrders.photos")}
            hint={photos.length > 0 ? String(photos.length) : undefined}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
            {photos.map((photo: WorkOrderPhoto) => {
              const url = workOrderPhotoUrl(photo);
              return url ? (
                <Image key={photo.id} source={{ uri: url }} style={styles.photoThumb} />
              ) : null;
            })}
            {wo.status !== "completed" && wo.status !== "cancelled" ? (
              <TouchableOpacity
                style={[styles.photoAdd, (!isOnline || busy === "photo") && styles.disabled]}
                onPress={handleAddPhoto}
                disabled={!isOnline || busy === "photo"}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t("workOrders.addPhoto")}
              >
                {busy === "photo" ? (
                  <ActivityIndicator size="small" color={C.accent} />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={19} color={C.accent} />
                    <Text style={styles.photoAddText}>{t("workOrders.addPhoto")}</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : photos.length === 0 ? (
              <Text style={styles.photoEmpty}>{t("workOrders.noPhotos")}</Text>
            ) : null}
          </ScrollView>
        </View>

        {/* Activity trail */}
        <View>
          <SectionHeader title={t("workOrders.activity")} />
          <View style={styles.card}>
            {comments.length === 0 ? (
              <Text style={styles.activityEmpty}>{t("workOrders.noActivity")}</Text>
            ) : (
              comments.map((entry: WorkOrderComment, index: number) => {
                const age = minutesSince(entry.created_at, now);
                return (
                  <View key={entry.id} style={[styles.activityRow, index > 0 && styles.activityBorder]}>
                    <View style={[styles.activityDot, entry.is_system && styles.activityDotSystem]} />
                    <View style={styles.activityBody}>
                      <Text style={[styles.activityText, entry.is_system && styles.activityTextSystem]}>
                        {entry.comment}
                      </Text>
                      {age != null ? (
                        <Text style={styles.activityTime}>
                          {t("workOrders.ago", { time: formatDuration(age) })}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
            <View style={styles.composer}>
              <TextInput
                style={styles.composerInput}
                placeholder={t("workOrders.commentPlaceholder")}
                placeholderTextColor={C.ink4}
                value={comment}
                onChangeText={setComment}
                editable={isOnline}
                testID="wo-comment-input"
              />
              <TouchableOpacity
                style={[styles.composerSend, (!isOnline || !comment.trim() || busy === "comment") && styles.disabled]}
                onPress={handleAddComment}
                disabled={!isOnline || !comment.trim() || busy === "comment"}
                accessibilityRole="button"
                accessibilityLabel={t("workOrders.sendComment")}
              >
                {busy === "comment" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="arrow-up" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {(canComplete || (wo.status === "in_progress" && isMine)) && wo.priority !== "urgent" ? (
          <Button
            label={t("workOrders.escalate")}
            onPress={handleEscalate}
            loading={busy === "escalate"}
            disabled={busy === "escalate"}
            variant="destructive"
            size="sm"
            icon="alert-circle-outline"
          />
        ) : null}

        {/* Wrap-up — completion notes & parts */}
        {showWrapUp ? (
          <View>
            <SectionHeader title={t("workOrders.wrapUp")} />
            <View style={[styles.card, styles.wrapUpCard]}>
              <Text style={styles.fieldLabel}>{t("workOrders.notesLabel")}</Text>
              <TextInput
                testID="completion-notes"
                style={styles.notesInput}
                multiline
                numberOfLines={3}
                placeholder={t("workOrders.completionPlaceholder")}
                placeholderTextColor={C.ink4}
                value={notes}
                onChangeText={setNotes}
              />
              <Text style={styles.fieldLabel}>{t("workOrders.partsLabel")}</Text>
              <TextInput
                testID="parts-used"
                style={styles.partsInput}
                placeholder={t("workOrders.partsPlaceholder")}
                placeholderTextColor={C.ink4}
                value={parts}
                onChangeText={setParts}
              />
            </View>
          </View>
        ) : null}

        {/* Closed-order record */}
        {wo.status === "completed" && (wo.notes || wo.parts_used) ? (
          <View>
            <SectionHeader title={t("workOrders.wrapUp")} />
            <View style={[styles.card, styles.wrapUpCard]}>
              {wo.notes ? (
                <>
                  <Text style={styles.fieldLabel}>{t("workOrders.notesLabel")}</Text>
                  <Text style={styles.recordText}>{wo.notes}</Text>
                </>
              ) : null}
              {wo.parts_used ? (
                <>
                  <Text style={styles.fieldLabel}>{t("workOrders.partsLabel")}</Text>
                  <Text style={styles.recordText}>{wo.parts_used}</Text>
                </>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {hasFooter ? (
        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          {canClaim ? (
            <Button
              label={t("workOrders.claimStart")}
              onPress={handleClaim}
              loading={busy === "claim"}
              disabled={busy === "claim"}
              variant="primary"
              size="lg"
              icon="hand-right-outline"
            />
          ) : null}

          {canComplete ? (
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[
                  styles.holdBtn,
                  { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                  (!isOnline || busy != null) && styles.disabled,
                ]}
                onPress={() => handleSetStatus("on_hold")}
                disabled={!isOnline || busy != null}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t("workOrders.hold")}
              >
                {busy === "hold" ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <Ionicons name="pause-outline" size={18} color={theme.textSecondary} />
                )}
              </TouchableOpacity>
              <Button
                label={t("workOrders.complete")}
                onPress={handleComplete}
                loading={busy === "complete"}
                disabled={busy != null}
                variant="primary"
                size="lg"
                icon="checkmark"
                style={styles.footerGrow}
              />
            </View>
          ) : null}

          {canResume ? (
            <Button
              label={t("workOrders.resume")}
              onPress={() => handleSetStatus("in_progress")}
              loading={busy === "resume"}
              disabled={!isOnline || busy != null}
              variant="primary"
              size="lg"
              icon="play-outline"
            />
          ) : null}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },

  hero: {
    paddingHorizontal: 14,
    paddingBottom: 18,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  backButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerBody: { flex: 1 },
  headerKicker: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32, gap: 16 },
  contentWithFooter: { paddingBottom: 130 },

  title: { fontSize: 24, fontWeight: "600", lineHeight: 29, marginTop: 8, paddingHorizontal: 4 },
  metaLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 9, paddingHorizontal: 4 },
  categoryTile: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  categoryText: { fontSize: 12.5, fontWeight: "700" },
  dot: { width: 3, height: 3, borderRadius: 1.5, marginHorizontal: 3 },
  roomText: { fontSize: 12.5, fontWeight: "700", fontFamily: monoFont },
  locationPlain: { fontSize: 12.5, fontWeight: "600", maxWidth: 170 },
  occupancyChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  occupancyChipText: { fontSize: 10, fontWeight: "800" },
  guestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  guestChipText: { fontSize: 10, fontWeight: "800" },

  timingCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: R.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
    marginHorizontal: 4,
  },
  timingItem: { flex: 1, gap: 3 },
  timingLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  timingValue: { fontSize: 13.5, fontWeight: "700", fontFamily: monoFont },

  noticeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  noticeText: { fontSize: 12.5 },

  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 14,
  },
  descriptionText: { color: C.ink, fontSize: 14, lineHeight: 21 },

  assetCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  assetTile: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  assetBody: { flex: 1 },
  assetName: { color: C.ink, fontSize: 14, fontWeight: "700" },
  assetSub: { color: C.ink3, fontSize: 12, marginTop: 2 },

  photoStrip: { gap: 9, alignItems: "center", paddingRight: 8 },
  photoThumb: { width: 86, height: 86, borderRadius: 12, backgroundColor: C.surface3 },
  photoAdd: {
    width: 86,
    height: 86,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: C.accentLine,
    backgroundColor: C.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  photoAddText: { color: C.accent, fontSize: 10.5, fontWeight: "700" },
  photoEmpty: { color: C.ink4, fontSize: 12.5 },

  activityEmpty: { color: C.ink4, fontSize: 13 },
  activityRow: { flexDirection: "row", gap: 10, paddingVertical: 9 },
  activityBorder: { borderTopWidth: 1, borderTopColor: C.line2 },
  activityDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.accent, marginTop: 5 },
  activityDotSystem: { backgroundColor: C.ink4 },
  activityBody: { flex: 1, gap: 2 },
  activityText: { color: C.ink, fontSize: 13.5, lineHeight: 19 },
  activityTextSystem: { color: C.ink3, fontStyle: "italic" },
  activityTime: { color: C.ink4, fontSize: 11, fontFamily: monoFont },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  composerInput: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 11,
    backgroundColor: C.surface2,
    paddingHorizontal: 12,
    color: C.ink,
    fontSize: 13.5,
  },
  composerSend: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  wrapUpCard: { gap: 8 },
  fieldLabel: { color: C.ink3, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  notesInput: {
    minHeight: 84,
    textAlignVertical: "top",
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 11,
    padding: 12,
    color: C.ink,
    fontSize: 14,
  },
  partsInput: {
    minHeight: 44,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 11,
    paddingHorizontal: 12,
    color: C.ink,
    fontSize: 14,
  },
  recordText: { color: C.ink, fontSize: 13.5, lineHeight: 19 },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 26,
    borderTopWidth: 1,
  },
  footerRow: { flexDirection: "row", gap: 10 },
  footerGrow: { flex: 1 },
  holdBtn: {
    width: 52,
    minHeight: 52,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.45 },
});

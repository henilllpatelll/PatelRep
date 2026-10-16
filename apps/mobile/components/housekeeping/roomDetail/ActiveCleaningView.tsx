import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { tracksLinen, type LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import type { RoomDetailView } from "@/lib/housekeeping/roomDetailState";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { buildRoomGuidance } from "@/lib/housekeeping/roomAssist";
import { resolveEstimate } from "@/lib/housekeeping/cleaningEstimate";
import { useEstimateVersion } from "@/lib/housekeeping/estimateTable";
import { CleaningChecklist } from "./CleaningChecklist";
import { CleaningTimer } from "./CleaningTimer";
import { DamagePhotoBanner } from "./DamagePhotoBanner";
import { LinenExchangeRow } from "./LinenExchange";
import { RoomGuidanceLine } from "./RoomGuidanceLine";
import { RoomHelpCard } from "./RoomHelpCard";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  room: Room;
  view: RoomDetailView;
  session: LocalCleanSession | undefined;
  ctx: TextContext;
  /** Finished or waiting on the server: nothing can be edited. */
  locked: boolean;
  placeholder: string | null;
  onToggle: (key: string, checked: boolean) => void;
  /** The Linen Exchange sheet lives on the screen so Report / More can open it too. */
  onOpenLinen: () => void;
  onReportFoundItem: () => void;
  onOpenInfo: () => void;
  /** The existing Report an issue form, offered beside Ask. */
  onReportIssue?: () => void;
}

/**
 * The task-focused screen while a clean is underway — and, for a failed
 * inspection, the correction-only reclean (the server snapshots the inspector's
 * failed items as the checklist, so it is the same session and the same rules).
 */
export function ActiveCleaningView({
  room,
  view,
  session,
  ctx,
  locked,
  placeholder,
  onToggle,
  onOpenLinen,
  onReportFoundItem,
  onOpenInfo,
  onReportIssue,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const reclean = view.kind === "reclean";
  const items = session?.checklist ?? [];
  useEstimateVersion(); // the timer's typical time follows the same estimate as the rest of the app
  const timerEstimate = resolveEstimate(room);

  const pendingKeys = useMemo(() => new Set(Object.keys(session?.pendingItems ?? {})), [session?.pendingItems]);
  const notes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const correction of room.reclean_details?.items ?? []) {
      if (correction.note) out[correction.label] = correction.note;
    }
    return out;
  }, [room.reclean_details]);

  const inspectedAt = formatClock(room.reclean_details?.inspected_at, ctx);
  const corrections = items.length;
  const guidance = buildRoomGuidance({ room, session, classification: view.classification, isNext: false });

  return (
    <View style={styles.root} testID={reclean ? "reclean-work-view" : "active-cleaning-view"}>
      {reclean ? (
        <View style={[styles.reclean, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recleanTitle, { color: theme.status.dirty }]}>
            {t("rooms.work.reclean.title")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recleanMeta, { color: theme.textPrimary }]}>
            {corrections > 0
              ? t("rooms.work.reclean.count", { count: corrections })
              : t("rooms.dash.detail.reclean.unavailable")}
            {inspectedAt ? ` · ${t("rooms.dash.detail.reclean.inspectedAt", { time: inspectedAt })}` : ""}
          </Text>
          <Pressable
            onPress={onOpenInfo}
            style={styles.inspectionLink}
            accessibilityRole="button"
            accessibilityLabel={t("rooms.work.reclean.viewInspection")}
            testID="view-inspection"
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.inspectionLinkText, { color: theme.primaryAction }]}>
              {t("rooms.work.reclean.viewInspection")}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.primaryAction} />
          </Pressable>
        </View>
      ) : (
        <CleaningTimer startedAt={session?.startedAt} baseMinutes={timerEstimate.basis === "history" ? timerEstimate.minutes : session?.baseCleanMinutes} />
      )}

      {/* The prompt says "before cleaning": once anything is ticked it is stale. */}
      {!reclean && room.clean_type === "DEP" && items.every((entry) => !entry.checked) ? <DamagePhotoBanner room={room} /> : null}

      <CleaningChecklist
        title={reclean ? t("rooms.work.reclean.checklistTitle") : t("rooms.detail.cleaningChecklist")}
        items={items}
        pendingKeys={pendingKeys}
        locked={locked}
        placeholder={placeholder}
        notes={reclean ? notes : undefined}
        onToggle={onToggle}
        onReportFoundItem={onReportFoundItem}
      />

      {!reclean && session && tracksLinen(session.cleanType ?? room.clean_type) ? (
        <LinenExchangeRow linen={session.linen} onOpen={onOpenLinen} />
      ) : null}

      {guidance ? <RoomGuidanceLine line={guidance} /> : null}
      <RoomHelpCard room={room} live variant="active" onReportIssue={onReportIssue} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  reclean: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 6 },
  recleanTitle: { fontSize: 14, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  recleanMeta: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  inspectionLink: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4 },
  inspectionLinkText: { fontSize: 14, fontWeight: "800" },
});

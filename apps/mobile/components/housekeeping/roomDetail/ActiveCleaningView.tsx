import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { tracksLinen, type LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import type { RoomDetailView } from "@/lib/housekeeping/roomDetailState";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { CleaningChecklist } from "./CleaningChecklist";
import { CleaningTimer } from "./CleaningTimer";
import { DamagePhotoBanner } from "./DamagePhotoBanner";
import { LinenExchangeRow, LinenExchangeSheet } from "./LinenExchange";
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
  onSaveLinen: (counts: { dirtyOut: number; cleanIn: number }) => Promise<void>;
  onReportFoundItem: () => void;
  onOpenInfo: () => void;
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
  onSaveLinen,
  onReportFoundItem,
  onOpenInfo,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [linenOpen, setLinenOpen] = useState(false);
  const reclean = view.kind === "reclean";
  const items = session?.checklist ?? [];

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
        <CleaningTimer startedAt={session?.startedAt} baseMinutes={session?.baseCleanMinutes} />
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
        <>
          <LinenExchangeRow linen={session.linen} onOpen={() => setLinenOpen(true)} />
          <LinenExchangeSheet
            visible={linenOpen}
            roomNumber={room.room_number}
            linen={session.linen}
            locked={locked}
            onSave={onSaveLinen}
            onClose={() => setLinenOpen(false)}
          />
        </>
      ) : null}
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

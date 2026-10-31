import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { ChoiceChips, FieldLabel, InlineError, LineInput, Note } from "@/components/engineering/workorder/sheetKit";
import { fetchRoomBoard } from "@/lib/api/engineeringRooms";
import { LOCATION_SUGGESTIONS, LOCATION_TEXT_MAX, type RecentLocation, type ReportLocation } from "@/lib/engineering/reportIssue";
import type { RoomBoardRow } from "@/lib/engineering/roomModel";

interface Props {
  visible: boolean;
  current: ReportLocation | null;
  recent: readonly RecentLocation[];
  isOnline: boolean;
  onSelect: (location: ReportLocation) => void;
  onClose: () => void;
}

type Tab = "room" | "other";

function describe(location: ReportLocation, t: (key: string, options?: Record<string, unknown>) => string): string {
  return location.kind === "room" ? t("report.location.roomLabel", { room: location.roomNumber }) : location.text;
}

/**
 * Where is the problem? A guest room (searched on the server across the whole hotel) or free text for anywhere else.
 * PatelRep has no configured list of public areas, so the suggestions are only text you can tap to fill in.
 */
export function LocationSheet({ visible, current, recent, isOnline, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>(current?.kind === "other" ? "other" : "room");
  const [query, setQuery] = useState("");
  const [rooms, setRooms] = useState<RoomBoardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState(current?.kind === "other" ? current.text : "");
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setTab(current?.kind === "other" ? "other" : "room");
      setQuery("");
      setText(current?.kind === "other" ? current.text : "");
    }
    wasVisible.current = visible;
  }, [visible, current]);

  // Server-side search, debounced. A newer keystroke cancels the older request, so a slow answer never overwrites a fresh one.
  useEffect(() => {
    if (!visible || tab !== "room" || !isOnline) return;
    const abort = new AbortController();
    setLoading(true);
    const id = setTimeout(() => {
      fetchRoomBoard({ q: query.trim() || undefined }, 1, abort.signal)
        .then((page) => {
          if (abort.signal.aborted) return;
          setRooms(page.rows);
          setTotal(page.total);
          setFailed(false);
        })
        .catch(() => {
          if (!abort.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(id);
      abort.abort();
    };
  }, [visible, tab, query, isOnline]);

  const choose = (location: ReportLocation) => {
    onSelect(location);
    onClose();
  };

  return (
    <BottomSheet visible={visible} title={t("report.location.title")} onClose={onClose} tall testID="report-location-sheet">
      <View style={styles.stack}>
        <ChoiceChips
          options={[
            { value: "room" as Tab, label: t("report.location.tabRoom") },
            { value: "other" as Tab, label: t("report.location.tabOther") },
          ]}
          value={tab}
          onChange={setTab}
          testIDPrefix="report-location-tab"
        />

        {recent.length > 0 ? (
          <View style={styles.stack}>
            <FieldLabel>{t("report.location.recent")}</FieldLabel>
            <View style={styles.wrap}>
              {recent.map((location, index) => (
                <Pressable
                  key={`${location.kind}-${location.kind === "room" ? location.roomId : location.text}-${index}`}
                  onPress={() => choose(location)}
                  accessibilityRole="button"
                  accessibilityLabel={t("report.location.useRecent", { place: describe(location, t) })}
                  style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                  testID={`report-location-recent-${index}`}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: theme.textPrimary }]} numberOfLines={1}>
                    {describe(location, t)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {tab === "room" ? (
          <View style={styles.stack}>
            <LineInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("report.location.searchRooms")}
              accessibilityLabel={t("report.location.searchRooms")}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={100}
              testID="report-location-search"
            />
            {!isOnline ? <Note tone="warn" testID="report-location-offline">{t("report.location.offlineRooms")}</Note> : null}
            {loading ? <ActivityIndicator color={theme.primaryAction} accessibilityLabel={t("common.loading")} /> : null}
            {failed ? <InlineError>{t("report.location.roomsFailed")}</InlineError> : null}
            {!loading && !failed && isOnline && rooms.length === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5 }}>
                {t("report.location.noRooms")}
              </Text>
            ) : null}
            {rooms.map((room) => {
              const selected = current?.kind === "room" && current.roomId === room.id;
              return (
                <Pressable
                  key={room.id}
                  onPress={() => choose({ kind: "room", roomId: room.id, roomNumber: room.room_number, floor: room.floor })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`report-location-room-${room.room_number}`}
                  style={[styles.room, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle }]}
                >
                  <View style={styles.roomBody}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
                      {t("report.location.roomLabel", { room: room.room_number })}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }} numberOfLines={1}>
                      {[room.floor != null ? t("engRooms.floorHeader", { floor: room.floor }) : null, room.building, room.availability ? t(`engRooms.availability.${room.availability}`) : null].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.primaryAction} /> : null}
                </Pressable>
              );
            })}
            {total > rooms.length ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }}>
                {t("report.location.moreRooms", { shown: rooms.length, total })}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.stack}>
            <FieldLabel>{t("report.location.otherLabel")}</FieldLabel>
            <LineInput
              value={text}
              onChangeText={setText}
              placeholder={t("report.location.otherPlaceholder")}
              accessibilityLabel={t("report.location.otherLabel")}
              maxLength={LOCATION_TEXT_MAX}
              testID="report-location-text"
            />
            <View style={styles.wrap}>
              {LOCATION_SUGGESTIONS.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setText(t(`report.location.suggestions.${key}`))}
                  accessibilityRole="button"
                  style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                  testID={`report-location-suggestion-${key}`}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color: theme.textPrimary }]}>
                    {t(`report.location.suggestions.${key}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Button
              label={t("report.location.useThis")}
              onPress={() => choose({ kind: "other", text: text.trim() })}
              disabled={!text.trim()}
              testID="report-location-use-text"
            />
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center", maxWidth: "100%" },
  pillText: { fontSize: 14, fontWeight: "600" },
  room: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  roomBody: { flex: 1, minWidth: 0 },
  roomNumber: { fontSize: 16, fontWeight: "700" },
});

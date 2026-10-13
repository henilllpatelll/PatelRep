import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Chip, ChipRow, FieldError, FieldLabel, inputStyle } from "@/components/tasks/addTask/formBits";
import type { RoomOption } from "@/lib/api/tasks";
import { useTheme } from "@/lib/theme/useTheme";
import { ADD_TASK_LIMITS, type LocationDraft } from "@/lib/tasks/addTask/draft";
import { findRoomByNumber, searchRooms, type RoomDirectoryStatus } from "@/lib/tasks/addTask/rooms";

interface Props {
  location: LocationDraft;
  rooms: RoomOption[];
  roomsStatus: RoomDirectoryStatus;
  onReloadRooms: () => void;
  onChoose: (location: LocationDraft) => void;
  onBack: () => void;
}

/**
 * Where the task is. A room can only be one of this hotel's own rooms (picked from the list); a
 * general place is plain text and is never treated as a room. A room number the AI heard but could
 * not verify starts here as a search, so the person corrects it rather than the app guessing.
 */
export function LocationEditor({ location, rooms, roomsStatus, onReloadRooms, onChoose, onBack }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [tab, setTab] = useState<"room" | "place">(location.kind === "place" ? "place" : "room");
  const [query, setQuery] = useState(location.kind === "unverified" ? location.text : "");
  const [place, setPlace] = useState(location.kind === "place" ? location.text : "");

  const matches = searchRooms(rooms, query);
  const exact = findRoomByNumber(rooms, query);
  const placeText = place.trim();
  const placeError = placeText.length > ADD_TASK_LIMITS.place ? t("tasks.hk.add.error.location.placeTooLong", { max: ADD_TASK_LIMITS.place }) : null;

  return (
    <View style={styles.wrap} testID="add-task-location-editor">
      <ChipRow label={t("tasks.hk.add.field.location")}>
        <Chip label={t("tasks.hk.add.room.tabRoom")} selected={tab === "room"} onPress={() => setTab("room")} testID="location-tab-room" />
        <Chip label={t("tasks.hk.add.room.tabPlace")} selected={tab === "place"} onPress={() => setTab("place")} testID="location-tab-place" />
      </ChipRow>

      {tab === "room" ? (
        <View style={styles.wrap}>
          {location.kind === "unverified" ? (
            <FieldError message={t("tasks.hk.add.error.location.unverified", { text: location.text })} testID="location-unverified" />
          ) : null}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("tasks.hk.add.room.search")}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t("tasks.hk.add.room.searchA11y")}
            autoCorrect={false}
            autoCapitalize="characters"
            style={[inputStyle, { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
            testID="room-search"
          />
          {roomsStatus === "loading" || roomsStatus === "idle" ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
              {t("tasks.hk.add.room.loading")}
            </Text>
          ) : roomsStatus === "error" ? (
            <View style={styles.wrap}>
              <FieldError message={t("tasks.hk.add.room.loadFailed")} />
              <Button label={t("common.retry")} onPress={onReloadRooms} variant="secondary" icon="refresh" testID="room-reload" />
            </View>
          ) : matches.length === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="room-empty">
              {t("tasks.hk.add.room.empty", { query: query.trim() })}
            </Text>
          ) : (
            <View style={styles.list} accessibilityRole="list">
              {matches.map((room) => {
                const selected = location.kind === "room" && location.roomId === room.id;
                const highlighted = exact?.id === room.id;
                return (
                  <Pressable
                    key={room.id}
                    onPress={() => onChoose({ kind: "room", roomId: room.id, roomNumber: room.room_number })}
                    accessibilityRole="button"
                    accessibilityLabel={
                      room.floor !== null
                        ? `${t("tasks.hk.add.room.selectRoom", { room: room.room_number })}, ${t("tasks.hk.add.room.floor", { floor: room.floor })}`
                        : t("tasks.hk.add.room.selectRoom", { room: room.room_number })
                    }
                    accessibilityState={{ selected }}
                    testID={`room-option-${room.room_number}`}
                    style={[
                      styles.roomRow,
                      {
                        backgroundColor: selected || highlighted ? theme.surfaceSubtle : theme.surface,
                        borderColor: selected ? theme.primaryAction : theme.borderSubtle,
                      },
                    ]}
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
                      {t("tasks.hk.add.room.selectRoom", { room: room.room_number })}
                    </Text>
                    {room.floor !== null ? (
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomMeta, { color: theme.textMuted }]}>
                        {t("tasks.hk.add.room.floor", { floor: room.floor })}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.wrap}>
          <FieldLabel>{t("tasks.hk.add.room.placeLabel")}</FieldLabel>
          <TextInput
            value={place}
            onChangeText={setPlace}
            placeholder={t("tasks.hk.add.room.placePlaceholder")}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t("tasks.hk.add.room.placeLabel")}
            maxLength={ADD_TASK_LIMITS.place + 20}
            style={[inputStyle, { color: theme.textPrimary, backgroundColor: theme.surfaceSubtle, borderColor: placeError ? theme.status.dirty : theme.borderSubtle }]}
            testID="place-input"
          />
          <FieldError message={placeError} />
          <Button
            label={t("tasks.hk.add.room.usePlace")}
            onPress={() => onChoose({ kind: "place", text: placeText })}
            disabled={!placeText || !!placeError}
            testID="place-use"
          />
        </View>
      )}

      <View style={styles.footer}>
        {location.kind !== "none" ? (
          <Button label={t("tasks.hk.add.room.remove")} onPress={() => onChoose({ kind: "none" })} variant="secondary" testID="location-clear" />
        ) : null}
        <Button label={t("common.back")} onPress={onBack} variant="ghost" testID="location-back" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  list: { gap: 6 },
  note: { fontSize: 13.5, lineHeight: 19 },
  roomRow: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  roomNumber: { fontSize: 15.5, fontWeight: "700" },
  roomMeta: { fontSize: 12.5, fontWeight: "600" },
  footer: { gap: 6, paddingTop: 4 },
});

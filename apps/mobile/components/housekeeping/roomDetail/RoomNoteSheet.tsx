import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";
import { FieldLabel, StatusText, TextArea } from "./FormBits";

/** Matches the API's bound on a room note. */
export const ROOM_NOTE_MAX = 1000;

interface HistoryRow {
  id?: string;
  from_status?: string;
  to_status?: string;
  notes?: string | null;
  created_at?: string;
  actor_name?: string | null;
}

export interface SavedNote {
  key: string;
  text: string;
  author: string | null;
  at: string | null;
}

/** Note-only history entries (status unchanged) with text, newest first. */
export function pickSavedNotes(rows: HistoryRow[]): SavedNote[] {
  return rows
    .filter((row) => row.notes?.trim() && row.from_status === row.to_status)
    .map((row, index) => ({
      key: row.id ?? `${row.created_at ?? "n"}-${index}`,
      text: row.notes!.trim(),
      author: row.actor_name?.trim() || null,
      at: row.created_at ?? null,
    }));
}

interface Props {
  visible: boolean;
  room: Room;
  isOnline: boolean;
  ctx: TextContext;
  saving: boolean;
  /** Resolves true when the server stored the note. */
  onSave: (text: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Add a note for the team. Notes are online-only: a note "saved" on the device
 * alone would be invisible to everyone else, so offline the draft is kept and the
 * button explains why it can't send. The draft survives a failed save.
 */
export function RoomNoteSheet({ visible, room, isOnline, ctx, saving, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<SavedNote[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const requestClose = useDiscardGuard({ dirty: text.trim() !== "", busy: saving, onClose, onDiscard: () => setText("") });

  const load = useCallback(async () => {
    if (!isOnline) return;
    setLoadFailed(false);
    try {
      const res = await api.get<{ data: HistoryRow[] }>(`/rooms/${room.id}/history?limit=50`);
      setNotes(pickSavedNotes(res.data ?? []).slice(0, 5));
    } catch {
      setLoadFailed(true);
    }
  }, [isOnline, room.id]);

  // Saved notes load when the sheet opens, not with the Room Detail screen.
  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  async function save() {
    if (saving || !text.trim()) return;
    if (await onSave(text)) {
      setText("");
      await load();
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("rooms.work.note.title", { room: room.room_number })}
      onClose={requestClose}
      testID="note-sheet"
      footer={
        <>
          {!isOnline ? <StatusText tone="warn" message={t("rooms.work.note.needsConnection")} testID="note-offline" /> : null}
          <Button
            label={t("rooms.detailActions.saveNote")}
            icon="send"
            onPress={() => void save()}
            loading={saving}
            disabled={saving || !isOnline || !text.trim()}
            size="lg"
            testID="note-save"
          />
        </>
      }
    >
      <FieldLabel>{t("rooms.work.note.label")}</FieldLabel>
      <TextArea
        label={t("rooms.detailActions.addNote")}
        value={text}
        onChangeText={setText}
        max={ROOM_NOTE_MAX}
        placeholder={t("rooms.detailActions.notePlaceholder")}
        editable={!saving}
        testID="note-input"
      />

      <FieldLabel>{t("rooms.work.note.recent")}</FieldLabel>
      {!isOnline ? (
        <StatusText message={t("rooms.work.note.recentOffline")} />
      ) : loadFailed ? (
        <StatusText tone="error" message={t("rooms.work.note.loadFailed")} />
      ) : notes === null ? (
        <StatusText message={t("common.loading")} />
      ) : notes.length === 0 ? (
        <StatusText message={t("rooms.work.note.none")} testID="note-none" />
      ) : (
        notes.map((note) => {
          const when = formatClock(note.at, ctx);
          const byline = [note.author, when].filter(Boolean).join(" · ");
          return (
            <View
              key={note.key}
              accessible
              accessibilityLabel={`${byline ? `${byline}. ` : ""}${note.text}`}
              style={[styles.note, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}
              testID="note-saved"
            >
              {byline ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.byline, { color: theme.textMuted }]}>
                  {byline}
                </Text>
              ) : null}
              {/* Plain Text keeps the author's line breaks and never interprets markup. */}
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textPrimary }]}>
                {note.text}
              </Text>
            </View>
          );
        })
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  byline: { fontSize: 12, fontWeight: "700" },
  noteText: { fontSize: 14, lineHeight: 20 },
});

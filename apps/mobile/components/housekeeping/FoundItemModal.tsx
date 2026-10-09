import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { createLostFoundItem, uploadLostFoundPhoto } from "@/lib/api/lostFound";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { prepareForUpload } from "@/lib/housekeeping/photo";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { BottomSheet, MAX_FONT_SCALE } from "./roomDetail/BottomSheet";
import { FieldError, FieldLabel, StatusText, TextArea } from "./roomDetail/FormBits";
import { PhotoAttachment } from "./roomDetail/PhotoAttachment";

/** The API accepts up to 2000; a found-item line never needs it. */
const DESCRIPTION_MAX = 500;

interface FoundItemModalProps {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  onClose: () => void;
}

/**
 * Report a found item into the hotel's real Lost & Found list (POST /lost-found:
 * room, finder and tenant come from the session). Online only — an item that is
 * "reported" from a phone with no signal would not exist for the desk. A photo that
 * uploaded is remembered, so retrying a failed submit never uploads it twice, and
 * a photo that failed is never silently dropped.
 */
export default function FoundItemModal({ visible, roomId, roomNumber, onClose }: FoundItemModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const isOnline = useAppStore((state) => state.isOnline);

  const [description, setDescription] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const uploaded = useRef<{ source: string; url: string } | null>(null);
  const busyRef = useRef(false);

  const dirty = description.trim() !== "" || photoUri !== null;

  function reset() {
    setDescription("");
    setPhotoUri(null);
    setError(null);
    setPhotoError(false);
    uploaded.current = null;
  }

  const requestClose = useDiscardGuard({ dirty, busy: submitting, onClose, onDiscard: reset });

  async function submit() {
    if (busyRef.current) return;
    if (!description.trim()) {
      setError(t("foundItem.errors.description"));
      return;
    }
    if (!isOnline) return;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    setPhotoError(false);
    try {
      let photoUrl: string | undefined;
      if (photoUri) {
        if (uploaded.current?.source === photoUri) {
          photoUrl = uploaded.current.url;
        } else {
          try {
            photoUrl = await uploadLostFoundPhoto(await prepareForUpload(photoUri));
            uploaded.current = { source: photoUri, url: photoUrl };
          } catch {
            // Nothing was created yet: keep the draft and let them retry or remove the photo.
            setPhotoError(true);
            return;
          }
        }
      }
      try {
        await createLostFoundItem({
          description: description.trim(),
          room_id: roomId,
          location_found: `Room ${roomNumber}`,
          photo_url: photoUrl,
        });
      } catch {
        // The server also ignores an identical report from the same person within minutes.
        setError(t("foundItem.submitError"));
        return;
      }
      toast.success(t("foundItem.submitted"));
      reset();
      onClose();
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("foundItem.title")}
      onClose={requestClose}
      testID="found-sheet"
      footer={
        <>
          {!isOnline ? <StatusText tone="warn" message={t("foundItem.offlineError")} testID="found-offline" /> : null}
          <Button
            label={t("foundItem.submit")}
            onPress={() => void submit()}
            loading={submitting}
            disabled={submitting || !isOnline || !description.trim()}
            size="lg"
            testID="found-submit"
          />
        </>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textSecondary }]}>
        {t("foundItem.room", { room: roomNumber })}
      </Text>

      <FieldLabel required>{t("foundItem.whatFound")}</FieldLabel>
      <TextArea
        label={t("foundItem.whatFound")}
        value={description}
        onChangeText={(next) => {
          setDescription(next);
          setError(null);
        }}
        max={DESCRIPTION_MAX}
        placeholder={t("foundItem.descriptionPlaceholder")}
        editable={!submitting}
        invalid={Boolean(error)}
        testID="found-description"
      />
      <FieldError message={error} testID="found-error" />

      <FieldLabel>{t("foundItem.photo")}</FieldLabel>
      <PhotoAttachment
        uri={photoUri}
        onChange={(next) => {
          setPhotoUri(next);
          setPhotoError(false);
        }}
        disabled={submitting || !isOnline}
        testIDPrefix="found-photo"
      />
      {photoError ? <FieldError message={t("foundItem.photoError")} testID="found-photo-error" /> : null}

      <View style={[styles.reminder, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]} accessible accessibilityLabel={`${t("foundItem.reminderTitle")}. ${t("foundItem.reminderBody")}`}>
        <Ionicons name="shield-checkmark-outline" size={20} color={theme.status.pickup} />
        <View style={styles.reminderCopy}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reminderTitle, { color: theme.textPrimary }]}>
            {t("foundItem.reminderTitle")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reminderBody, { color: theme.textSecondary }]}>
            {t("foundItem.reminderBody")}
          </Text>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  room: { fontSize: 14, fontWeight: "700" },
  reminder: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  reminderCopy: { flex: 1, gap: 2 },
  reminderTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  reminderBody: { fontSize: 14, lineHeight: 20 },
});

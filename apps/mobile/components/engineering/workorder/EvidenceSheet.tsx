import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { pickPhoto, prepareForUpload, type PhotoPick, type PhotoSource } from "@/lib/housekeeping/photo";
import { workOrderPhotoUrl } from "@/lib/api/workOrders";
import type { PhotoType } from "@/lib/engineering/repairWorkspace";
import type { WorkOrderPhoto } from "@/lib/engineering/workOrders";
import { ChoiceChips, FieldLabel, InlineError, LineInput, Note, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

type Failure = Extract<PhotoPick, { ok: false }>["reason"];

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  canAdd: boolean;
  photos: readonly WorkOrderPhoto[];
  /** Uploads one prepared photo. Must honour `signal` so Cancel really stops the request. */
  onAttach: (input: { uri: string; photoType: PhotoType; caption: string; signal: AbortSignal }) => Promise<void>;
}

/**
 * Evidence: a photo with the API's three types (before / progress / after) and an optional caption. Files are
 * uploaded straight away — they are not queued offline, because a queued file could not be kept safely until
 * sync — so adding evidence needs a connection. A failed or cancelled upload keeps the chosen photo for a retry.
 */
export function EvidenceSheet({ visible, onClose, online, canAdd, photos, onAttach }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [photoType, setPhotoType] = useState<PhotoType>("progress");
  const [caption, setCaption] = useState("");
  const [pickFailure, setPickFailure] = useState<Failure | null>(null);
  const { busy, error, run } = useSheetSubmit();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function pick(source: PhotoSource) {
    setPickFailure(null);
    const result = await pickPhoto(source);
    if (result.ok) setUri(result.uri);
    else if (result.reason !== "cancelled") setPickFailure(result.reason);
  }

  async function attach() {
    if (!uri) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const ok = await run(async () => {
      const prepared = await prepareForUpload(uri);
      await onAttach({ uri: prepared, photoType, caption: caption.trim(), signal: ctl.signal });
    });
    abort.current = null;
    if (ok) {
      setUri(null);
      setCaption("");
      setPhotoType("progress");
    }
  }

  const existing = photos.map((photo) => ({ photo, url: workOrderPhotoUrl(photo) }));

  return (
    <BottomSheet
      visible={visible}
      title={t("workOrders.repair.evidence.title")}
      onClose={onClose}
      tall
      testID="wo-evidence-sheet"
      footer={
        uri ? (
          <View style={sheetStyles.stack}>
            <Button label={t("workOrders.repair.evidence.attach")} onPress={attach} loading={busy} disabled={!online || busy} size="lg" testID="wo-evidence-attach" />
            {busy ? <Button label={t("common.cancel")} variant="ghost" onPress={() => abort.current?.abort()} testID="wo-evidence-cancel" /> : null}
          </View>
        ) : undefined
      }
    >
      <View style={sheetStyles.stack}>
        {canAdd ? (
          <>
            {uri ? (
              <View style={{ gap: 8 }}>
                <Image source={{ uri }} style={{ width: "100%", height: 200, borderRadius: 12, backgroundColor: theme.surfaceMuted }} accessibilityLabel={t("workOrders.repair.evidence.preview")} />
                <Button label={t("workOrders.repair.evidence.remove")} variant="ghost" size="sm" icon="trash-outline" onPress={() => setUri(null)} disabled={busy} testID="wo-evidence-remove" />
                <FieldLabel>{t("workOrders.repair.evidence.type")}</FieldLabel>
                <ChoiceChips
                  options={(["before", "progress", "after"] as const).map((value) => ({ value, label: t(`workOrders.repair.evidence.types.${value}`) }))}
                  value={photoType}
                  onChange={setPhotoType}
                  testIDPrefix="wo-evidence-type"
                  disabled={busy}
                />
                <FieldLabel>{t("workOrders.repair.evidence.caption")}</FieldLabel>
                <LineInput value={caption} onChangeText={setCaption} editable={!busy} maxLength={300} testID="wo-evidence-caption" accessibilityLabel={t("workOrders.repair.evidence.caption")} />
                {busy ? (
                  <View style={sheetStyles.row} accessibilityLiveRegion="polite">
                    <ActivityIndicator color={theme.primaryAction} />
                    <Text style={{ color: theme.textMuted }}>{t("workOrders.repair.evidence.uploading")}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={sheetStyles.stack}>
                <Button label={t("workOrders.repair.evidence.takePhoto")} icon="camera-outline" size="lg" onPress={() => void pick("camera")} disabled={!online} testID="wo-evidence-camera" />
                <Button label={t("workOrders.repair.evidence.library")} icon="images-outline" variant="secondary" size="lg" onPress={() => void pick("gallery")} disabled={!online} testID="wo-evidence-library" />
              </View>
            )}
            {!online ? <Note>{t("workOrders.repair.evidence.needsConnection")}</Note> : null}
            {pickFailure ? <InlineError>{t(`workOrders.repair.evidence.pick.${pickFailure}`)}</InlineError> : null}
            {error ? <InlineError>{error}</InlineError> : null}
          </>
        ) : null}

        <FieldLabel>{t("workOrders.repair.evidence.existing", { count: existing.length })}</FieldLabel>
        {existing.length === 0 ? (
          <Text style={{ color: theme.textDisabled, fontSize: 13.5 }}>{t("workOrders.noPhotos")}</Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {existing.map(({ photo, url }) => (
              <View key={photo.id} style={{ width: 96, gap: 3 }}>
                {url ? (
                  <Image source={{ uri: url }} style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: theme.surfaceMuted }} accessibilityLabel={photo.caption || t(`workOrders.repair.evidence.types.${photo.photo_type ?? "progress"}`)} />
                ) : null}
                <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: 11.5 }}>
                  {t(`workOrders.repair.evidence.types.${photo.photo_type ?? "progress"}`)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

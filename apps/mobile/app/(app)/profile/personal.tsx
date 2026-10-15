import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/shared/mobileHandoff";
import { EditFieldSheet } from "@/components/settings/EditFieldSheet";
import { PhotoActionsSheet } from "@/components/settings/PhotoActionsSheet";
import { SettingsDetailRow } from "@/components/settings/SettingsDetailRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/Button";
import {
  classifyProfileError,
  removeAvatar,
  updatePreferredName,
  uploadAvatar,
  type ProfileFailure,
} from "@/lib/api/profile";
import {
  PREFERRED_NAME_MAX,
  displayNameFor,
  normalizePreferredName,
  validatePreferredName,
} from "@/lib/settings/displayName";
import { useOwnProfile } from "@/lib/settings/useOwnProfile";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore } from "@/stores/appStore";
import { runWithoutAppLock } from "@/stores/appLockStore";

const MAX_FONT_SCALE = 1.4;
const AVATAR_SIZE = 96;
const UNKNOWN = "—";

export default function PersonalInformationScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const { user, isOnline } = useAppStore();
  const { roleLabel, hotelName } = useSettingsIdentity();
  const { profile, status, reload, adopt } = useOwnProfile();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [photoBusy, setPhotoBusy] = useState<"uploading" | "removing" | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSessionEmail(data.session?.user?.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const shownName = displayNameFor(user) || t("settings.staffFallback");
  const fullName = user?.full_name?.trim() || UNKNOWN;
  const preferredName = user?.preferred_name?.trim() ?? "";
  const email = profile?.email ?? sessionEmail ?? UNKNOWN;
  const property = profile?.hotel_name ?? hotelName ?? UNKNOWN;
  const photoUri = profile?.avatar_url ?? user?.avatar_url ?? null;
  const hasUploadedPhoto = profile?.has_uploaded_avatar ?? false;
  const canEdit = isOnline && !photoBusy;

  const failureText = (failure: ProfileFailure) => t(`settings.personal.errors.${failure}`);

  async function saveName(value: string) {
    try {
      adopt(await updatePreferredName(value));
    } catch (err) {
      throw new Error(failureText(classifyProfileError(err)));
    }
    toast.success(t("settings.personal.saved"));
  }

  async function pickAndUpload(source: "library" | "camera") {
    setPhotoSheet(false);
    // iOS cannot present the native picker while the sheet's modal is still dismissing.
    if (Platform.OS === "ios") await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      let result: ImagePicker.ImagePickerResult;
      const options = { allowsEditing: true, aspect: [1, 1] as [number, number], quality: 1 };
      if (source === "camera") {
        const permission = await runWithoutAppLock(() => ImagePicker.requestCameraPermissionsAsync());
        if (!permission.granted) {
          toast.error(t("settings.personal.cameraDenied"));
          return;
        }
        result = await runWithoutAppLock(() => ImagePicker.launchCameraAsync(options));
      } else {
        result = await runWithoutAppLock(() => ImagePicker.launchImageLibraryAsync(options));
      }
      const picked = result.assets?.[0]?.uri;
      if (result.canceled || !picked) return;

      setPhotoBusy("uploading");
      // 512px JPEG keeps the avatar sharp at 96pt on 3x screens and well under the 2 MB server limit.
      const resized = await ImageManipulator.manipulateAsync(picked, [{ resize: { width: 512 } }], {
        compress: 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      adopt(await uploadAvatar(resized.uri));
      toast.success(t("settings.personal.photoUpdated"));
    } catch (err) {
      toast.error(failureText(classifyProfileError(err)));
    } finally {
      setPhotoBusy(null);
    }
  }

  async function removePhoto() {
    setPhotoSheet(false);
    setPhotoBusy("removing");
    try {
      adopt(await removeAvatar());
      toast.success(t("settings.personal.photoRemoved"));
    } catch (err) {
      toast.error(failureText(classifyProfileError(err)));
    } finally {
      setPhotoBusy(null);
    }
  }

  return (
    <SettingsScreen title={t("settings.personal.title")} back>
      <View style={styles.photoBlock}>
        <Pressable
          onPress={canEdit ? () => setPhotoSheet(true) : undefined}
          accessibilityRole="button"
          accessibilityLabel={t("settings.personal.photoA11y")}
          accessibilityState={{ disabled: !canEdit, busy: !!photoBusy }}
          style={styles.avatarPress}
          testID="photo-edit"
        >
          <Avatar name={shownName} size={AVATAR_SIZE} uri={photoUri} />
          {photoBusy ? (
            <View style={[styles.busyOverlay, { backgroundColor: theme.background }]}>
              <ActivityIndicator color={theme.primaryAction} />
            </View>
          ) : (
            <View style={[styles.cameraBadge, { backgroundColor: theme.primaryAction, borderColor: theme.background }]}>
              <Ionicons name="camera" size={14} color={theme.onPrimary} />
            </View>
          )}
        </Pressable>
        {photoBusy ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.photoLink, { color: theme.textMuted }]} testID="photo-status">
            {t(photoBusy === "uploading" ? "settings.personal.uploading" : "settings.personal.removing")}
          </Text>
        ) : (
          <Pressable
            onPress={canEdit ? () => setPhotoSheet(true) : undefined}
            disabled={!canEdit}
            accessibilityRole="button"
            accessibilityLabel={t("settings.personal.changePhoto")}
            accessibilityState={{ disabled: !canEdit }}
            hitSlop={8}
            style={styles.photoLinkPress}
            testID="photo-change"
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.photoLink, { color: canEdit ? theme.primary : theme.textDisabled }]}
            >
              {t("settings.personal.changePhoto")}
            </Text>
          </Pressable>
        )}
      </View>

      {!isOnline ? (
        <View
          style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
          accessibilityRole="alert"
          testID="personal-offline"
        >
          <Ionicons name="cloud-offline-outline" size={18} color={theme.textMuted} />
          <View style={styles.noticeText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeTitle, { color: theme.textPrimary }]}>
              {t("settings.personal.connectionRequired")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeBody, { color: theme.textSecondary }]}>
              {t("settings.personal.connectionRequiredBody")}
            </Text>
          </View>
        </View>
      ) : null}

      {status === "error" ? (
        <View
          style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
          testID="personal-load-error"
        >
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeBody, styles.noticeText, { color: theme.textSecondary }]}>
            {t("settings.personal.loadFailed")}
          </Text>
          <Button label={t("common.retry")} size="sm" variant="secondary" onPress={() => void reload()} testID="personal-retry" />
        </View>
      ) : null}

      <SettingsSection>
        <SettingsDetailRow
          first
          locked
          label={t("settings.personal.fullName")}
          value={fullName}
          hint={t("settings.personal.managedByHotel")}
          testID="detail-full-name"
        />
        <SettingsDetailRow
          label={t("settings.personal.displayName")}
          value={preferredName || shownName}
          hint={t("settings.personal.editHint")}
          onPress={canEdit ? () => setEditingName(true) : undefined}
          testID="detail-display-name"
        />
        <SettingsDetailRow
          locked
          label={t("settings.personal.email")}
          value={email}
          hint={t("settings.personal.managedByHotel")}
          testID="detail-email"
        />
        <SettingsDetailRow
          locked
          label={t("settings.personal.role")}
          value={roleLabel ?? UNKNOWN}
          hint={t("settings.personal.managedByHotel")}
          testID="detail-role"
        />
        <SettingsDetailRow
          locked
          label={t("settings.personal.property")}
          value={property}
          hint={t("settings.personal.managedByHotel")}
          testID="detail-property"
        />
      </SettingsSection>

      <View style={styles.managed} testID="personal-managed-notice">
        <Ionicons name="information-circle-outline" size={18} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.managedText, { color: theme.textMuted }]}>
          {t("settings.personal.managedNotice")}
        </Text>
      </View>

      <EditFieldSheet
        visible={editingName}
        title={t("settings.personal.editDisplayName")}
        label={t("settings.personal.displayName")}
        value={preferredName || shownName}
        maxLength={PREFERRED_NAME_MAX}
        helper={t("settings.personal.displayNameHelper")}
        normalize={normalizePreferredName}
        validate={(draft) => {
          const problem = validatePreferredName(draft);
          return problem ? t(`settings.personal.nameErrors.${problem}`) : null;
        }}
        onSave={saveName}
        onClose={() => setEditingName(false)}
        testID="edit-display-name"
      />

      <PhotoActionsSheet
        visible={photoSheet}
        hasPhoto={hasUploadedPhoto}
        onChooseLibrary={() => void pickAndUpload("library")}
        onTakePhoto={() => void pickAndUpload("camera")}
        onRemove={() => void removePhoto()}
        onClose={() => setPhotoSheet(false)}
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  photoBlock: { alignItems: "center", gap: 6 },
  avatarPress: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  cameraBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  busyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: AVATAR_SIZE / 2,
    opacity: 0.75,
    alignItems: "center",
    justifyContent: "center",
  },
  photoLinkPress: { minHeight: 44, justifyContent: "center" },
  photoLink: { fontSize: 14.5, fontWeight: "700", minHeight: 22 },
  notice: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  noticeText: { flex: 1, minWidth: 0 },
  noticeTitle: { fontSize: 14, fontWeight: "700" },
  noticeBody: { fontSize: 13.5, lineHeight: 19 },
  managed: { flexDirection: "row", gap: 10, paddingHorizontal: 4 },
  managedText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
});

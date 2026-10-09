import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

/**
 * One place for how a housekeeper's photo is taken and prepared, so the
 * maintenance and Lost & Found sheets behave the same: resized to 1024px wide
 * JPEG at 0.75 (the project's existing standard; the API accepts up to 5 MB).
 */

export type PhotoSource = "camera" | "gallery";
export type PhotoPick = { ok: true; uri: string } | { ok: false; reason: "cancelled" | "permission_denied" | "failed" };

export async function pickPhoto(source: PhotoSource): Promise<PhotoPick> {
  try {
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== "granted") return { ok: false, reason: "permission_denied" };
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.8 });
      const asset = result.canceled ? null : result.assets[0];
      return asset ? { ok: true, uri: asset.uri } : { ok: false, reason: "cancelled" };
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.8 });
    const asset = result.canceled ? null : result.assets[0];
    return asset ? { ok: true, uri: asset.uri } : { ok: false, reason: "cancelled" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Resize + recompress right before upload; the picked original is left untouched. */
export async function prepareForUpload(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], {
    compress: 0.75,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

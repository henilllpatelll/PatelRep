import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { Translate } from "@/lib/inspections/viewText";

/**
 * A photo at full size. Pinch-to-zoom works where the platform's scroll view supports it (iOS); everywhere else the
 * whole photo is simply shown, fitted to the screen. It is read-only: replacing or removing the photo happens back in
 * the issue, which this never closes or changes.
 */
export function PhotoViewer({ uri, label, t, onClose, onUnreadable, lostLabel, lost }: { uri: string | null; label: string; t: Translate; onClose: () => void; onUnreadable?: () => void; lostLabel?: string; lost?: boolean }) {
  const insets = useSafeAreaInsets();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [uri]);

  return (
    <Modal visible={uri !== null || Boolean(lost)} animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent>
      <View style={styles.screen} accessibilityViewIsModal testID="workspace-photo-viewer">
        {uri && !broken && !lost ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.fit}
            maximumZoomScale={4}
            minimumZoomScale={1}
            bouncesZoom
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              source={{ uri }}
              resizeMode="contain"
              style={styles.image}
              accessible
              accessibilityRole="image"
              accessibilityLabel={t("inspect.workspace.photo.viewerA11y", { item: label })}
              onError={() => {
                setBroken(true);
                onUnreadable?.();
              }}
              testID="workspace-photo-viewer-image"
            />
          </ScrollView>
        ) : (
          <View style={styles.fit}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.message} accessibilityRole="alert" testID="workspace-photo-viewer-lost">
              {lostLabel ?? t("inspect.workspace.photo.lost")}
            </Text>
          </View>
        )}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("inspect.workspace.photo.viewerClose")}
          hitSlop={8}
          style={[styles.close, { top: Math.max(12, insets.top + 4) }]}
          testID="workspace-photo-viewer-close"
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)" },
  flex: { flex: 1 },
  fit: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 12 },
  image: { width: "100%", height: "100%", minHeight: 320 },
  message: { color: "#FFFFFF", fontSize: 16, lineHeight: 22, fontWeight: "700", textAlign: "center", paddingHorizontal: 24 },
  close: { position: "absolute", right: 16, width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
});

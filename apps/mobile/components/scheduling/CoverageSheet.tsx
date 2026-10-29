import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling content (the primary actions). */
  footer?: ReactNode;
  testID: string;
}

/** The bottom drawer every coverage step shares: backdrop, grabber, title, scrolling body, pinned actions. */
export function CoverageSheet({ visible, title, subtitle, closeLabel, onClose, children, footer, testID }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} testID={`${testID}-backdrop`} />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(16, insets.bottom + 8) }]} accessibilityViewIsModal testID={testID}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
                {title}
              </Text>
              {subtitle ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textSecondary }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} testID={`${testID}-close`} hitSlop={8} style={styles.closeHit}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.closeText, { color: theme.primaryAction }]}>
                {closeLabel}
              </Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 20, fontWeight: "800" },
  subtitle: { fontSize: 14, lineHeight: 19 },
  closeHit: { minHeight: MIN_TARGET, justifyContent: "center" },
  closeText: { fontSize: 15, fontWeight: "700" },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
});

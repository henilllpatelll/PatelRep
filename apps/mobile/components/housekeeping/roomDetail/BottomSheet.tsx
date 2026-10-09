import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";

export const MAX_FONT_SCALE = 1.6;

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling content (primary buttons). */
  footer?: ReactNode;
  testID?: string;
}

/**
 * The one sheet Room Detail uses for Room Information, Linen Exchange, the
 * completion confirmation and Report / More. It respects the safe area and the
 * keyboard, closes from the backdrop and the Android back button, and scrolls
 * rather than clipping under large text.
 */
export function BottomSheet({ visible, title, onClose, children, footer, testID }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          importantForAccessibility="no"
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: insets.bottom + 12 },
          ]}
        >
          <View style={styles.header}>
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.title, { color: theme.textPrimary }]}
            >
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Ionicons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 8,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, minHeight: 52 },
  title: { flex: 1, fontSize: 18, fontWeight: "900", letterSpacing: -0.2 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 },
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
});

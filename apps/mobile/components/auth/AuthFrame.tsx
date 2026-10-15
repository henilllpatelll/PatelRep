import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";

interface AuthFrameProps {
  title: string;
  body?: string;
  /** Shown only when the screen can be left; recovery in progress passes its own cancel instead. */
  onBack?: () => void;
  children: React.ReactNode;
  testID?: string;
}

/** Signed-out screen chrome: back button, title, short explanation, keyboard-aware body. */
export function AuthFrame({ title, body, onBack, children, testID }: AuthFrameProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      testID={testID}
    >
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t("auth.back")}
            hitSlop={8}
            style={styles.back}
            testID="auth-back"
          >
            <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
          </Pressable>
        ) : null}
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
            {title}
          </Text>
          {body ? <Text style={[styles.body, { color: theme.textSecondary }]}>{body}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function goToLogin() {
  router.replace("/(auth)/login");
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flexGrow: 1, paddingHorizontal: 24, gap: 18 },
  back: { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" },
  copy: { gap: 10, marginTop: 8 },
  title: { fontSize: 26, fontWeight: "700" },
  body: { fontSize: 14.5, lineHeight: 21 },
});
